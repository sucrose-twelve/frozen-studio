import { useEffect, useState } from "react"

import { ENGINE_STATUS_TTL_SECONDS } from "@/constants"
import { useStudioStore } from "@/stores/studio"

/**
 * The engine's status, or `null` once the worker has gone quiet.
 *
 * The store keeps the last status it heard, which would look alive forever if the worker stopped. A status
 * older than the key's TTL is therefore treated as gone, checked on a slow timer.
 */
export function useEngine() {
  const engine = useStudioStore((state) => state.engine)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 5_000)
    return () => clearInterval(timer)
  }, [])

  if (!engine) return null
  return now - engine.updatedAt > ENGINE_STATUS_TTL_SECONDS * 1_000 ? null : engine
}
