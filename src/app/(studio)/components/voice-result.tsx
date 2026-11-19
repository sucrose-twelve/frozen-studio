"use client"

import { Chip } from "@heroui/react"
import { useMemo } from "react"

import type { JobDetail } from "@/actions/jobs/read"
import { scriptLines } from "@/libs/job"
import { cls, formatElapsed, pad2 } from "@/libs/utils"

import { voiceLabel } from "../utils"
import { DownloadButton, FavoriteButton } from "./asset-buttons"
import { ResultActions } from "./result-actions"

/**
 * The canvas for a finished voice job: every clip with the line it speaks, a player, and its own download
 * and favorite buttons, since a job's clips are used one by one.
 *
 * @param assetId - The clip to point out, when the link named one
 */
export function VoiceResult({
  job,
  assetId
}: Readonly<{
  job: JobDetail
  assetId: string | null
}>) {
  const lines = useMemo(() => scriptLines(job.prompt), [job.prompt])
  const clips = job.outputs

  const facts = useMemo(() => {
    const list = [clips.length === 1 ? "1 clip" : `${clips.length} clips`]
    if (job.params.kind === "voice") {
      list.push(voiceLabel(job.params.voice), `seed ${job.params.seed}`)
    }
    if (job.startedAt && job.finishedAt) {
      list.push(formatElapsed(job.finishedAt - job.startedAt))
    }

    return list
  }, [job, clips.length])

  if (clips.length === 0) {
    return (
      <div className='text-muted grid min-h-0 flex-1 place-items-center p-6 text-sm'>
        This job finished without a clip to play.
      </div>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <ul className='use-dot-grid flex min-h-56 flex-1 flex-col gap-3 overflow-y-auto p-4'>
        {clips.map((clip) => (
          <li
            key={clip.id}
            className={cls(
              "use-panel mx-auto flex w-full max-w-3xl flex-col gap-2.5 p-3",
              clip.id === assetId && "border-accent"
            )}>
            <div className='flex items-start gap-3'>
              <span className='text-muted pt-1 font-mono text-xs tabular-nums'>
                {pad2(clip.position + 1)}
              </span>
              <p lang='ja' className='min-w-0 flex-1 pt-0.5 text-sm leading-relaxed'>
                {lines[clip.position] ?? ""}
              </p>
              <div className='flex shrink-0 items-center gap-1'>
                <DownloadButton asset={clip} isLabeled={false} />
                <FavoriteButton asset={clip} />
              </div>
            </div>
            <audio controls preload='metadata' src={clip.url} className='h-9 w-full' />
          </li>
        ))}
      </ul>

      <div className='border-separator flex flex-col gap-3 border-t p-4'>
        <div className='flex flex-wrap items-center gap-1.5'>
          {facts.map((fact) => (
            <Chip key={fact} size='sm' variant='soft' className='font-mono text-[11px]'>
              {fact}
            </Chip>
          ))}
        </div>

        <ResultActions job={job} />
      </div>
    </div>
  )
}
