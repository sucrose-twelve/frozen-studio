"use client"

import { TextArea, toast } from "@heroui/react"
import { zodResolver } from "@hookform/resolvers/zod"
import { ScanText } from "@keyline-icons/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"

import { createJob } from "@/actions/jobs/create"
import type { AssetView } from "@/actions/jobs/read"
import { captionValidator, type CaptionValidator } from "@/actions/jobs/validator.zod"
import {
  CAPTION_MAX_PROMPT_LENGTH,
  CAPTION_MODE_LABELS,
  CAPTION_MODES,
  CAPTION_STYLE_LABELS,
  CAPTION_STYLES,
  MAX_REFERENCES
} from "@/constants"
import { useEngine, useStore } from "@/hooks"

import { useDefaultModel } from "../hooks/use-default-model"
import { useStudioQuery } from "../hooks/use-studio-query"
import { CAPTION_FORM_DEFAULTS } from "../utils"
import { FieldMessage, FieldRow, FormSection } from "./form-parts"
import { ModelSelect } from "./model-select"
import { OptionGroup } from "./option-group"
import { ReferencePicker } from "./reference-picker"
import { SubmitBar } from "./submit-bar"

const MODE_OPTIONS = CAPTION_MODES.map((mode) => ({
  value: mode,
  label: CAPTION_MODE_LABELS[mode]
}))

const STYLE_OPTIONS = CAPTION_STYLES.map((style) => ({
  value: style,
  label: CAPTION_STYLE_LABELS[style]
}))

/**
 * What the prompt is for in each mode, as the field's placeholder.
 */
const PROMPT_PLACEHOLDERS: Record<Media.CaptionMode, string> = {
  prompts:
    "Optional. What the model should attend to, or how it should write: focus on the clothing and the pose, keep the prompt short…",
  answer:
    "Ask about the image, or say what to write: What is she holding? · Write a prompt that animates this picture."
}

/**
 * The Caption form: a vision-language model reads each image added, one job per image, and is told what to
 * do with it in a prompt.
 *
 * It writes one of two things. "Prompts" is a description with a positive and a negative prompt that ask
 * for the image again, where the prompt is optional guidance. "Answer" is whatever the prompt asks for, as
 * plain text.
 */
export function CaptionForm({ isActive }: Readonly<{ isActive: boolean }>) {
  const engine = useEngine()
  const prefill = useStore((state) => state.prefill)
  const { showJob } = useStudioQuery()
  const [references, setReferences] = useState<AssetView[]>([])

  const form = useForm<CaptionValidator>({
    resolver: zodResolver(captionValidator),
    defaultValues: CAPTION_FORM_DEFAULTS
  })
  const { errors, isSubmitting } = form.formState
  const [model, mode, style] = useWatch({
    control: form.control,
    name: ["model", "mode", "style"]
  })

  const models = engine?.models.caption?.models
  const modelOptions = useMemo(
    () => (models ?? []).map((name) => ({ id: name, label: name })),
    [models]
  )

  const count = references.length
  const isAnswer = mode === "answer"
  const blocker = !engine
    ? "The worker is offline, so the caption engine can't be checked."
    : !engine.models.caption
      ? "The caption engine isn't installed. The README says how to set it up."
      : count === 0
        ? "Add at least one image."
        : null

  const handleModelChange = useCallback(
    (value: string) => form.setValue("model", value),
    [form]
  )
  const handleReferencesChange = useCallback(
    (assets: AssetView[]) => {
      setReferences(assets)
      form.setValue(
        "references",
        assets.map((asset) => asset.id)
      )
    },
    [form]
  )
  const handleModeChange = useCallback(
    (value: Media.CaptionMode) => {
      form.setValue("mode", value)
      // The prompt is only required for an answer, so its message may no longer apply
      form.clearErrors("prompt")
    },
    [form]
  )
  const handleStyleChange = useCallback(
    (value: Media.CaptionStyle) => form.setValue("style", value),
    [form]
  )

  const handleSubmit = useMemo(
    () =>
      form.handleSubmit(async (values) => {
        const result = await createJob(values)
        if (!result.ok) {
          toast.danger(result.message)
          return
        }

        // The images are done with; the prompt and the settings stay for the next batch
        handleReferencesChange([])
        void showJob(result.ids[0] ?? null)
      }),
    [form, showJob, handleReferencesChange]
  )

  useDefaultModel(models, model, handleModelChange)

  // An image sent here from the canvas, or "Reuse settings" on a caption
  useEffect(() => {
    if (prefill?.kind !== "caption") return

    const params = prefill.source?.params
    if (prefill.source && params?.kind === "caption") {
      form.setValue("model", params.model)
      form.setValue("prompt", prefill.source.prompt)
      form.setValue("mode", params.mode)
      form.setValue("style", params.style)
    }
    handleReferencesChange(prefill.references)
  }, [prefill, form, handleReferencesChange])

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
      <ModelSelect
        label='Caption model'
        models={modelOptions}
        value={model}
        onChange={handleModelChange}
      />

      <FormSection title='Images' note={`${count} / ${MAX_REFERENCES.caption}`}>
        <ReferencePicker
          value={references}
          onChange={handleReferencesChange}
          max={MAX_REFERENCES.caption}
          isActive={isActive}
          hint='Drop, paste or pick the images to read'
        />
        <FieldMessage message={errors.references?.message} />
      </FormSection>

      <FormSection title='Prompt'>
        <TextArea
          aria-label='Prompt'
          fullWidth
          rows={5}
          variant='secondary'
          className='resize-y'
          maxLength={CAPTION_MAX_PROMPT_LENGTH}
          placeholder={PROMPT_PLACEHOLDERS[mode]}
          {...form.register("prompt")}
        />
        <FieldMessage message={errors.prompt?.message} />
      </FormSection>

      <FormSection title='Output'>
        <FieldRow label='Write'>
          <OptionGroup
            label='Write'
            value={mode}
            options={MODE_OPTIONS}
            onChange={handleModeChange}
          />
        </FieldRow>
        <p className='text-muted text-xs'>
          {isAnswer
            ? "The model does what the prompt says with each image and answers in plain text."
            : "Each image comes back as a description, a positive prompt that asks for it again, and a negative prompt to go with it. The prompt is guidance, and can be left empty."}
        </p>
        <FieldRow label='Positive prompt as'>
          <OptionGroup
            label='Positive prompt as'
            value={style}
            options={STYLE_OPTIONS}
            onChange={handleStyleChange}
            isDisabled={isAnswer}
          />
        </FieldRow>
        <p className='text-muted text-xs'>
          {isAnswer
            ? "An answer has no positive prompt. Say in the prompt how it should be written."
            : "Sentences suit Qwen-Image and Wan, which read a prompt like a description. Tags suit models trained on tag lists."}
        </p>
      </FormSection>

      <SubmitBar
        summary={
          count === 1 ? "1 image · about a minute" : `${count} images, one job each`
        }
        blocker={blocker}
        label={isAnswer ? "Ask" : "Describe"}
        icon={<ScanText size={18} strokeWidth={1.75} />}
        isPending={isSubmitting}
      />
    </form>
  )
}
