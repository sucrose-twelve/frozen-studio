import { MEDIA_FOLDER } from "@/constants"

import { output, type GraphBuilder, type GraphReference, type NodeRef } from "./builder"

/**
 * The `filename_prefix` of a save node. ComfyUI appends a counter and the extension, and creates the
 * subfolders under its output directory: `frozen/<jobId>/image_00001_.png`.
 */
export function outputPrefix(jobId: string, name: string) {
  return `${MEDIA_FOLDER}/${jobId}/${name}`
}

/**
 * Loads a reference image with any transparency flattened onto white.
 *
 * `LoadImage` drops the alpha channel and keeps whatever colour sits under it, which for a sprite cut out
 * elsewhere is usually black. Its second output is the inverted alpha (1 where transparent), so pasting
 * white through that mask fills exactly the transparent area; an image without alpha comes through
 * untouched.
 */
export function loadReference(
  builder: GraphBuilder,
  reference: GraphReference,
  label = "Reading the reference image"
): NodeRef {
  const image = builder.add("LoadImage", { image: reference.imageName }, label)
  const white = builder.add("EmptyImage", {
    width: 64,
    height: 64,
    batch_size: 1,
    color: 0xffffff
  })

  return builder.add("ImageCompositeMasked", {
    destination: image,
    source: white,
    x: 0,
    y: 0,
    resize_source: true,
    mask: output(image, 1)
  })
}

/**
 * Cuts the background out of an image (or every image of a batch) with BiRefNet.
 *
 * `RemoveBackground` returns a foreground mask, while `JoinImageWithAlpha` expects the opposite (it inverts
 * what it is given), hence the `InvertMask` in between.
 *
 * @returns The same pixels with an alpha channel
 */
export function removeBackground(
  builder: GraphBuilder,
  image: NodeRef,
  model: string,
  label = "Removing the background"
): NodeRef {
  const loaded = builder.add(
    "LoadBackgroundRemovalModel",
    { bg_removal_name: model },
    "Loading the background model"
  )
  const mask = builder.add("RemoveBackground", { bg_removal_model: loaded, image }, label)
  const inverted = builder.add("InvertMask", { mask })

  return builder.add("JoinImageWithAlpha", { image, alpha: inverted })
}
