"use client"

import { Button, Input, Spinner, toast } from "@heroui/react"
import { Download } from "@keyline-icons/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { AssetView } from "@/actions/jobs/read"
import { describeSpriteSheet, recordPreview, saveBlob } from "@/libs/sprite-sheet"
import { cls } from "@/libs/utils"
import { createZip } from "@/libs/zip"

import { FieldRow } from "./form-parts"
import { OptionGroup, type Option } from "./option-group"

/**
 * A sheet of about this many frames is what the builder starts with, however long the video is.
 */
const TARGET_FRAMES = 32

const SCALE_OPTIONS: Option<number>[] = [
  { value: 1, label: "100%" },
  { value: 0.5, label: "50%" },
  { value: 0.25, label: "25%" }
]

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("A frame failed to load"))
    image.src = url
  })
}

function toBytes(canvas: HTMLCanvasElement) {
  return new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error("The sheet could not be encoded"))

      blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
    }, "image/png")
  })
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

/**
 * Lays frames out on a canvas, left to right, top to bottom.
 *
 * @returns The cell size and grid used
 * @throws {Error} When the browser gives no 2D context to draw with
 */
function drawSheet(
  canvas: HTMLCanvasElement,
  frames: HTMLImageElement[],
  columns: number,
  scale: number
) {
  const first = frames[0]
  const cellWidth = Math.round(first.naturalWidth * scale)
  const cellHeight = Math.round(first.naturalHeight * scale)
  const usedColumns = Math.min(columns, frames.length)
  const rows = Math.ceil(frames.length / usedColumns)

  canvas.width = cellWidth * usedColumns
  canvas.height = cellHeight * rows
  const context = canvas.getContext("2d")
  if (!context) throw new Error("This browser can't draw to a canvas")

  context.clearRect(0, 0, canvas.width, canvas.height)
  frames.forEach((frame, index) => {
    context.drawImage(
      frame,
      (index % usedColumns) * cellWidth,
      Math.floor(index / usedColumns) * cellHeight,
      cellWidth,
      cellHeight
    )
  })

  return { cellWidth, cellHeight, columns: usedColumns, rows }
}

/**
 * Builds a sprite sheet from a video's saved frames, in the browser: pick every Nth frame, a starting frame,
 * the number of columns and a scale, watch the selection loop, and download the result.
 *
 * The download is one zip: the sheet as a PNG, a README with the frame count, speed and grid (what a game
 * engine asks for when slicing it), and the loop as a short WebM to look at without an engine.
 *
 * @param name - The base name of the exported files
 * @param frames - The frames in order
 * @param fps - The frame rate of the video they come from, which depends on the model that made it
 * @param hasAlpha - Whether the frames are cut out, which puts a checkerboard behind the previews
 */
export function SpriteSheet({
  name,
  frames,
  fps,
  hasAlpha
}: Readonly<{
  name: string
  frames: AssetView[]
  fps: number
  hasAlpha: boolean
}>) {
  const sheetRef = useRef<HTMLCanvasElement>(null)
  const loopRef = useRef<HTMLCanvasElement>(null)
  const [images, setImages] = useState<HTMLImageElement[] | null>(null)
  const [hasFailed, setHasFailed] = useState(false)
  const [every, setEvery] = useState(() =>
    Math.max(1, Math.ceil(frames.length / TARGET_FRAMES))
  )
  const [start, setStart] = useState(1)
  const [columns, setColumns] = useState(8)
  const [scale, setScale] = useState(0.5)
  const [info, setInfo] = useState("")
  const [isPacking, setIsPacking] = useState(false)

  const selected = useMemo(
    () =>
      (images ?? []).filter(
        (_, index) => index >= start - 1 && (index - (start - 1)) % every === 0
      ),
    [images, start, every]
  )
  const framesPerSecond = fps / every

  const handleEveryChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setEvery(clamp(event.target.valueAsNumber, 1, 64)),
    []
  )
  const handleStartChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setStart(clamp(event.target.valueAsNumber, 1, frames.length)),
    [frames.length]
  )
  const handleColumnsChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      setColumns(clamp(event.target.valueAsNumber, 1, 64)),
    []
  )

  const handleDownload = useCallback(async () => {
    if (selected.length === 0) return

    setIsPacking(true)
    try {
      // Drawn again off screen: the canvas on the page is the same pixels, but this keeps the two apart
      const canvas = document.createElement("canvas")
      const sheet = drawSheet(canvas, selected, columns, scale)
      const frameSize = { width: sheet.cellWidth, height: sheet.cellHeight }
      const [image, preview] = await Promise.all([
        toBytes(canvas),
        recordPreview(selected, frameSize, framesPerSecond)
      ])

      const previewName = preview ? `${name}-preview.webm` : null
      const readme = describeSpriteSheet({
        name,
        frames: selected.length,
        fps: framesPerSecond,
        columns: sheet.columns,
        rows: sheet.rows,
        frameWidth: sheet.cellWidth,
        frameHeight: sheet.cellHeight,
        hasAlpha,
        source: { fps, every, start },
        preview: previewName
      })

      const files = [
        { name: `${name}.png`, data: image },
        { name: `${name}.md`, data: new TextEncoder().encode(readme) }
      ]
      if (preview && previewName) {
        files.push({
          name: previewName,
          data: new Uint8Array(await preview.arrayBuffer())
        })
      }

      saveBlob(createZip(files), `${name}.zip`)
    } catch (error) {
      toast.danger(
        error instanceof Error ? error.message : "The sprite sheet could not be packed"
      )
    } finally {
      setIsPacking(false)
    }
  }, [selected, columns, scale, framesPerSecond, name, hasAlpha, fps, every, start])

  useEffect(() => {
    let isCurrent = true
    Promise.all(frames.map((frame) => loadImage(frame.url)))
      .then((loaded) => {
        if (isCurrent) setImages(loaded)
      })
      .catch(() => {
        if (isCurrent) setHasFailed(true)
      })

    return () => {
      isCurrent = false
    }
  }, [frames])

  useEffect(() => {
    if (!sheetRef.current || selected.length === 0) return

    const sheet = drawSheet(sheetRef.current, selected, columns, scale)
    setInfo(
      `${selected.length} frames · ${sheet.cellWidth} × ${sheet.cellHeight} px each · ${sheet.columns} × ${sheet.rows} grid · ${framesPerSecond.toFixed(1)} fps`
    )
  }, [selected, columns, scale, framesPerSecond])

  useEffect(() => {
    const canvas = loopRef.current
    const first = selected[0]
    if (!canvas || !first) return

    canvas.width = Math.min(220, first.naturalWidth)
    canvas.height = Math.round((canvas.width * first.naturalHeight) / first.naturalWidth)
    const context = canvas.getContext("2d")
    if (!context) return

    let index = 0
    const timer = setInterval(() => {
      context.clearRect(0, 0, canvas.width, canvas.height)
      context.drawImage(
        selected[index % selected.length],
        0,
        0,
        canvas.width,
        canvas.height
      )
      index += 1
    }, 1_000 / framesPerSecond)

    return () => clearInterval(timer)
  }, [selected, framesPerSecond])

  if (hasFailed) {
    return <p className='text-danger text-sm'>The frames could not be loaded.</p>
  }
  if (!images) {
    return (
      <p className='text-muted flex items-center gap-2 text-sm'>
        <Spinner size='sm' color='current' />
        Loading {frames.length} frames
      </p>
    )
  }

  return (
    <div className='flex flex-col gap-4'>
      <div className='grid grid-cols-2 gap-3 sm:grid-cols-[5rem_5rem_5rem_1fr]'>
        <FieldRow label='Every Nth'>
          <Input
            aria-label='Use every Nth frame'
            type='number'
            variant='secondary'
            min={1}
            max={64}
            value={String(every)}
            onChange={handleEveryChange}
          />
        </FieldRow>
        <FieldRow label='Start at'>
          <Input
            aria-label='First frame'
            type='number'
            variant='secondary'
            min={1}
            max={frames.length}
            value={String(start)}
            onChange={handleStartChange}
          />
        </FieldRow>
        <FieldRow label='Columns'>
          <Input
            aria-label='Columns'
            type='number'
            variant='secondary'
            min={1}
            max={64}
            value={String(columns)}
            onChange={handleColumnsChange}
          />
        </FieldRow>
        <FieldRow label='Scale'>
          <OptionGroup
            label='Scale'
            value={scale}
            options={SCALE_OPTIONS}
            onChange={setScale}
          />
        </FieldRow>
      </div>

      <div className='flex flex-wrap items-start gap-4'>
        <figure className='flex flex-col gap-1.5'>
          <canvas
            ref={loopRef}
            className={cls("rounded-lg", hasAlpha ? "use-checkerboard" : "bg-night")}
          />
          <figcaption className='text-muted text-xs'>Loop preview</figcaption>
        </figure>
        <figure className='flex min-w-0 flex-1 flex-col gap-1.5'>
          <canvas
            ref={sheetRef}
            className={cls(
              "max-h-80 max-w-full rounded-lg object-contain",
              hasAlpha ? "use-checkerboard" : "bg-night"
            )}
          />
          <figcaption className='text-muted text-xs'>{info}</figcaption>
        </figure>
      </div>

      <div className='flex flex-wrap items-center gap-3'>
        <Button
          variant='secondary'
          size='sm'
          isPending={isPacking}
          onPress={handleDownload}>
          <Download size={15} strokeWidth={1.75} />
          Download sprite sheet
        </Button>
        <p className='text-muted text-xs'>
          {isPacking
            ? "Recording the preview, which takes as long as the loop does."
            : "A zip with the sheet (PNG), a README with the frame count and speed, and a preview (WebM)."}
        </p>
      </div>
    </div>
  )
}
