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
 * Looks up which model files ComfyUI has, and from them which job kinds can run.
 *
 * Files are matched by name, since ComfyUI only lists names:
 *
 * - Image: Qwen-Image 2.1 diffusion models, with the Qwen3-VL text encoder and the 2.1 VAE
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

  const imageModels = diffusion.filter((name) => /qwen.?image.?2\.1/i.test(name))
  const imageTextEncoder = pick(textEncoders, /qwen3vl.*int8/i, /qwen3vl/i)
  const imageVae = pick(vaes, /qwen_image_2\.1_vae/i)

  const videoModels = pairVideoModels(gguf)
  const videoTextEncoder = pick(textEncoders, /umt5/i)
  const videoVae = pick(vaes, /wan2?\.?1.*vae/i, /wan.*vae/i)

  return {
    image:
      imageModels.length > 0 && imageTextEncoder && imageVae
        ? { models: imageModels, textEncoder: imageTextEncoder, vae: imageVae }
        : null,
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
