"use client"

import { Button, Chip, Modal } from "@heroui/react"
import { GridSquares } from "@keyline-icons/react"
import Image from "next/image"
import { useMemo, useState } from "react"

import type { AssetView, JobDetail } from "@/actions/jobs/read"
import { IMAGE_SAMPLER_LABELS } from "@/constants"
import { cls, formatElapsed } from "@/libs/utils"

import { OptionGroup, type Option } from "./option-group"
import { ResultActions } from "./result-actions"
import { SpriteSheet } from "./sprite-sheet"

type Variant = "original" | "cutout"

const VARIANT_OPTIONS: Option<Variant>[] = [
  { value: "original", label: "Original" },
  { value: "cutout", label: "Cutout" }
]

/**
 * The facts worth a chip under a result: its size, the settings that shaped it, the seed and the run time.
 */
function describe(job: JobDetail, asset: AssetView) {
  const facts = [`${asset.width} × ${asset.height}`]
  const params = job.params

  if (params.kind === "image") {
    facts.push(`${params.steps} steps · CFG ${params.cfg}`)
    // Only a sampler that was picked by hand is worth a chip; "Auto" is the usual case
    if (params.sampler) facts.push(IMAGE_SAMPLER_LABELS[params.sampler])
    facts.push(`seed ${params.seed}`)
  }
  if (params.kind === "video") {
    facts.push(
      `${params.seconds}s · ${params.resolution}p`,
      params.isFast ? "fast" : `${params.steps} steps`,
      `seed ${params.seed}`
    )
  }
  if (job.startedAt && job.finishedAt) {
    facts.push(formatElapsed(job.finishedAt - job.startedAt))
  }

  return facts
}

/**
 * Where the canvas opens: on the result a link named, else on the job's first one. A cutout job opens on
 * its cutout, since that is what it made.
 */
function initialView(
  job: JobDetail,
  originals: AssetView[],
  assetId: string | null
): { index: number; variant: Variant } {
  const cutoutIndex = job.cutouts.findIndex((asset) => asset.id === assetId)
  if (cutoutIndex >= 0) return { index: cutoutIndex, variant: "cutout" }

  const originalIndex = originals.findIndex((asset) => asset.id === assetId)
  if (originalIndex >= 0) return { index: originalIndex, variant: "original" }

  return { index: 0, variant: job.kind === "cutout" ? "cutout" : "original" }
}

/**
 * The canvas for a finished job: the result itself, a strip to pick between several, the actions, and for a
 * video with saved frames the sprite sheet builder.
 *
 * A job's images come in up to two variants, the original and its cutout, paired by position. A cutout job
 * pairs its result with the image it was given.
 *
 * @param assetId - The result to open on, when the link named one
 */
export function JobResult({
  job,
  assetId
}: Readonly<{
  job: JobDetail
  assetId: string | null
}>) {
  const originals = job.kind === "cutout" ? job.inputs : job.outputs
  const hasCutouts = job.cutouts.length > 0
  const [initial] = useState(() => initialView(job, originals, assetId))
  const [index, setIndex] = useState(initial.index)
  const [variant, setVariant] = useState<Variant>(initial.variant)

  const shown = variant === "cutout" && hasCutouts ? job.cutouts : originals
  const asset = shown[Math.min(index, shown.length - 1)] ?? originals[0] ?? job.cutouts[0]
  const facts = useMemo(() => (asset ? describe(job, asset) : []), [job, asset])
  const hasAlpha = asset?.role === "cutout"
  const framesHaveAlpha = job.params.kind === "video" && job.params.shouldRemoveBackground

  if (!asset) {
    return (
      <div className='text-muted grid min-h-0 flex-1 place-items-center p-6 text-sm'>
        This job finished without a result to show.
      </div>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='use-dot-grid relative flex min-h-56 flex-1 items-center justify-center overflow-hidden p-4'>
        {asset.kind === "video" ? (
          <video
            key={asset.id}
            src={asset.url}
            poster={job.still?.url ?? job.inputs[0]?.url}
            controls
            loop
            autoPlay
            muted
            playsInline
            className='max-h-full max-w-full rounded-xl object-contain shadow-2xl shadow-black/40'
          />
        ) : (
          // The canvas shows the file itself, at full quality; `next/image` would hand back a resized copy
          <img
            key={asset.id}
            src={asset.url}
            alt={job.prompt || "Result"}
            width={asset.width}
            height={asset.height}
            className={cls(
              "h-auto max-h-full w-auto max-w-full rounded-xl object-contain shadow-2xl shadow-black/40",
              hasAlpha && "use-checkerboard"
            )}
          />
        )}

        {hasCutouts && originals.length > 0 ? (
          <div className='bg-surface/90 absolute top-3 right-3 w-44 rounded-full p-1 backdrop-blur'>
            <OptionGroup
              label='Variant'
              value={variant}
              options={VARIANT_OPTIONS}
              onChange={setVariant}
            />
          </div>
        ) : null}
      </div>

      <div className='border-separator flex flex-col gap-3 border-t p-4'>
        {shown.length > 1 ? (
          <ul className='flex gap-2 overflow-x-auto'>
            {shown.map((item, itemIndex) => (
              <li key={item.id}>
                <button
                  type='button'
                  aria-label={`Show image ${itemIndex + 1}`}
                  aria-pressed={item.id === asset.id}
                  onClick={() => setIndex(itemIndex)}
                  className={cls(
                    "bg-surface-secondary block size-14 overflow-hidden rounded-lg border-2 transition-colors",
                    item.id === asset.id
                      ? "border-accent"
                      : "hover:border-glacier border-transparent"
                  )}>
                  <Image
                    src={item.url}
                    alt=''
                    width={item.width}
                    height={item.height}
                    sizes='56px'
                    quality={75}
                    className='size-full object-cover'
                  />
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className='flex flex-wrap items-center gap-1.5'>
          {facts.map((fact) => (
            <Chip key={fact} size='sm' variant='soft' className='font-mono text-[11px]'>
              {fact}
            </Chip>
          ))}
        </div>

        {job.prompt ? (
          <p className='text-muted line-clamp-2 text-sm' title={job.prompt}>
            {job.prompt}
          </p>
        ) : null}

        <ResultActions key={asset.id} job={job} asset={asset} />

        {job.frames.length > 0 ? (
          <Modal>
            <Button variant='secondary' size='sm' className='self-start'>
              <GridSquares size={15} strokeWidth={1.75} />
              Sprite sheet · {job.frames.length} frames
            </Button>
            <Modal.Backdrop>
              <Modal.Container size='lg'>
                <Modal.Dialog className='sm:max-w-5xl'>
                  <Modal.CloseTrigger />
                  <Modal.Header>
                    <Modal.Heading>Sprite sheet</Modal.Heading>
                  </Modal.Header>
                  <Modal.Body>
                    <SpriteSheet
                      name={`sprite-${job.id.slice(0, 8)}`}
                      frames={job.frames}
                      hasAlpha={framesHaveAlpha}
                    />
                  </Modal.Body>
                </Modal.Dialog>
              </Modal.Container>
            </Modal.Backdrop>
          </Modal>
        ) : null}
      </div>
    </div>
  )
}
