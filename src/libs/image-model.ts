import { IMAGE_FAMILIES, IMAGE_FAMILY_LABELS, IMAGE_FAMILY_SAMPLING } from "@/constants"

/**
 * Which family an image model file belongs to. The file name is all there is to go by: MOSS-Image files
 * say "moss", Iris files "iris", and everything else the Image form lists is Qwen-Image 2.1.
 */
export function imageFamily(fileName: string): Media.ImageFamily {
  if (/moss/i.test(fileName)) return "moss"
  return /iris/i.test(fileName) ? "iris" : "qwen"
}

/**
 * Whether a model file is a GGUF. ComfyUI reads those through the loader node of ComfyUI-GGUF
 * (`UnetLoaderGGUF`), and only diffusion models; stable-diffusion.cpp reads any.
 */
export function isGgufFile(fileName: string) {
  return /\.gguf$/i.test(fileName)
}

/**
 * Whether an image model file is a Turbo build of Qwen-Image 2.1: distilled to draw in a fixed 8 steps
 * (`IMAGE_TURBO`). Every Turbo release says so in its name.
 */
export function isTurboImageModel(fileName: string) {
  return imageFamily(fileName) === "qwen" && /turbo/i.test(fileName)
}

/**
 * Whether a model can take reference images, i.e. edit. The form (which hides its reference images
 * otherwise) and `createJob` both ask this.
 *
 * - A Turbo model can't, though its family can: given a reference it returns it burnt and over-sharpened
 *   (tried with one reference on its own schedule).
 * - MOSS-Image and the Sakura quantizations of Qwen-Image 2.1 aren't offered it: in the owner's tests they
 *   followed reference images poorly, MOSS-Image with its edit LoRA too. The LoRA's wiring stays in place
 *   (`IMAGE_FAMILY_SAMPLING.moss`, the image graph) for when a better one comes out.
 *
 * @param installed - What the model's family has installed, which is where an edit LoRA shows up
 */
export function canEditImages(
  fileName: string,
  installed: Engine.ImageModels | undefined
) {
  if (isTurboImageModel(fileName) || /sakura/i.test(fileName)) return false
  if (imageFamily(fileName) === "moss") return false

  const { editing } = IMAGE_FAMILY_SAMPLING[imageFamily(fileName)]
  return editing === "built-in" || (editing === "lora" && !!installed?.editLora)
}

/**
 * The steps and guidance a form starts from for a family: those of a new image, or of an edit where the
 * family has its own for that.
 */
export function imageSamplingDefaults(family: Media.ImageFamily, isEdit: boolean) {
  const sampling = IMAGE_FAMILY_SAMPLING[family]
  const { steps, cfg } = (isEdit ? sampling.edit : undefined) ?? sampling

  return { steps, cfg }
}

/**
 * Which engine runs an image job. It follows from the text encoder: one that comes as a GGUF can only be
 * read by stable-diffusion.cpp, and everything else runs on ComfyUI.
 *
 * @param textEncoder - The job's text encoder; jobs from before there was a choice have none
 */
export function imageEngine(textEncoder: string | null | undefined): Media.ImageEngine {
  return textEncoder && isGgufFile(textEncoder) ? "sdcpp" : "comfy"
}

/**
 * The text encoders a model can be paired with, out of its family's. A GGUF text encoder means the job
 * runs on stable-diffusion.cpp, so this also decides the engine.
 *
 * - Iris runs nowhere else, and all its text encoders are GGUFs.
 * - A Turbo model of Qwen-Image 2.1 in a GGUF file goes with the GGUF encoders published for it, and with
 *   those only: that is the pair the owner wants it used as. Without any (stable-diffusion.cpp isn't
 *   installed), it falls back to ComfyUI's encoders so the model can still run.
 * - Every other model runs on ComfyUI, which can't read a GGUF text encoder.
 */
export function textEncodersFor(
  installed: Engine.ImageModels | undefined,
  model: string
) {
  const all = installed?.textEncoders ?? []
  if (imageFamily(model) === "iris") return all

  const ggufs = all.filter(isGgufFile)
  if (isGgufFile(model) && isTurboImageModel(model) && ggufs.length > 0) return ggufs

  return all.filter((name) => !isGgufFile(name))
}

/**
 * Every image model that can run, across families, in the order the Image form lists them.
 *
 * @param image - `Engine.Models.image`, or nothing while the engine hasn't reported
 */
export function listImageModels(image: Engine.Models["image"] | undefined) {
  return IMAGE_FAMILIES.flatMap((family) => image?.[family]?.models ?? [])
}

/**
 * A readable name for a model file, e.g. `qwen-image-2.1-step90000-FP8-comfy.safetensors` becomes
 * "Qwen-Image 2.1 Omni · FP8" and `moss_image_sft_int8_convrot.safetensors` "MOSS-Image · sft_int8_convrot".
 * The `stepNNNNN` marker is how the Omni merge names its builds. A name that follows neither pattern is
 * shown as it is, without the extension.
 */
export function modelLabel(fileName: string) {
  const base = fileName.replace(/\.(safetensors|gguf)$/i, "")
  if (/^moss[-_]image[-_]/i.test(base)) {
    return `${IMAGE_FAMILY_LABELS.moss} · ${base.replace(/^moss[-_]image[-_]/i, "")}`
  }
  if (!/^qwen[-_]image[-_]2\.1/i.test(base)) return base

  const variant = base
    .replace(/^qwen[-_]image[-_]2\.1[-_]?/i, "")
    .replace(/step\d+[-_]?/i, "")
    .replace(/[-_]comfy$/i, "")
  const family = /step\d+/i.test(base) ? "Qwen-Image 2.1 Omni" : "Qwen-Image 2.1"

  return variant ? `${family} · ${variant}` : family
}

/**
 * A readable name for a LoRA file. It is listed under its model, so the model's name in front and the
 * "ComfyUI" some releases end with say nothing: `MOSS-Image-Anime-LoRA-ComfyUI.safetensors` becomes
 * "Anime-LoRA".
 */
export function loraLabel(fileName: string) {
  const base = fileName.replace(/\.(safetensors|gguf)$/i, "")
  const short = base
    .replace(/^(?:moss|qwen)[-_]image[-_](?:2\.1[-_])?/i, "")
    .replace(/[-_]comfyui$/i, "")

  return short || base
}
