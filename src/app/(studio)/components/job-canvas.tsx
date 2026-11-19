"use client"

import { Button, Spinner, toast } from "@heroui/react"
import { CircleAlert, CircleSlash, ImageSparkles, RefreshCw } from "@keyline-icons/react"
import { useCallback, useState } from "react"

import { rerollJob } from "@/actions/jobs/create"
import type { JobDetail } from "@/actions/jobs/read"
import { ACTIVE_JOB_STATUSES } from "@/constants"
import { useStore } from "@/hooks"

import { useStudioQuery } from "../hooks/use-studio-query"
import { DeleteJobButton } from "./delete-job-button"
import { JobProgress } from "./job-progress"
import { JobResult } from "./job-result"

/**
 * A centred message on the canvas, for the states that have nothing to show.
 */
function Notice({
  icon,
  title,
  children
}: Readonly<{
  icon: React.ReactNode
  title: string
  children?: React.ReactNode
}>) {
  return (
    <div className='grid min-h-0 flex-1 place-items-center p-6'>
      <div className='flex max-w-md flex-col items-center gap-3 text-center'>
        <span className='text-muted'>{icon}</span>
        <h2 className='text-lg font-semibold'>{title}</h2>
        {children}
      </div>
    </div>
  )
}

/**
 * The right panel's main area: whatever state the selected job is in.
 *
 * The job comes from the server; the event stream may know more by now (it started, it finished), so the
 * live status wins. When it says the job is done but the server data is older, the page is already
 * refreshing, and a spinner bridges the moment.
 *
 * @param assetId - The result to open on, when the link named one
 */
export function JobCanvas({
  job,
  assetId
}: Readonly<{
  job: JobDetail | null
  assetId: string | null
}>) {
  const live = useStore((state) => (job ? state.jobs[job.id] : undefined))
  const { showJob } = useStudioQuery()
  const [isRetrying, setIsRetrying] = useState(false)

  const handleRetry = useCallback(async () => {
    if (!job) return

    setIsRetrying(true)
    const result = await rerollJob({ id: job.id })
    setIsRetrying(false)

    if (result.ok) void showJob(result.id)
    else toast.danger(result.message)
  }, [job, showJob])

  if (!job) {
    return (
      <Notice
        icon={<ImageSparkles size={40} strokeWidth={1.25} />}
        title='Nothing here yet'>
        <p className='text-muted text-sm'>
          Describe an image or a video on the left and generate it. Results land here, and
          stay in the gallery.
        </p>
      </Notice>
    )
  }

  const status = live?.status ?? job.status
  // A job that stopped short has nothing to keep, so the way out is to run it again or clear it away
  const recovery = (
    <div className='flex items-center gap-2'>
      <Button variant='secondary' size='sm' isPending={isRetrying} onPress={handleRetry}>
        <RefreshCw size={15} strokeWidth={1.75} />
        Try again
      </Button>
      <DeleteJobButton jobId={job.id} isLabeled />
    </div>
  )

  if (ACTIVE_JOB_STATUSES.includes(status)) {
    return <JobProgress job={job} status={status} progress={live?.progress ?? null} />
  }
  if (status === "failed") {
    return (
      <Notice
        icon={<CircleAlert size={36} strokeWidth={1.5} className='text-danger' />}
        title='This job failed'>
        <pre className='bg-field text-muted max-h-48 w-full overflow-auto rounded-lg p-3 text-left text-xs whitespace-pre-wrap'>
          {live?.error ?? job.error ?? "No reason was recorded."}
        </pre>
        {recovery}
      </Notice>
    )
  }
  if (status === "canceled") {
    return (
      <Notice
        icon={<CircleSlash size={36} strokeWidth={1.5} />}
        title='This job was canceled'>
        {recovery}
      </Notice>
    )
  }
  if (job.status !== "succeeded") {
    return (
      <Notice icon={<Spinner size='lg' color='current' />} title='Loading the result' />
    )
  }

  return <JobResult job={job} assetId={assetId} />
}
