"use client"

import { createContext, useContext, useRef, type ReactNode } from "react"
import { useStore } from "zustand"

import { createStudioStore, type StudioState, type StudioStore } from "./state"

type Store = StudioStore | null

const StoreContext = createContext<Store>(null)

/**
 * Holds what changes while a page is open: the engine's status and the live state of jobs, both fed by the
 * event stream (`JobEvents`). The engine status the server read seeds it.
 */
export function StudioStoreProvider({
  children,
  engine
}: Readonly<{
  children: ReactNode
  engine: Engine.Status | null
}>) {
  const storeRef = useRef<Store>(null)
  if (!storeRef.current) {
    storeRef.current = createStudioStore({ engine })
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
