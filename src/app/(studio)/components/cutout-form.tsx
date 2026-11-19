"use client"

import { toast } from "@heroui/react"
import { Scissors } from "@keyline-icons/react"
import { useCallback, useEffect, useState } from "react"

import { createJob } from "@/actions/jobs/create"
import type { AssetView } from "@/actions/jobs/read"
import { MAX_REFERENCES } from "@/constants"
import { useEngine, useStore } from "@/hooks"

import { useStudioQuery } from "../hooks/use-studio-query"
import { FormSection } from "./form-parts"
import { ReferencePicker } from "./reference-picker"
import { SubmitBar } from "./submit-bar"

/**
 * The Cutout form: removes the background of each image added, one job per image. It has a single field, so
 * it keeps its own state instead of a form library; the action validates the ids again.
 */
export function CutoutForm({ isActive }: Readonly<{ isActive: boolean }>) {
  const engine = useEngine()
  const prefill = useStore((state) => state.prefill)
  const { showJob } = useStudioQuery()
  const [references, setReferences] = useState<AssetView[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)

  const count = references.length
  const blocker = !engine
    ? "The worker is offline, so the installed models are unknown."
    : !engine.isComfyOnline
      ? "ComfyUI is offline. Start it to load the background model."
      : !engine.models.cutout
        ? "No background removal model is installed in ComfyUI."
        : count === 0
          ? "Add at least one image."
          : null

  const handleSubmit = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault()
      if (references.length === 0 || isSubmitting) return

      setIsSubmitting(true)
      try {
        const result = await createJob({
          kind: "cutout",
          references: references.map((asset) => asset.id)
        })
        if (!result.ok) {
          toast.danger(result.message)
          return
        }

        setReferences([])
        void showJob(result.ids[0] ?? null)
      } finally {
        setIsSubmitting(false)
      }
    },
    [references, isSubmitting, showJob]
  )

  // An image sent here from the canvas
  useEffect(() => {
    if (prefill?.kind === "cutout") setReferences(prefill.references)
  }, [prefill])

  useEffect(() => {
    if (!isActive) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) void handleSubmit()
    }

    document.addEventListener("keydown", handleKeyDown)
    return () => document.removeEventListener("keydown", handleKeyDown)
  }, [isActive, handleSubmit])

  return (
    <form onSubmit={handleSubmit} className='flex min-h-full flex-col gap-5'>
      <FormSection title='Images' note={`${count} / ${MAX_REFERENCES.cutout}`}>
        <ReferencePicker
          value={references}
          onChange={setReferences}
          max={MAX_REFERENCES.cutout}
          isActive={isActive}
          hint='Drop, paste or pick the images to cut out'
        />
        <p className='text-muted text-xs'>
          Each image comes back as a transparent PNG, cut out with BiRefNet. The original
          pixels are kept; only the background goes.
        </p>
      </FormSection>

      <SubmitBar
        summary={count === 1 ? "1 image" : `${count} images, one job each`}
        blocker={blocker}
        label='Remove background'
        icon={<Scissors size={18} strokeWidth={1.75} />}
        isPending={isSubmitting}
      />
    </form>
  )
}
