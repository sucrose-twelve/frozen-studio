import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Joins class names and resolves Tailwind conflicts, so a later `px-4` replaces an earlier `px-2`.
 */
export function cls(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Pads a number to two digits, e.g. `pad2(5) // "05"`.
 */
export const pad2 = (value: number) => String(value).padStart(2, "0")

/**
 * A stopwatch reading for run times: `m:ss`, e.g. `formatElapsed(83_000) // "1:23"`.
 */
export function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  return `${Math.floor(seconds / 60)}:${pad2(seconds % 60)}`
}
