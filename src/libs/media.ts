import fs from "node:fs"
import path from "node:path"

import { MEDIA_FOLDER } from "@/constants"
import { COMFY } from "@/constants/env"

const MIME_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".wav": "audio/wav"
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

const toForwardSlashes = (value: string) => value.replaceAll("\\", "/")

export function mimeTypeOf(filePath: string) {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? null
}

/**
 * The ComfyUI directory an asset's `path` is relative to.
 */
export function mediaRoot(root: Media.AssetRoot) {
  return root === "input" ? COMFY.inputDir : COMFY.outputDir
}

/**
 * Resolves an asset to its file on disk, or `null` when the stored path would leave its root. Paths are only
 * written by the app and the worker, so this guards against a corrupted row, not against user input.
 */
export function assetFilePath(asset: { root: Media.AssetRoot; path: string }) {
  if (asset.path.split("/").includes("..") || path.isAbsolute(asset.path)) return null

  const base = toForwardSlashes(path.resolve(mediaRoot(asset.root)))
  const resolved = toForwardSlashes(path.resolve(base, asset.path))
  if (!resolved.toLowerCase().startsWith(`${base.toLowerCase()}/`)) return null

  return resolved
}

/**
 * The name ComfyUI's `LoadImage` node takes for an asset. Input files go by their relative path; a file in
 * the output directory needs the `[output]` annotation.
 */
export function comfyImageName(asset: { root: Media.AssetRoot; path: string }) {
  return asset.root === "output" ? `${asset.path} [output]` : asset.path
}

/**
 * The file name an asset is shown and downloaded under. ComfyUI names every job's files alike
 * (`image_00001_.png`), so the start of the job's folder goes in front to keep downloads apart.
 *
 * @example
 * assetFileName("frozen/f81426e0-704a-4f3a-8c62-f9d2731eb097/image_00001_.png") // "f81426e0-image_00001_.png"
 */
export function assetFileName(assetPath: string) {
  const parts = assetPath.split("/")
  const file = parts.at(-1) ?? assetPath
  const folder = parts.at(-2)

  return folder && folder !== MEDIA_FOLDER ? `${folder.slice(0, 8)}-${file}` : file
}

/**
 * Reads the pixel size from a PNG header.
 *
 * @param header - At least the first 24 bytes of the file
 * @returns The size, or `null` when the bytes aren't a PNG
 */
export function readPngSize(header: Uint8Array) {
  const bytes = Buffer.from(header.buffer, header.byteOffset, header.byteLength)
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return null

  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }
}

/**
 * `readPngSize` for a file on disk, reading only its header.
 */
export async function readPngFileSize(filePath: string) {
  const file = await fs.promises.open(filePath, "r")
  try {
    const header = Buffer.alloc(24)
    await file.read(header, 0, 24, 0)
    return readPngSize(header)
  } finally {
    await file.close()
  }
}

/**
 * Streams a file (or a byte range of it) as a web `ReadableStream`, and stops reading when the request is
 * aborted.
 */
export function readFileStream(
  filePath: string,
  signal: AbortSignal,
  range?: { start: number; end: number }
) {
  const file = fs.createReadStream(filePath, range)
  const chunks = file[Symbol.asyncIterator]()
  signal.addEventListener("abort", () => file.destroy())

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { value, done } = await chunks.next()
      if (done) controller.close()
      else controller.enqueue(value)
    },
    cancel() {
      file.destroy()
    }
  })
}

/**
 * Deletes the folder a job wrote its files into (`<output>/frozen/<jobId>`), with everything in it.
 *
 * @param jobId - A job id that passed the UUID check, so the folder can only belong to that job
 */
export function removeJobFolder(jobId: string) {
  return fs.promises.rm(path.join(mediaRoot("output"), MEDIA_FOLDER, jobId), {
    recursive: true,
    force: true
  })
}
