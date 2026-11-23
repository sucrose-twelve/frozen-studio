import { readEngine } from "@/actions/engine/read"
import { readActiveJobs } from "@/actions/jobs/read"
import { JobEvents } from "@/components/job-events"
import { JobToasts } from "@/components/job-toasts"
import { SiteHeader } from "@/components/site-header"
import { StudioStoreProvider } from "@/stores/studio"

/**
 * The shell of the app: the header, and the store, event stream and job toasts every page below shares.
 */
export default async function StudioLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  const [engine, activeJobs] = await Promise.all([readEngine(), readActiveJobs()])

  return (
    <StudioStoreProvider engine={engine} activeJobs={activeJobs}>
      <JobEvents />
      <JobToasts />
      <SiteHeader />
      <main>{children}</main>
    </StudioStoreProvider>
  )
}
