"use client"

import { ProgressBar, toast, type HeroUIToastOptions } from "@heroui/react"
import { Clock } from "@keyline-icons/react"
import { useRouter } from "next/navigation"
import { useEffect, useRef } from "react"

import { cancelJob } from "@/actions/jobs/update"
import { ACTIVE_JOB_STATUSES, JOB_KIND_LABELS, JOB_STATUS_LABELS } from "@/constants"
import { useStore } from "@/hooks"
import type { JobLive } from "@/stores/studio/state"

/**
 * How long a finished job's toast stays: long enough to notice, and to press Open.
 */
const FINISHED_TIMEOUT_MS = 6_000

/**
 * Where a job is shown: the Caption page for a caption, the studio in the job's mode for the rest.
 */
function jobPath({ id, kind }: Engine.JobBrief) {
  return kind === "caption" ? `/caption?job=${id}` : `/?job=${id}&mode=${kind}`
}

/**
 * A job's settings, one fact per line (`jobDetails`): what tells two toasts apart without the prompt.
 */
function JobDetails({ details }: Readonly<{ details: string[] }>) {
  return (
    <span className='flex flex-col'>
      {details.map((line) => (
        <span key={line} className='truncate'>
          {line}
        </span>
      ))}
    </span>
  )
}

function JobToastBody({
  details,
  status,
  progress
}: Readonly<{
  details: string[]
  status: Media.JobStatus
  progress: Engine.Progress | null
}>) {
  const hasSteps = !!progress && progress.max > 1
  const label =
    progress?.label ?? (status === "running" ? "Starting" : "Waiting for the engine")

  return (
    <span className='flex flex-col gap-1.5'>
      <JobDetails details={details} />
      {status === "running" ? (
        <ProgressBar
          aria-label='Progress'
          size='sm'
          value={hasSteps ? Math.round((progress.value / progress.max) * 100) : 0}
          isIndeterminate={!hasSteps}>
          <ProgressBar.Track>
            <ProgressBar.Fill />
          </ProgressBar.Track>
        </ProgressBar>
      ) : null}
      <span className='text-muted text-xs'>
        {label}
        {hasSteps ? ` · ${progress.value} / ${progress.max}` : ""}
      </span>
    </span>
  )
}

/**
 * The toast for a job that is still waiting or running: kept open, with its progress and a way to cancel.
 */
function activeToast(
  brief: Engine.JobBrief,
  job: JobLive & { status: Media.JobStatus }
): HeroUIToastOptions {
  return {
    description: (
      <JobToastBody details={brief.details} status={job.status} progress={job.progress} />
    ),
    isLoading: job.status === "running",
    indicator:
      job.status === "queued" ? <Clock size={16} strokeWidth={1.75} /> : undefined,
    actionProps: {
      children: "Cancel",
      variant: "tertiary",
      onPress: () => {
        void cancelJob({ id: brief.id }).then((result) => {
          if (!result.ok) toast.danger(result.message)
        })
      }
    }
  }
}

/**
 * Shows the jobs the worker has to finish as a stack of toasts, one per job: queued, then running with its
 * progress, then done, failed or canceled for a few seconds before it goes.
 *
 * Only jobs this page can name get a toast: those active when the page rendered and those queued since. A
 * toast the user closes stays closed for the rest of that job.
 */
export function JobToasts() {
  const router = useRouter()
  const jobs = useStore((state) => state.jobs)
  // Job id → its toast's key, while the job is active
  const toastKeys = useRef(new Map<string, string>())
  // Each job's state as its toast last showed it; the store replaces an entry only when it changes
  const shown = useRef(new Map<string, JobLive>())
  const closed = useRef(new Set<string>())

  useEffect(() => {
    for (const [id, job] of Object.entries(jobs)) {
      const { brief, status } = job
      if (!brief || !status || closed.current.has(id)) continue
      if (shown.current.get(id) === job) continue
      shown.current.set(id, job)

      const key = toastKeys.current.get(id)
      const title = `${JOB_KIND_LABELS[brief.kind]} · ${JOB_STATUS_LABELS[status]}`

      if (ACTIVE_JOB_STATUSES.includes(status)) {
        const options = activeToast(brief, { ...job, status })
        if (key) {
          toast.update(key, title, options)
        } else {
          const onClose = () => {
            closed.current.add(id)
            toastKeys.current.delete(id)
          }
          toastKeys.current.set(id, toast(title, { ...options, timeout: 0, onClose }))
        }
        continue
      }

      // A job that ended without ever having a toast here (it finished before this page heard of it)
      if (!key) continue
      toastKeys.current.delete(id)

      toast.update(key, title, {
        variant:
          status === "succeeded" ? "success" : status === "failed" ? "danger" : "default",
        description:
          status === "failed" ? job.error : <JobDetails details={brief.details} />,
        actionProps:
          status === "succeeded"
            ? {
                children: "Open",
                variant: "tertiary",
                onPress: () => {
                  toast.close(key)
                  router.push(jobPath(brief))
                }
              }
            : undefined,
        timeout: FINISHED_TIMEOUT_MS
      })
    }
  }, [jobs, router])

  return null
}
