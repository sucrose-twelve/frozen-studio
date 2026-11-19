import {
  GraphBuilder,
  output,
  type BuiltGraph,
  type GraphReference,
  type NodeRef
} from "./builder"
import { loadReference, outputPrefix, removeBackground } from "./shared"

type QwenImageOptions = {
  model: string
  textEncoder: string
  vae: string
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
  seed: number
}

/**
 * Adds a Qwen-Image 2.1 generation to a workflow: text-to-image without references, an edit with them. The
 * model takes plain sentences, and up to 16 reference images that both the text encoder and the sampler see.
 *
 * - An empty negative prompt would switch CFG off in this model, so it falls back to a single space (the
 *   model card's advice).
 * - Edits sample with `euler`: `er_sde`, the card's text-to-image sampler, gave burnt, over-sharpened
 *   results in edit mode on this setup.
 *
 * @returns The decoded image batch
 */
export function addQwenImage(builder: GraphBuilder, options: QwenImageOptions): NodeRef {
  const isEdit = options.references.length > 0

  const model = builder.add(
    "UNETLoader",
    { unet_name: options.model, weight_dtype: "default" },
    "Loading the image model"
  )
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

  const sampled = builder.add(
    "KSampler",
    {
      model: cached,
      seed: options.seed,
      steps: options.steps,
      cfg: options.cfg,
      sampler_name: isEdit ? "euler" : "er_sde",
      scheduler: "simple",
      positive: encoded,
      negative: output(encoded, 1),
      latent_image: latent,
      denoise: 1
    },
    "Painting"
  )

  return builder.add("VAEDecode", { samples: sampled, vae }, "Decoding the image")
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
  if (!models.image) throw new Error("The image model isn't installed in ComfyUI")

  const size =
    params.width !== null && params.height !== null
      ? { width: params.width, height: params.height }
      : null
  if (!size && references.length === 0) {
    throw new Error("An image without references needs a size")
  }

  const builder = new GraphBuilder()
  const image = addQwenImage(builder, {
    model: params.model,
    textEncoder: models.image.textEncoder,
    vae: models.image.vae,
    prompt,
    negative: params.negative,
    references,
    size,
    count: params.count,
    steps: params.steps,
    cfg: params.cfg,
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
