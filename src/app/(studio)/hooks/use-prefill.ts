"use client"

import { usePathname, useRouter } from "next/navigation"
import { useCallback } from "react"

import { useStore } from "@/hooks"
import type { Prefill } from "@/stores/studio/state"

/**
 * Sends a result on to a form, and goes to that form's page when it is on another one: the Caption form has
 * a page of its own, the others share the studio.
 *
 * The request waits in the store, which every page shares, so the form applies it as it mounts.
 */
export function usePrefill() {
  const requestPrefill = useStore((state) => state.requestPrefill)
  const router = useRouter()
  const pathname = usePathname()

  return useCallback(
    (prefill: Prefill) => {
      requestPrefill(prefill)

      if (prefill.kind === "caption") {
        if (pathname !== "/caption") router.push("/caption")
        return
      }
      // The mode goes in the link: the studio's forms also set it as they mount, but that update to the
      // URL can lose to the navigation that is still finishing, which would leave the wrong form showing
      if (pathname !== "/") router.push(`/?mode=${prefill.kind}`)
    },
    [requestPrefill, router, pathname]
  )
}
