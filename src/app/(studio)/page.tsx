import { z } from "zod"

import { readJob, readRecentJobs } from "@/actions/jobs/read"

import { JobCanvas } from "./components/job-canvas"
import { RecentStrip } from "./components/recent-strip"
import { StudioForms } from "./components/studio-forms"
import { queryValidator } from "./validator.nuqs"

export const instant = false

/**
 * The studio: forms on the left, the selected job on the right with the recent ones under it.
 *
 * `?job=` picks the job on the canvas. Without it, or when that job is gone, the newest job shows. `?asset=`
 * opens that job on one of its results rather than the first.
 */
export default async function Studio({ searchParams }: NextSearchParams) {
  const query = queryValidator.parse(await searchParams)
  const jobId = z.uuid().safeParse(query.job).success ? query.job : null

  const [recent, selected] = await Promise.all([
    readRecentJobs(),
    jobId ? readJob(jobId) : null
  ])
  // Only when nothing is selected, since it needs the first id of the list
  const job = selected ?? (recent[0] ? await readJob(recent[0].id) : null)

  return (
    <div className='max-w-9xl mx-auto grid grid-cols-1 gap-4 p-4 lg:h-[calc(100svh-4rem)] lg:grid-cols-[30rem_minmax(0,1fr)]'>
      <StudioForms />
      <section className='use-panel flex min-h-[70svh] min-w-0 flex-col overflow-hidden lg:min-h-0'>
        <JobCanvas key={job?.id ?? "empty"} job={job} assetId={query.asset} />
        <RecentStrip jobs={recent} currentId={job?.id ?? null} />
      </section>
    </div>
  )
}
