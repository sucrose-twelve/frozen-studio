import { readEngine } from "@/actions/engine/read"
import { JobEvents } from "@/components/job-events"
import { SiteHeader } from "@/components/site-header"
import { StudioStoreProvider } from "@/stores/studio"

/**
 * The shell of the app: the header, and the store and event stream every page below shares.
 */
export default async function StudioLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  const engine = await readEngine()

  return (
    <StudioStoreProvider engine={engine}>
      <JobEvents />
      <SiteHeader />
      <main>{children}</main>
    </StudioStoreProvider>
  )
}
