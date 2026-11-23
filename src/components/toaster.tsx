"use client"

import { Toast } from "@heroui/react"

/**
 * The region toasts appear in. Mounted once in the root layout; anything on the client can then call
 * `toast(...)` from `@heroui/react`.
 *
 * The stack is always expanded: the job toasts (`JobToasts`) are a live list of the queue, and each one
 * should be readable without hovering the stack open.
 */
export function Toaster() {
  return <Toast.Provider placement='bottom end' isExpanded maxVisibleToasts={5} />
}
