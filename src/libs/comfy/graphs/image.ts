import {
  IMAGE_DEFAULT_SAMPLERS,
  IMAGE_FAMILY_LABELS,
  IMAGE_FAMILY_SAMPLING,
  IMAGE_TURBO,
  MOSS_EDIT_NEGATIVE
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
  editLora: string | null
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
 * Adds a MOSS-Image generation to a workflow: text to image, or an edit when references are given. The
 * nodes and their settings are those of ComfyUI's own workflows for the model.
 *
 * - It has its own text encoder (Qwen3.5 9B, loaded as `moss_image`) and works in the FLUX.2 latent space,
 *   so the empty latent comes from the FLUX.2 node and not the plain one.
 * - An empty negative prompt is fine for a new image, unlike with Qwen-Image.
 *
 * An edit is the same model with its edit LoRA on top, and differs in these ways:
 *
 * - The prompt and the negative prompt are each encoded together with the references
 *   (`TextEncodeMOSSImageEdit`), in the layout this LoRA was trained with. The other layouts still return
 *   an image, a worse one.
 * - References go in at the size they arrive, so each is scaled to 1 megapixel on a 16px grid first.
 *   Smaller is cheaper, and the model starts re-framing the picture instead of editing it.
 * - Skip-layer guidance on single layer 22 and the `normal` scheduler are what the LoRA's author ships.
 * - The negative side is always read at an edit's guidance, so an empty one falls back to
 *   `MOSS_EDIT_NEGATIVE`.
 *
 * @returns The decoded image batch
 * @throws {Error} When there are references but no edit LoRA, or a new image has no size
 */
function addMossImage(builder: GraphBuilder, options: ImageOptions): NodeRef {
  const isEdit = options.references.length > 0
  if (isEdit && !options.editLora) {
    throw new Error("MOSS-Image needs its edit LoRA in ComfyUI to take reference images")
  }
  if (!isEdit && !options.size) {
    throw new Error("An image without references needs a size")
  }

  const loaded = builder.add(
    "UNETLoader",
    { unet_name: options.model, weight_dtype: "default" },
    "Loading the image model"
  )
  let model = applyLora(builder, loaded, options.lora)
  if (isEdit && options.editLora) {
    const editor = builder.add("LoraLoaderModelOnly", {
      model,
      lora_name: options.editLora,
      strength_model: 1
    })
    model = builder.add("SkipLayerGuidanceDiTSimple", {
      model: editor,
      double_layers: "",
      single_layers: "22",
      start_percent: 0,
      end_percent: 1
    })
  }

  const textEncoder = builder.add(
    "CLIPLoader",
    { clip_name: options.textEncoder, type: "moss_image", device: "default" },
    "Loading the text encoder"
  )
  const vae = builder.add("VAELoader", { vae_name: options.vae })

  let positive: NodeRef
  let negative: NodeRef
  let width: number | NodeRef | undefined = options.size?.width
  let height: number | NodeRef | undefined = options.size?.height

  if (isEdit) {
    const references = options.references.map((reference) =>
      builder.add("ImageScaleToTotalPixels", {
        image: loadReference(builder, reference),
        upscale_method: "lanczos",
        megapixels: 1,
        resolution_steps: 16
      })
    )
    const images = Object.fromEntries(
      references.map((image, index) => [`images.image_${index}`, image])
    )
    const encode = (prompt: string, label?: string) =>
      builder.add(
        "TextEncodeMOSSImageEdit",
        {
          clip: textEncoder,
          prompt,
          vae,
          edit_format: "Moss-Image-Edit",
          // Only weighs the images the text encoder itself looks at, which this layout doesn't use
          image_strength: 1,
          ...images
        },
        label
      )

    positive = encode(options.prompt, "Reading the prompt and references")
    negative = encode(options.negative.trim() || MOSS_EDIT_NEGATIVE)

    // Without a size of its own, the result takes the first reference's
    const [first] = references
    if (!options.size && first) {
      const measured = builder.add("GetImageSize", { image: first })
      width = measured
      height = output(measured, 1)
    }
  } else {
    positive = builder.add(
      "CLIPTextEncode",
      { clip: textEncoder, text: options.prompt },
      "Reading the prompt"
    )
    negative = builder.add("CLIPTextEncode", {
      clip: textEncoder,
      text: options.negative.trim()
    })
  }

  const latent = builder.add("EmptyFlux2LatentImage", {
    width,
    height,
    batch_size: options.count
  })

  const sampled = builder.add(
    "KSampler",
    {
      model,
      seed: options.seed,
      steps: options.steps,
      cfg: options.cfg,
      sampler_name:
        options.sampler ??
        (isEdit
          ? IMAGE_FAMILY_SAMPLING.moss.samplers.edit
          : IMAGE_FAMILY_SAMPLING.moss.samplers.create),
      scheduler: isEdit ? "normal" : "simple",
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
function addImage(
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

  const options = {
    ...request,
    textEncoder,
    vae: installed.vae,
    editLora: installed.editLora
  }
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
