"use client"

import { Toast } from "@heroui/react"

/**
 * The region toasts appear in. Mounted once in the root layout; anything on the client can then call
 * `toast(...)` from `@heroui/react`.
 */
export function Toaster() {
  return <Toast.Provider placement='bottom end' />
}
