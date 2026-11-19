import type { AssetView } from "@/actions/jobs/read"
import type { UploadResponse } from "@/app/api/uploads/route"
import { UPLOAD_MAX_SIDE } from "@/constants"

/**
 * Re-encodes an image in the browser before it is uploaded: decoded whatever its format, scaled down to fit
 * `UPLOAD_MAX_SIDE`, and written as PNG. The server then only ever stores PNGs of a sane size.
 *
 * Browser only (`createImageBitmap`, canvas).
 *
 * @throws {Error} When the file isn't an image the browser can decode
 */
export async function prepareUpload(file: Blob) {
  const bitmap = await createImageBitmap(file).catch(() => null)
  if (!bitmap) throw new Error("That file isn't an image this browser can read")

  const scale = Math.min(1, UPLOAD_MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/png")
  )
  if (!blob) throw new Error("The image couldn't be prepared for upload")

  return blob
}

/**
 * Prepares an image and stores it as a reference asset.
 *
 * @returns The stored asset
 * @throws {Error} With the server's message when the upload is refused
 */
export async function uploadReference(file: Blob): Promise<AssetView> {
  const body = new FormData()
  body.append("file", await prepareUpload(file), "reference.png")

  const response = await fetch("/api/uploads", { method: "POST", body })
  const result = (await response.json().catch(() => null)) as UploadResponse | null
  if (!result?.ok) throw new Error(result?.message ?? "The upload failed")

  return result.asset
}
