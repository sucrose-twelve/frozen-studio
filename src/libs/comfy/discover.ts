import { readComboOptions } from "./client"

function pick(names: string[], ...patterns: RegExp[]) {
  for (const pattern of patterns) {
    const match = names.find((name) => pattern.test(name))
    if (match) return match
  }

  return null
}

/**
 * Looks up which model files ComfyUI has, and from them which job kinds can run.
 *
 * Files are matched by name, since ComfyUI only lists names:
 *
 * - Image: Qwen-Image 2.1 diffusion models, with the Qwen3-VL text encoder and the 2.1 VAE
 * - Video: Wan 2.2 image-to-video GGUFs (high and low noise), the umT5 text encoder and the Wan VAE; the
 *   Lightning LoRAs are optional and switch on the fast mode
 * - Cutout: any model in `models/background_removal`
 */
export async function discoverModels(): Promise<Engine.Models> {
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

  const highNoise = pick(gguf, /wan2\.2.*i2v.*high/i)
  const lowNoise = pick(gguf, /wan2\.2.*i2v.*low/i)
  const videoTextEncoder = pick(textEncoders, /umt5/i)
  const videoVae = pick(vaes, /wan2?\.?1.*vae/i, /wan.*vae/i)

  return {
    image:
      imageModels.length > 0 && imageTextEncoder && imageVae
        ? { models: imageModels, textEncoder: imageTextEncoder, vae: imageVae }
        : null,
    video:
      highNoise && lowNoise && videoTextEncoder && videoVae
        ? {
            highNoise,
            lowNoise,
            textEncoder: videoTextEncoder,
            vae: videoVae,
            fastHighNoise: pick(loras, /wan2\.2_i2v.*lightx2v.*high/i),
            fastLowNoise: pick(loras, /wan2\.2_i2v.*lightx2v.*low/i)
          }
        : null,
    cutout: backgroundRemoval[0] ? { model: backgroundRemoval[0] } : null
  }
}
