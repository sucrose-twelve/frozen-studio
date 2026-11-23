"use client"

import { Spinner } from "@heroui/react"
import {
  AudioLines,
  CircleAlert,
  CircleSlash,
  ScanText,
  Scissors
} from "@keyline-icons/react"
import Image from "next/image"

import type { JobSummary } from "@/actions/jobs/read"
import { ACTIVE_JOB_STATUSES, JOB_KIND_LABELS, JOB_STATUS_LABELS } from "@/constants"
import { useStore } from "@/hooks"
import { cls } from "@/libs/utils"

import { useStudioQuery } from "../hooks/use-studio-query"

function RecentJob({
  job,
  isCurrent,
  onSelect
}: Readonly<{
  job: JobSummary
  isCurrent: boolean
  onSelect: (id: string) => void
}>) {
  const liveStatus = useStore((state) => state.jobs[job.id]?.status)
  const status = liveStatus ?? job.status
  const isActive = ACTIVE_JOB_STATUSES.includes(status)

  return (
    <li>
      <button
        type='button'
        title={job.prompt || JOB_KIND_LABELS[job.kind]}
        aria-label={`${JOB_KIND_LABELS[job.kind]} job, ${JOB_STATUS_LABELS[status]}`}
        aria-current={isCurrent}
        onClick={() => onSelect(job.id)}
        className={cls(
          "bg-surface-secondary relative block size-16 overflow-hidden rounded-xl border-2 transition-colors",
          isCurrent ? "border-accent" : "hover:border-glacier border-transparent"
        )}>
        {job.cover ? (
          <Image
            src={job.cover.url}
            alt=''
            width={job.cover.width}
            height={job.cover.height}
            sizes='64px'
            quality={75}
            className={cls("size-full object-cover", isActive && "opacity-40")}
          />
        ) : null}

        {isActive ? (
          <span className='absolute inset-0 grid place-items-center'>
            <Spinner size='sm' color='current' />
          </span>
        ) : status === "failed" ? (
          <span className='bg-night/60 text-danger absolute inset-0 grid place-items-center'>
            <CircleAlert size={20} strokeWidth={1.75} />
          </span>
        ) : status === "canceled" ? (
          <span className='bg-night/60 text-muted absolute inset-0 grid place-items-center'>
            <CircleSlash size={20} strokeWidth={1.75} />
          </span>
        ) : job.kind === "voice" ? (
          <span className='text-glacier absolute inset-0 grid place-items-center'>
            <AudioLines size={24} strokeWidth={1.5} />
          </span>
        ) : job.kind === "cutout" ? (
          <span className='bg-night/70 text-frost absolute right-1 bottom-1 grid size-5 place-items-center rounded-full'>
            <Scissors size={11} strokeWidth={2} />
          </span>
        ) : job.kind === "caption" ? (
          <span className='bg-night/70 text-frost absolute right-1 bottom-1 grid size-5 place-items-center rounded-full'>
            <ScanText size={11} strokeWidth={2} />
          </span>
        ) : null}
      </button>
    </li>
  )
}

/**
 * The newest jobs along the bottom of the canvas. Picking one puts it on the canvas; jobs still waiting or
 * running show a spinner, updated live.
 */
export function RecentStrip({
  jobs,
  currentId
}: Readonly<{
  jobs: JobSummary[]
  currentId: string | null
}>) {
  const { showJob } = useStudioQuery()

  if (jobs.length === 0) return null

  return (
    <div className='border-separator border-t px-4 py-3'>
      <ul className='flex min-w-0 flex-1 gap-2 overflow-x-auto py-0.5'>
        {jobs.map((job) => (
          <RecentJob
            key={job.id}
            job={job}
            isCurrent={job.id === currentId}
            onSelect={showJob}
          />
        ))}
      </ul>
    </div>
  )
}
