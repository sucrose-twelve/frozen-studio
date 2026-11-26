"use client"

import { Button, toast } from "@heroui/react"
import {
  ImagePlus,
  RefreshCw,
  ScanText,
  Scissors,
  SlidersHorizontal
} from "@keyline-icons/react"
import { usePathname, useRouter } from "next/navigation"
import { useCallback, useState } from "react"

import { createJob, rerollJob } from "@/actions/jobs/create"
import type { AssetView, JobDetail } from "@/actions/jobs/read"
import { isStudioMode } from "@/libs/job"

import { usePrefill } from "../hooks/use-prefill"
import { useStudioQuery } from "../hooks/use-studio-query"
import { isLastResultOf } from "../utils"
import { DownloadButton, FavoriteButton } from "./asset-buttons"
import { DeleteAssetButton } from "./delete-asset-button"
import { DeleteJobButton } from "./delete-job-button"

const ICON = { size: 15, strokeWidth: 1.75 } as const

/**
 * What can be done with a finished job: roll it again, reuse its settings, delete it. With a result on the
 * canvas there is more: send the image on to another form, download it, keep it, and delete only that image
 * (the job's other results stay).
 *
 * A job these start (a reroll, a cutout) shows on the studio's canvas, so from another page (the gallery's
 * viewer) they go to the studio.
 *
 * @param asset - The image currently shown. Left out where a job shows all its results at once
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
  const requestPrefill = usePrefill()
  const router = useRouter()
  const pathname = usePathname()
  const [pending, setPending] = useState<"reroll" | "cutout" | null>(null)

  const openJob = useCallback(
    (id: string | null, mode: Media.StudioMode) => {
      if (pathname === "/") void showJob(id)
      else if (id) router.push(`/?job=${id}&mode=${mode}`)
    },
    [pathname, showJob, router]
  )

  const handleReroll = useCallback(async () => {
    setPending("reroll")
    const result = await rerollJob({ id: job.id })
    setPending(null)

    // A caption's result is text, and chat jobs never reach here: a reroll of those shows on the Image form
    if (result.ok) openJob(result.id, isStudioMode(job.kind) ? job.kind : "image")
    else toast.danger(result.message)
  }, [job.id, job.kind, openJob])

  const handleReuse = useCallback(
    () => requestPrefill({ kind: job.kind, references: job.inputs, source: job }),
    [job, requestPrefill]
  )
  const handleUseAsReference = useCallback(() => {
    if (asset) requestPrefill({ kind: "image", references: [asset], source: null })
  }, [asset, requestPrefill])

  const handleDescribe = useCallback(() => {
    if (asset) requestPrefill({ kind: "caption", references: [asset], source: null })
  }, [asset, requestPrefill])

  const handleCutout = useCallback(async () => {
    if (!asset) return

    setPending("cutout")
    const result = await createJob({ kind: "cutout", references: [asset.id] })
    setPending(null)

    if (result.ok) openJob(result.ids[0] ?? null, "cutout")
    else toast.danger(result.message)
  }, [asset, openJob])

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
          <Button variant='secondary' size='sm' onPress={handleDescribe}>
            <ScanText {...ICON} />
            Describe
          </Button>
        </>
      ) : null}

      {asset ? <DownloadButton asset={asset} /> : null}

      <div className='ml-auto flex items-center gap-2'>
        {asset ? <FavoriteButton asset={asset} /> : null}
        {asset?.kind === "image" ? (
          <DeleteAssetButton
            asset={asset}
            isLastResult={isLastResultOf(asset, {
              outputs: job.outputs.length,
              results: job.outputs.length + job.cutouts.length
            })}
          />
        ) : (
          <DeleteJobButton jobId={job.id} />
        )}
      </div>
    </div>
  )
}
