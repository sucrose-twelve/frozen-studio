import type { Metadata } from "next"
import { z } from "zod"

import { readJob, readRecentJobs } from "@/actions/jobs/read"

import { CaptionForm } from "../components/caption-form"
import { JobCanvas } from "../components/job-canvas"
import { RecentStrip } from "../components/recent-strip"
import { queryValidator } from "../validator.nuqs"

export const instant = false

export const metadata: Metadata = { title: "Caption" }

const CAPTION_KINDS: Media.JobKind[] = ["caption"]

/**
 * The Caption page: the form that has a model read images on the left, the selected caption on the right
 * with the recent ones under it. It is the studio's layout for the one kind of job that makes text.
 *
 * `?job=` picks the caption on the canvas. Without it, or when that job is gone, the newest caption shows.
 */
export default async function Caption({ searchParams }: NextSearchParams) {
  const query = queryValidator.parse(await searchParams)
  const jobId = z.uuid().safeParse(query.job).success ? query.job : null

  const [recent, selected] = await Promise.all([
    readRecentJobs(CAPTION_KINDS),
    jobId ? readJob(jobId) : null
  ])
  // Only when nothing is selected, since it needs the first id of the list
  const job = selected ?? (recent[0] ? await readJob(recent[0].id) : null)

  return (
    <div className='max-w-9xl mx-auto grid grid-cols-1 gap-4 p-4 lg:h-[calc(100svh-4rem)] lg:grid-cols-[30rem_minmax(0,1fr)]'>
      <aside className='use-panel flex min-h-0 flex-col overflow-hidden'>
        <div className='min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pt-4'>
          <CaptionForm isActive />
        </div>
      </aside>
      <section className='use-panel flex min-h-[70svh] min-w-0 flex-col overflow-hidden lg:min-h-0'>
        <JobCanvas key={job?.id ?? "empty"} job={job} assetId={null} />
        <RecentStrip jobs={recent} currentId={job?.id ?? null} />
      </section>
    </div>
  )
}
