import { readComboOptions } from "./client"

/**
 * The part of `Engine.Models` that lives in ComfyUI. The voice and caption engines are found by the worker
 * itself.
 */
export type ComfyModels = Omit<Engine.Models, "voice" | "caption">

function pick(names: string[], ...patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = names.find((name) => pattern.test(name))
    if (match) return match
  }

  return null
}

/**
 * The part of a Wan file name that says which half of the pair it is: "HighNoise", "_low_noise", "-high".
 */
const NOISE_MARK = /[-_ .]?(?:high|low)(?:[-_ ]?noise)?/i

/**
 * Pairs up the Wan 2.2 image-to-video files: a high-noise and a low-noise file belong together when their
 * names are the same but for that word. A file without its other half is left out, since a video needs
 * both.
 *
 * @example
 * // [{ name: "Wan2.2-I2V-A14B-Q5_K_M", highNoise: "…HighNoise-Q5_K_M.gguf", lowNoise: "…LowNoise-Q5_K_M.gguf" }]
 * pairVideoModels(["Wan2.2-I2V-A14B-HighNoise-Q5_K_M.gguf", "Wan2.2-I2V-A14B-LowNoise-Q5_K_M.gguf"])
 */
function pairVideoModels(names: string[]): Engine.VideoModel[] {
  const sharedName = (name: string) =>
    name.replace(NOISE_MARK, "").replace(/\.(gguf|safetensors)$/i, "")
  const lows = names.filter((name) => /wan2\.2.*i2v.*low/i.test(name))

  return names
    .filter((name) => /wan2\.2.*i2v.*high/i.test(name))
    .flatMap((highNoise) => {
      const name = sharedName(highNoise)
      const lowNoise = lows.find((low) => sharedName(low) === name)

      return lowNoise ? [{ name, highNoise, lowNoise }] : []
    })
}

/**
 * A Qwen-Image 2.1 diffusion model, under its own name or as one of the Sakura quantizations of it.
 */
const IMAGE_MODEL = /(?:qwen|sakura).?image.?2\.1/i

/**
 * Whether a text encoder file is the one Qwen-Image 2.1 reads prompts with: Qwen3-VL in its 8B size. The
 * 2B and 4B sizes belong to other image models.
 */
export function isImageTextEncoder(name: string) {
  return /qwen3.?vl/i.test(name) && !/(?:^|\D)[24]b/i.test(name)
}

/**
 * The VAE of Qwen-Image 2.1, which every engine that runs the model needs.
 */
export const IMAGE_VAE = /qwen_image_2\.1_vae/i

/**
 * A MOSS-Image diffusion model. Only safetensors: ComfyUI-GGUF doesn't know the family.
 */
const MOSS_MODEL = /moss.?image/i

/**
 * Whether a text encoder file is the one MOSS-Image reads prompts with: Qwen3.5 9B as it is. The
 * Qwen-Image 2.1 release has fine-tunes of the same model that rewrite prompts ("pe"), which are not it.
 */
function isMossTextEncoder(name: string) {
  return /qwen3\.?5.?9b/i.test(name) && !/qwen.?image|[-_]pe[-_.]/i.test(name)
}

/**
 * Puts the file a pattern matches first, when there is one: the list's first name is the default.
 */
function preferring(names: string[], pattern: RegExp) {
  const preferred = pick(names, pattern)
  return preferred ? [preferred, ...names.filter((name) => name !== preferred)] : names
}

/**
 * Looks up which model files ComfyUI has, and from them which job kinds can run.
 *
 * Files are matched by name, since ComfyUI only lists names:
 *
 * - Image: Qwen-Image 2.1 diffusion models (safetensors or GGUF), with the Qwen3-VL 8B text encoders and
 *   the 2.1 VAE. The int8 text encoder comes first when it is there: it is the one that fits the card.
 *   Text encoders are safetensors only. ComfyUI knows this encoder by its vision half, which a GGUF of it
 *   leaves out, so one loaded from a GGUF is taken for another model's encoder and the job fails
 * - Image, second family: MOSS-Image diffusion models, with the Qwen3.5 9B text encoder and the FLUX.2
 *   VAE. LoRAs with "moss" in their name are offered with them
 * - Video: Wan 2.2 image-to-video GGUFs in pairs (high and low noise), the umT5 text encoder and the Wan
 *   VAE; the Lightning LoRAs are optional and switch on the fast mode
 * - Cutout: any model in `models/background_removal`
 */
export async function discoverModels(): Promise<ComfyModels> {
  const [diffusion, gguf, textEncoders, vaes, loras, backgroundRemoval] =
    await Promise.all([
      readComboOptions("UNETLoader", "unet_name"),
      readComboOptions("UnetLoaderGGUF", "unet_name"),
      readComboOptions("CLIPLoader", "clip_name"),
      readComboOptions("VAELoader", "vae_name"),
      readComboOptions("LoraLoaderModelOnly", "lora_name"),
      readComboOptions("LoadBackgroundRemovalModel", "bg_removal_name")
    ])

  const imageModels = [...diffusion, ...gguf].filter((name) => IMAGE_MODEL.test(name))
  // The int8 builds come first: they are the ones that fit a 16 GB card beside the model
  const imageTextEncoders = preferring(textEncoders.filter(isImageTextEncoder), /int8/i)
  const imageVae = pick(vaes, IMAGE_VAE)

  const mossModels = diffusion.filter((name) => MOSS_MODEL.test(name))
  const mossTextEncoders = preferring(textEncoders.filter(isMossTextEncoder), /int8/i)
  // The full VAE before the "small" one, which trades detail for speed
  const mossVae = pick(vaes, /flux2.?vae\.safetensors$/i, /flux2.?vae/i)

  const image: NonNullable<ComfyModels["image"]> = {}
  if (imageModels.length > 0 && imageTextEncoders.length > 0 && imageVae) {
    image.qwen = {
      models: imageModels,
      textEncoders: imageTextEncoders,
      vae: imageVae,
      loras: []
    }
  }
  if (mossModels.length > 0 && mossTextEncoders.length > 0 && mossVae) {
    image.moss = {
      models: mossModels,
      textEncoders: mossTextEncoders,
      vae: mossVae,
      loras: loras.filter((name) => /moss/i.test(name))
    }
  }

  const videoModels = pairVideoModels(gguf)
  const videoTextEncoder = pick(textEncoders, /umt5/i)
  const videoVae = pick(vaes, /wan2?\.?1.*vae/i, /wan.*vae/i)

  return {
    image: image.qwen || image.moss ? image : null,
    video:
      videoModels.length > 0 && videoTextEncoder && videoVae
        ? {
            models: videoModels,
            textEncoder: videoTextEncoder,
            vae: videoVae,
            fastHighNoise: pick(loras, /wan2\.2_i2v.*lightx2v.*high/i),
            fastLowNoise: pick(loras, /wan2\.2_i2v.*lightx2v.*low/i)
          }
        : null,
    cutout: backgroundRemoval[0] ? { model: backgroundRemoval[0] } : null
  }
}
