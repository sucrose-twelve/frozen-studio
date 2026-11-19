import { GraphBuilder, type BuiltGraph, type GraphReference } from "./builder"
import { outputPrefix, removeBackground } from "./shared"

/**
 * The workflow of a cutout job: one image in, the same image with a transparent background out.
 *
 * The image is loaded as it is, not flattened onto white like other references: the result should keep the
 * original pixels.
 *
 * @throws {Error} When no background removal model is installed
 */
export function buildCutoutGraph(input: {
  jobId: string
  reference: GraphReference
  models: Engine.Models
}): BuiltGraph {
  const { jobId, reference, models } = input
  if (!models.cutout)
    throw new Error("No background removal model is installed in ComfyUI")

  const builder = new GraphBuilder()
  const image = builder.add(
    "LoadImage",
    { image: reference.imageName },
    "Reading the image"
  )
  const cutout = removeBackground(builder, image, models.cutout.model)
  const saved = builder.add(
    "SaveImage",
    { images: cutout, filename_prefix: outputPrefix(jobId, "cutout") },
    "Saving"
  )
  builder.output(saved, "cutout", "image")

  return builder.build()
}
