"use client"

import { usePathname, useRouter } from "next/navigation"
import { useEffect, useRef } from "react"

import { ACTIVE_JOB_STATUSES, CHAT_JOB_KINDS } from "@/constants"
import { useStore } from "@/hooks"

/**
 * Listens to the worker's event stream for as long as the page is open and feeds the store.
 *
 * When a job reaches its end the page is refreshed, so the Server Components load what the job produced. A
 * chat reply or a spoken message only matters to the Chat page, so only that page refreshes for one.
 * `EventSource` reconnects by itself after a dropped connection.
 */
export function JobEvents() {
  const router = useRouter()
  const pathname = usePathname()
  const applyEvent = useStore((state) => state.applyEvent)
  const jobs = useStore((state) => state.jobs)
  // Read by the listener, so the stream isn't reopened each time a job or the page changes
  const jobsRef = useRef(jobs)
  const pathnameRef = useRef(pathname)

  useEffect(() => {
    jobsRef.current = jobs
    pathnameRef.current = pathname
  }, [jobs, pathname])

  useEffect(() => {
    const source = new EventSource("/api/events")
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as Engine.Event
      applyEvent(event)

      if (event.type !== "job" || ACTIVE_JOB_STATUSES.includes(event.status)) return

      const kind = jobsRef.current[event.id]?.brief?.kind
      const isChatJob =
        !!kind && (CHAT_JOB_KINDS as readonly Media.JobKind[]).includes(kind)
      if (!isChatJob || pathnameRef.current.startsWith("/chat")) router.refresh()
    }

    return () => source.close()
  }, [applyEvent, router])

  return null
}
