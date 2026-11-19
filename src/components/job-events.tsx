"use client"

import { useRouter } from "next/navigation"
import { useEffect } from "react"

import { ACTIVE_JOB_STATUSES } from "@/constants"
import { useStore } from "@/hooks"

/**
 * Listens to the worker's event stream for as long as the page is open and feeds the store.
 *
 * When a job reaches its end the page is refreshed, so the Server Components load what the job produced.
 * `EventSource` reconnects by itself after a dropped connection.
 */
export function JobEvents() {
  const router = useRouter()
  const applyEvent = useStore((state) => state.applyEvent)

  useEffect(() => {
    const source = new EventSource("/api/events")
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as Engine.Event
      applyEvent(event)

      if (event.type === "job" && !ACTIVE_JOB_STATUSES.includes(event.status)) {
        router.refresh()
      }
    }

    return () => source.close()
  }, [applyEvent, router])

  return null
}
