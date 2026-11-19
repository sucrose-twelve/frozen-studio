"use client"

import { useEffect } from "react"

/**
 * Keeps a form's model on one that is installed: the first of the list whenever the form has none, or has
 * one that is gone (deleted since, or brought in by "Reuse settings" from an old job).
 *
 * The list arrives with the engine's status, after the form has mounted, which is why this is an effect and
 * not a default value.
 *
 * @param models - The installed models by id, or `undefined` while the engine hasn't reported
 */
export function useDefaultModel(
  models: readonly string[] | undefined,
  value: string,
  onChange: (model: string) => void
) {
  useEffect(() => {
    const first = models?.[0]
    if (first && !models.includes(value)) onChange(first)
  }, [models, value, onChange])
}
