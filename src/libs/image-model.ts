import { IMAGE_FAMILIES, IMAGE_FAMILY_SAMPLING } from "@/constants"

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
 * Whether a model can take reference images, i.e. edit.
 *
 * A Turbo model can't, though its family can: given a reference it returns it burnt and over-sharpened
 * (tried with one reference on its own schedule). The form and `createJob` both ask this.
 */
export function canEditImages(fileName: string) {
  return (
    IMAGE_FAMILY_SAMPLING[imageFamily(fileName)].canEdit && !isTurboImageModel(fileName)
  )
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
 * The text encoders a model can be paired with, out of its family's.
 *
 * A GGUF text encoder means the job runs on stable-diffusion.cpp. For Qwen-Image 2.1 that is only set up
 * for Turbo models in GGUF files, so those are the only ones offered such an encoder. Iris runs nowhere
 * else, and all its text encoders are GGUFs.
 */
export function textEncodersFor(
  installed: Engine.ImageModels | undefined,
  model: string
) {
  const all = installed?.textEncoders ?? []
  const runsOnSdCpp =
    imageFamily(model) === "iris" || (isGgufFile(model) && isTurboImageModel(model))

  return runsOnSdCpp ? all : all.filter((name) => !isGgufFile(name))
}

/**
 * Every image model that can run, across families, in the order the Image form lists them.
 *
 * @param image - `Engine.Models.image`, or nothing while the engine hasn't reported
 */
export function listImageModels(image: Engine.Models["image"] | undefined) {
  return IMAGE_FAMILIES.flatMap((family) => image?.[family]?.models ?? [])
}
