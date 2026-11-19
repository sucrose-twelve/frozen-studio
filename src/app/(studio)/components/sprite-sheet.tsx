"use client"

import { Button, Input, Spinner } from "@heroui/react"
import { Download } from "@keyline-icons/react"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import type { AssetView } from "@/actions/jobs/read"
import { VIDEO_FPS } from "@/constants"
import { cls } from "@/libs/utils"

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

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min))
}

/**
 * Lays frames out on a canvas, left to right, top to bottom.
 *
 * @returns The cell size and grid used
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
  const context = canvas.getContext("2d")!
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
 * the number of columns and a scale, watch the selection loop, and download the sheet as one PNG.
 *
 * @param frames - The frames in order
 * @param hasAlpha - Whether the frames are cut out, which puts a checkerboard behind the previews
 */
export function SpriteSheet({
  frames,
  hasAlpha
}: Readonly<{
  frames: AssetView[]
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

  const selected = useMemo(
    () =>
      (images ?? []).filter(
        (_, index) => index >= start - 1 && (index - (start - 1)) % every === 0
      ),
    [images, start, every]
  )
  const framesPerSecond = VIDEO_FPS / every

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

  const handleDownload = useCallback(() => {
    if (selected.length === 0) return

    // Drawn again at full size: the on-screen canvas is the same pixels, but this keeps the two apart
    const canvas = document.createElement("canvas")
    drawSheet(canvas, selected, columns, scale)
    canvas.toBlob((blob) => {
      if (!blob) return

      const url = URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = `spritesheet-${selected.length}f.png`
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 5_000)
    }, "image/png")
  }, [selected, columns, scale])

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
    const context = canvas.getContext("2d")!
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

      <div>
        <Button variant='secondary' size='sm' onPress={handleDownload}>
          <Download size={15} strokeWidth={1.75} />
          Download sprite sheet
        </Button>
      </div>
    </div>
  )
}
