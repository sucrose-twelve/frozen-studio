"use client"

import { createContext, useContext, useRef, type ReactNode } from "react"
import { useStore } from "zustand"

import type { ActiveJob } from "@/actions/jobs/read"

import { createStudioStore, type StudioState, type StudioStore } from "./state"

type Store = StudioStore | null

const StoreContext = createContext<Store>(null)

/**
 * Holds what changes while a page is open: the engine's status and the live state of jobs, both fed by the
 * event stream (`JobEvents`). The engine status and the active jobs the server read seed it.
 */
export function StudioStoreProvider({
  children,
  engine,
  activeJobs
}: Readonly<{
  children: ReactNode
  engine: Engine.Status | null
  activeJobs: ActiveJob[]
}>) {
  const storeRef = useRef<Store>(null)
  if (!storeRef.current) {
    const jobs = Object.fromEntries(
      activeJobs.map(({ status, ...brief }) => [
        brief.id,
        { status, progress: null, brief }
      ])
    )
    storeRef.current = createStudioStore({ engine, jobs })
  }

  return <StoreContext value={storeRef.current}>{children}</StoreContext>
}

export function useStudioStore<T>(selector: (state: StudioState) => T) {
  const store = useContext(StoreContext)
  if (!store) {
    throw new Error("useStudioStore must be used within StudioStoreProvider")
  }

  return useStore(store, selector)
}
