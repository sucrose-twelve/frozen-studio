import {
  IMAGE_DEFAULT_SAMPLERS,
  IMAGE_FAMILY_LABELS,
  IMAGE_FAMILY_SAMPLING,
  IMAGE_TURBO
} from "@/constants"
import { imageFamily, isGgufFile, isTurboImageModel } from "@/libs/image-model"

import {
  GraphBuilder,
  output,
  type BuiltGraph,
  type GraphReference,
  type NodeRef
} from "./builder"
import { loadReference, outputPrefix, removeBackground } from "./shared"

/**
 * What to draw, whichever family draws it.
 */
export type ImageRequest = {
  model: string
  /**
   * `null` uses the first one installed for the model's family.
   */
  textEncoder: string | null
  prompt: string
  negative: string
  references: GraphReference[]
  /**
   * `null` follows the first reference image. Required when there are no references.
   */
  size: { width: number; height: number } | null
  count: number
  steps: number
  cfg: number
  /**
   * `null` picks the one that suits the family and the mode (`IMAGE_FAMILY_SAMPLING`).
   */
  sampler: Media.ImageSampler | null
  lora: { name: string; strength: number } | null
  seed: number
}

/**
 * A request with its family's files filled in.
 */
type ImageOptions = Omit<ImageRequest, "textEncoder"> & {
  textEncoder: string
  vae: string
}

/**
 * Puts a LoRA on a loaded model, or hands the model back when there is none. Only the diffusion model is
 * patched: the LoRAs these families have don't touch the text encoder.
 */
function applyLora(builder: GraphBuilder, model: NodeRef, lora: ImageOptions["lora"]) {
  if (!lora) return model

  return builder.add("LoraLoaderModelOnly", {
    model,
    lora_name: lora.name,
    strength_model: lora.strength
  })
}

/**
 * Adds a Qwen-Image 2.1 generation to a workflow: text-to-image without references, an edit with them. The
 * model takes plain sentences, and up to 16 reference images that both the text encoder and the sampler see.
 *
 * - An empty negative prompt would switch CFG off in this model, so it falls back to a single space (the
 *   model card's advice).
 * - Unless a sampler is asked for, a new image and an edit each get the one known to work for them
 *   (`IMAGE_DEFAULT_SAMPLERS` says which, and why they differ).
 * - A Turbo model ignores `steps`, `cfg` and `sampler` and runs its fixed schedule (`IMAGE_TURBO`).
 * - A model in a GGUF file goes through the loader ComfyUI-GGUF adds for those.
 *
 * @returns The decoded image batch
 */
function addQwenImage(builder: GraphBuilder, options: ImageOptions): NodeRef {
  const isEdit = options.references.length > 0
  const isTurbo = isTurboImageModel(options.model)

  const loaded = isGgufFile(options.model)
    ? builder.add(
        "UnetLoaderGGUF",
        { unet_name: options.model },
        "Loading the image model"
      )
    : builder.add(
        "UNETLoader",
        { unet_name: options.model, weight_dtype: "default" },
        "Loading the image model"
      )
  const model = applyLora(builder, loaded, options.lora)
  const textEncoder = builder.add(
    "CLIPLoader",
    { clip_name: options.textEncoder, type: "qwen_image", device: "default" },
    "Loading the text encoder"
  )
  const vae = builder.add("VAELoader", { vae_name: options.vae })
  const cached = builder.add("QwenImage21Cache", {
    model,
    device: "auto",
    dtype: "default"
  })

  const images = Object.fromEntries(
    options.references.map((reference, index) => [
      `images.image_${index + 1}`,
      loadReference(builder, reference)
    ])
  )
  const encoded = builder.add(
    "TextEncodeQwenImage21",
    {
      clip: textEncoder,
      prompt: options.prompt,
      negative_prompt: options.negative.trim() || " ",
      resolution: 1024,
      ...(isEdit ? { vae, ...images } : {})
    },
    isEdit ? "Reading the prompt and references" : "Reading the prompt"
  )

  let latent: NodeRef
  if (options.size) {
    latent = builder.add("EmptyLatentImage", {
      width: options.size.width,
      height: options.size.height,
      batch_size: options.count
    })
  } else {
    // The encoder's third output is an empty latent sized like the first reference
    latent = output(encoded, 2)
    if (options.count > 1) {
      latent = builder.add("RepeatLatentBatch", {
        samples: latent,
        amount: options.count
      })
    }
  }

  let sampled: NodeRef
  if (isTurbo) {
    // KSampler can only take a named scheduler, and Turbo's noise levels are not one of them
    const guider = builder.add("CFGGuider", {
      model: cached,
      positive: encoded,
      negative: output(encoded, 1),
      cfg: IMAGE_TURBO.cfg
    })
    sampled = builder.add(
      "SamplerCustomAdvanced",
      {
        noise: builder.add("RandomNoise", { noise_seed: options.seed }),
        guider,
        sampler: builder.add("KSamplerSelect", { sampler_name: IMAGE_TURBO.sampler }),
        sigmas: builder.add("ManualSigmas", { sigmas: IMAGE_TURBO.sigmas.join(", ") }),
        latent_image: latent
      },
      "Painting"
    )
  } else {
    sampled = builder.add(
      "KSampler",
      {
        model: cached,
        seed: options.seed,
        steps: options.steps,
        cfg: options.cfg,
        sampler_name:
          options.sampler ??
          (isEdit ? IMAGE_DEFAULT_SAMPLERS.edit : IMAGE_DEFAULT_SAMPLERS.create),
        scheduler: "simple",
        positive: encoded,
        negative: output(encoded, 1),
        latent_image: latent,
        denoise: 1
      },
      "Painting"
    )
  }

  return builder.add("VAEDecode", { samples: sampled, vae }, "Decoding the image")
}

/**
 * Adds a MOSS-Image generation to a workflow: text to image only. The nodes and their settings are those of
 * ComfyUI's own workflow for the model.
 *
 * - It has its own text encoder (Qwen3.5 9B, loaded as `moss_image`) and works in the FLUX.2 latent space,
 *   so the empty latent comes from the FLUX.2 node and not the plain one.
 * - An empty negative prompt is fine here, unlike with Qwen-Image.
 * - Editing needs an edit LoRA and its own encoding node; neither is set up, so references are refused.
 *
 * @returns The decoded image batch
 * @throws {Error} When the request has reference images, or no size
 */
function addMossImage(builder: GraphBuilder, options: ImageOptions): NodeRef {
  if (options.references.length > 0 || !options.size) {
    throw new Error("MOSS-Image only draws new images: it needs a size and no references")
  }

  const loaded = builder.add(
    "UNETLoader",
    { unet_name: options.model, weight_dtype: "default" },
    "Loading the image model"
  )
  const model = applyLora(builder, loaded, options.lora)
  const textEncoder = builder.add(
    "CLIPLoader",
    { clip_name: options.textEncoder, type: "moss_image", device: "default" },
    "Loading the text encoder"
  )
  const vae = builder.add("VAELoader", { vae_name: options.vae })

  const positive = builder.add(
    "CLIPTextEncode",
    { clip: textEncoder, text: options.prompt },
    "Reading the prompt"
  )
  const negative = builder.add("CLIPTextEncode", {
    clip: textEncoder,
    text: options.negative.trim()
  })
  const latent = builder.add("EmptyFlux2LatentImage", {
    width: options.size.width,
    height: options.size.height,
    batch_size: options.count
  })

  const sampled = builder.add(
    "KSampler",
    {
      model,
      seed: options.seed,
      steps: options.steps,
      cfg: options.cfg,
      sampler_name: options.sampler ?? IMAGE_FAMILY_SAMPLING.moss.samplers.create,
      scheduler: "simple",
      positive,
      negative,
      latent_image: latent,
      denoise: 1
    },
    "Painting"
  )

  return builder.add("VAEDecode", { samples: sampled, vae }, "Decoding the image")
}

/**
 * Adds an image generation to a workflow, on whichever family the request's model belongs to.
 *
 * @param image - `Engine.Models.image`: what is installed, per family
 * @returns The decoded image batch
 * @throws {Error} When the model's family is missing a part (text encoder, VAE), or doesn't run on ComfyUI
 */
export function addImage(
  builder: GraphBuilder,
  image: Engine.Models["image"],
  request: ImageRequest
): NodeRef {
  const family = imageFamily(request.model)
  const installed = image?.[family]
  const textEncoder = request.textEncoder ?? installed?.textEncoders[0]
  // Iris is the family without a VAE, and stable-diffusion.cpp is what runs it
  if (!installed?.vae || !textEncoder || family === "iris") {
    throw new Error(`${IMAGE_FAMILY_LABELS[family]} isn't installed in ComfyUI`)
  }

  const options = { ...request, textEncoder, vae: installed.vae }
  return family === "moss"
    ? addMossImage(builder, options)
    : addQwenImage(builder, options)
}

/**
 * The workflow of an image job: generate, save, and optionally save a cut-out copy of every image.
 *
 * @throws {Error} When the image models are missing, or a text-to-image job has no size
 */
export function buildImageGraph(input: {
  jobId: string
  prompt: string
  params: Media.ImageParams
  references: GraphReference[]
  models: Engine.Models
}): BuiltGraph {
  const { jobId, prompt, params, references, models } = input

  const size =
    params.width !== null && params.height !== null
      ? { width: params.width, height: params.height }
      : null
  if (!size && references.length === 0) {
    throw new Error("An image without references needs a size")
  }

  const builder = new GraphBuilder()
  const image = addImage(builder, models.image, {
    model: params.model,
    textEncoder: params.textEncoder ?? null,
    prompt,
    negative: params.negative,
    references,
    size,
    count: params.count,
    steps: params.steps,
    cfg: params.cfg,
    sampler: params.sampler ?? null,
    lora: params.lora ?? null,
    seed: params.seed
  })

  const saved = builder.add(
    "SaveImage",
    { images: image, filename_prefix: outputPrefix(jobId, "image") },
    "Saving"
  )
  builder.output(saved, "output", "image")

  if (params.shouldRemoveBackground && models.cutout) {
    const cutout = removeBackground(builder, image, models.cutout.model)
    const savedCutout = builder.add(
      "SaveImage",
      { images: cutout, filename_prefix: outputPrefix(jobId, "cutout") },
      "Saving"
    )
    builder.output(savedCutout, "cutout", "image")
  }

  return builder.build()
}
