import { randomUUID } from "node:crypto"
import fs from "node:fs"
import path from "node:path"

import type { NextRequest } from "next/server"

import type { AssetView } from "@/actions/jobs/read"
import { MEDIA_FOLDER, UPLOAD_MAX_BYTES, UPLOAD_MAX_SIDE } from "@/constants"
import { db, schema } from "@/drizzle"
import { mediaRoot, readPngSize } from "@/libs/media"

export type UploadResponse =
  { ok: true; asset: AssetView } | { ok: false; message: string }

function fail(message: string, status: number) {
  return Response.json({ ok: false, message } satisfies UploadResponse, { status })
}

/**
 * Stores a reference image and returns its asset.
 *
 * The browser re-encodes every image to PNG before sending it (`prepareUpload`), so this accepts PNG only
 * and checks the header itself instead of trusting the declared type. The file goes into the input
 * directory of ComfyUI, where `LoadImage` reads it by relative path.
 *
 * A Route Handler, not a Server Action: media never goes through actions.
 */
export async function POST(request: NextRequest) {
  const form = await request.formData().catch(() => null)
  const file = form?.get("file")
  if (!(file instanceof File)) return fail("No file was sent", 400)
  if (file.size > UPLOAD_MAX_BYTES) return fail("The image is too large", 413)

  const bytes = new Uint8Array(await file.arrayBuffer())
  const size = readPngSize(bytes)
  if (!size || Math.max(size.width, size.height) > UPLOAD_MAX_SIDE) {
    return fail("Not a usable image", 415)
  }

  const relativePath = `${MEDIA_FOLDER}/${randomUUID()}.png`
  const filePath = path.join(mediaRoot("input"), relativePath)
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true })
  await fs.promises.writeFile(filePath, bytes)

  const [row] = await db
    .insert(schema.assets)
    .values({
      kind: "image",
      role: "upload",
      root: "input",
      path: relativePath,
      mime: "image/png",
      width: size.width,
      height: size.height,
      size: bytes.byteLength
    })
    .returning({ id: schema.assets.id })

  const asset: AssetView = {
    id: row!.id,
    kind: "image",
    role: "upload",
    width: size.width,
    height: size.height,
    position: 0,
    isFavorite: false,
    name: path.basename(relativePath),
    url: `/api/media/${row!.id}`
  }
  return Response.json({ ok: true, asset } satisfies UploadResponse)
}
