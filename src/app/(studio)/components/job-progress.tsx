"use client"

import { Button, ProgressBar, toast } from "@heroui/react"
import { X } from "@keyline-icons/react"
import { useCallback, useEffect, useState } from "react"

import type { JobDetail } from "@/actions/jobs/read"
import { cancelJob } from "@/actions/jobs/update"
import { JOB_KIND_LABELS } from "@/constants"
import { formatElapsed } from "@/libs/utils"

/**
 * The canvas while a job waits or runs: what the engine is doing, how far along, for how long, and a way
 * out.
 *
 * @param progress - The latest progress event, or `null` before the first one
 */
export function JobProgress({
  job,
  status,
  progress
}: Readonly<{
  job: JobDetail
  status: Media.JobStatus
  progress: Engine.Progress | null
}>) {
  const isRunning = status === "running"
  // The server may have rendered this job before it started; time it from when it is first seen running
  const [startedAt, setStartedAt] = useState<number | null>(job.startedAt)
  const [now, setNow] = useState(() => Date.now())
  const [isCanceling, setIsCanceling] = useState(false)

  const hasSteps = !!progress && progress.max > 1
  const percentage = hasSteps ? Math.round((progress.value / progress.max) * 100) : 0
  const label =
    progress?.label ?? (isRunning ? "Starting" : "Waiting in line for the engine")

  const handleCancel = useCallback(async () => {
    setIsCanceling(true)
    const result = await cancelJob({ id: job.id })
    if (!result.ok) {
      toast.danger(result.message)
      setIsCanceling(false)
    }
  }, [job.id])

  useEffect(() => {
    if (isRunning && startedAt === null) setStartedAt(Date.now())
  }, [isRunning, startedAt])

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  return (
    <div className='grid min-h-0 flex-1 place-items-center p-6'>
      <div className='flex w-full max-w-md flex-col gap-4'>
        <div className='flex items-baseline justify-between gap-4'>
          <h2 className='text-lg font-semibold'>
            {isRunning ? "Generating" : "Queued"} · {JOB_KIND_LABELS[job.kind]}
          </h2>
          <span className='text-muted font-mono text-sm tabular-nums'>
            {startedAt ? formatElapsed(now - startedAt) : "0:00"}
          </span>
        </div>

        <ProgressBar
          aria-label='Progress'
          size='sm'
          value={percentage}
          isIndeterminate={!hasSteps}>
          <ProgressBar.Track>
            <ProgressBar.Fill />
          </ProgressBar.Track>
        </ProgressBar>

        <p className='text-muted text-sm'>
          {label}
          {hasSteps ? ` · ${progress.value} / ${progress.max}` : ""}
        </p>

        {job.prompt ? (
          <p className='border-separator text-muted line-clamp-3 border-l-2 pl-3 text-sm italic'>
            {job.prompt}
          </p>
        ) : null}

        <div>
          <Button
            variant='tertiary'
            size='sm'
            isPending={isCanceling}
            onPress={handleCancel}>
            <X size={15} strokeWidth={2} />
            Cancel
          </Button>
        </div>
      </div>
    </div>
  )
}
