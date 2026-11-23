import fs from "node:fs"

import { eq } from "drizzle-orm"
import type { NextRequest } from "next/server"
import { z } from "zod"

import { db, schema } from "@/drizzle"
import { assetFileName, assetFilePath, readFileStream } from "@/libs/media"

const MAX_CHUNK = 4 * 1024 * 1024

/**
 * Files never change once written (a new result is a new asset), so the browser may keep them.
 */
const CACHE_CONTROL = "private, max-age=31536000, immutable"

const paramValidator = z.object({ id: z.uuid() })

/**
 * Resolves a `Range` header to an inclusive byte range, capping open-ended ranges at `MAX_CHUNK` so a long
 * file is sent as it plays. A suffix range (`bytes=-500`) means the last N bytes.
 */
function parseRange(header: string, size: number) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header)
  const [, from = "", to = ""] = match ?? []

  if (!from && to) {
    return { start: Math.max(size - Number(to), 0), end: size - 1 }
  }

  const start = from ? Number(from) : 0
  const end = Math.min(to ? Number(to) : start + MAX_CHUNK - 1, size - 1)
  return { start, end }
}

/**
 * Serves an asset's file by id, whole, or in part when the browser asks for a range (an audio player
 * seeking does). `?download` sends it
 * as an attachment under its file name.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/media/[id]">) {
  const parsed = paramValidator.safeParse(await ctx.params)
  if (!parsed.success) return new Response(null, { status: 404 })

  const [asset] = await db
    .select({
      root: schema.assets.root,
      path: schema.assets.path,
      mime: schema.assets.mime
    })
    .from(schema.assets)
    .where(eq(schema.assets.id, parsed.data.id))
    .limit(1)
  if (!asset) return new Response(null, { status: 404 })

  const filePath = assetFilePath(asset)
  if (!filePath) return new Response(null, { status: 403 })

  const stats = await fs.promises.stat(filePath).catch(() => null)
  if (!stats?.isFile()) return new Response(null, { status: 404 })

  const size = stats.size
  const headers: Record<string, string> = {
    "Content-Type": asset.mime,
    "Accept-Ranges": "bytes",
    "Cache-Control": CACHE_CONTROL
  }
  if (request.nextUrl.searchParams.has("download")) {
    headers["Content-Disposition"] = `attachment; filename="${assetFileName(asset.path)}"`
  }

  const rangeHeader = request.headers.get("range")
  if (!rangeHeader) {
    return new Response(readFileStream(filePath, request.signal), {
      headers: { ...headers, "Content-Length": String(size) }
    })
  }

  const { start, end } = parseRange(rangeHeader, size)
  if (start >= size || start > end) {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${size}` }
    })
  }

  return new Response(readFileStream(filePath, request.signal, { start, end }), {
    status: 206,
    headers: {
      ...headers,
      "Content-Length": String(end - start + 1),
      "Content-Range": `bytes ${start}-${end}/${size}`
    }
  })
}
