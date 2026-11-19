"use client"

import { Button, toast } from "@heroui/react"
import {
  Download,
  ImagePlus,
  RefreshCw,
  Scissors,
  SlidersHorizontal,
  Star,
  VideoSparkles
} from "@keyline-icons/react"
import { Star as StarFilled } from "@keyline-icons/react/fill"
import { useCallback, useState } from "react"

import { updateFavorite } from "@/actions/assets/update"
import { createJob, rerollJob } from "@/actions/jobs/create"
import type { AssetView, JobDetail } from "@/actions/jobs/read"
import { useStore } from "@/hooks"

import { useStudioQuery } from "../hooks/use-studio-query"
import { DeleteJobButton } from "./delete-job-button"

const ICON = { size: 15, strokeWidth: 1.75 } as const

/**
 * What can be done with the result on the canvas: roll it again, reuse its settings, send the image on to
 * another form, download it, keep it, or delete the job.
 *
 * @param asset - The image or video currently shown
 */
export function ResultActions({
  job,
  asset
}: Readonly<{
  job: JobDetail
  asset: AssetView
}>) {
  const { showJob } = useStudioQuery()
  const requestPrefill = useStore((state) => state.requestPrefill)
  const [isFavorite, setIsFavorite] = useState(asset.isFavorite)
  const [pending, setPending] = useState<"reroll" | "cutout" | null>(null)
  const isImage = asset.kind === "image"

  const handleReroll = useCallback(async () => {
    setPending("reroll")
    const result = await rerollJob({ id: job.id })
    setPending(null)

    if (result.ok) void showJob(result.id)
    else toast.danger(result.message)
  }, [job.id, showJob])

  const handleReuse = useCallback(
    () => requestPrefill({ kind: job.kind, references: job.inputs, source: job }),
    [job, requestPrefill]
  )
  const handleUseAsReference = useCallback(
    () => requestPrefill({ kind: "image", references: [asset], source: null }),
    [asset, requestPrefill]
  )
  const handleAnimate = useCallback(
    () => requestPrefill({ kind: "video", references: [asset], source: null }),
    [asset, requestPrefill]
  )

  const handleCutout = useCallback(async () => {
    setPending("cutout")
    const result = await createJob({ kind: "cutout", references: [asset.id] })
    setPending(null)

    if (result.ok) void showJob(result.ids[0] ?? null)
    else toast.danger(result.message)
  }, [asset.id, showJob])

  const handleDownload = useCallback(() => {
    const link = document.createElement("a")
    link.href = `${asset.url}?download`
    link.download = asset.name
    link.click()
  }, [asset.url, asset.name])

  const handleFavorite = useCallback(async () => {
    const next = !isFavorite
    setIsFavorite(next)

    const result = await updateFavorite({ id: asset.id, isFavorite: next })
    if (!result.ok) {
      setIsFavorite(!next)
      toast.danger(result.message)
    }
  }, [asset.id, isFavorite])

  return (
    <div className='flex flex-wrap items-center gap-2'>
      <Button
        variant='secondary'
        size='sm'
        isPending={pending === "reroll"}
        onPress={handleReroll}>
        <RefreshCw {...ICON} />
        Reroll
      </Button>
      <Button variant='secondary' size='sm' onPress={handleReuse}>
        <SlidersHorizontal {...ICON} />
        Reuse settings
      </Button>

      {isImage ? (
        <>
          <Button variant='secondary' size='sm' onPress={handleUseAsReference}>
            <ImagePlus {...ICON} />
            Use as reference
          </Button>
          <Button variant='secondary' size='sm' onPress={handleAnimate}>
            <VideoSparkles {...ICON} />
            Animate
          </Button>
          {asset.role === "cutout" ? null : (
            <Button
              variant='secondary'
              size='sm'
              isPending={pending === "cutout"}
              onPress={handleCutout}>
              <Scissors {...ICON} />
              Cut out
            </Button>
          )}
        </>
      ) : null}

      <Button variant='secondary' size='sm' onPress={handleDownload}>
        <Download {...ICON} />
        Download
      </Button>

      <div className='ml-auto flex items-center gap-2'>
        <Button
          variant='tertiary'
          size='sm'
          isIconOnly
          aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
          aria-pressed={isFavorite}
          onPress={handleFavorite}>
          {isFavorite ? (
            <StarFilled {...ICON} className='text-warning' />
          ) : (
            <Star {...ICON} />
          )}
        </Button>
        <DeleteJobButton jobId={job.id} />
      </div>
    </div>
  )
}
