"use client"

import { useQueryStates } from "nuqs"
import { useCallback, useMemo, useTransition } from "react"

import { studioParsers } from "../validator.nuqs"

/**
 * The studio's URL state, which the Caption page shares for the job on its canvas.
 *
 * - `setMode` only swaps the visible form, so it stays on the client (`shallow`).
 * - `showJob` puts another job on the canvas, which the server has to load: it re-renders the page inside a
 *   transition (`isPending` while it does).
 */
export function useStudioQuery() {
  const [isPending, startTransition] = useTransition()
  const [query, setQuery] = useQueryStates(studioParsers, {
    shallow: false,
    startTransition
  })

  const setMode = useCallback(
    (mode: Media.StudioMode) => setQuery({ mode }, { shallow: true }),
    [setQuery]
  )
  // `asset` belongs to the job it came with, so it goes when the job changes
  const showJob = useCallback(
    (job: string | null) => setQuery({ job, asset: null }),
    [setQuery]
  )
  // Another result of the job on the canvas, e.g. the next one after a result was deleted
  const showAsset = useCallback((asset: string | null) => setQuery({ asset }), [setQuery])

  return useMemo(
    () => ({ query, isPending, setMode, showJob, showAsset }),
    [query, isPending, setMode, showJob, showAsset]
  )
}
