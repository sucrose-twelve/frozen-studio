"use client"

import { Button, toast } from "@heroui/react"
import {
  ImagePlus,
  RefreshCw,
  Scissors,
  SlidersHorizontal,
  VideoSparkles
} from "@keyline-icons/react"
import { useCallback, useState } from "react"

import { createJob, rerollJob } from "@/actions/jobs/create"
import type { AssetView, JobDetail } from "@/actions/jobs/read"
import { useStore } from "@/hooks"

import { useStudioQuery } from "../hooks/use-studio-query"
import { DownloadButton, FavoriteButton } from "./asset-buttons"
import { DeleteJobButton } from "./delete-job-button"

const ICON = { size: 15, strokeWidth: 1.75 } as const

/**
 * What can be done with a finished job: roll it again, reuse its settings, delete it. With a result on the
 * canvas there is more: send the image on to another form, download it, keep it.
 *
 * @param asset - The image or video currently shown. Left out where a job shows all its results at once
 *   (voice clips), each with its own buttons
 */
export function ResultActions({
  job,
  asset = null
}: Readonly<{
  job: JobDetail
  asset?: AssetView | null
}>) {
  const { showJob } = useStudioQuery()
  const requestPrefill = useStore((state) => state.requestPrefill)
  const [pending, setPending] = useState<"reroll" | "cutout" | null>(null)

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
  const handleUseAsReference = useCallback(() => {
    if (asset) requestPrefill({ kind: "image", references: [asset], source: null })
  }, [asset, requestPrefill])
  const handleAnimate = useCallback(() => {
    if (asset) requestPrefill({ kind: "video", references: [asset], source: null })
  }, [asset, requestPrefill])

  const handleCutout = useCallback(async () => {
    if (!asset) return

    setPending("cutout")
    const result = await createJob({ kind: "cutout", references: [asset.id] })
    setPending(null)

    if (result.ok) void showJob(result.ids[0] ?? null)
    else toast.danger(result.message)
  }, [asset, showJob])

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

      {asset?.kind === "image" ? (
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

      {asset ? <DownloadButton asset={asset} /> : null}

      <div className='ml-auto flex items-center gap-2'>
        {asset ? <FavoriteButton asset={asset} /> : null}
        <DeleteJobButton jobId={job.id} />
      </div>
    </div>
  )
}
