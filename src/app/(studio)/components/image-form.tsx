"use client"

import { Input, Label, NumberField, TextArea, toast } from "@heroui/react"
import { zodResolver } from "@hookform/resolvers/zod"
import { ImageSparkles } from "@keyline-icons/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"

import { createJob } from "@/actions/jobs/create"
import type { AssetView } from "@/actions/jobs/read"
import { imageValidator, type ImageValidator } from "@/actions/jobs/validator.zod"
import {
  ASPECTS,
  IMAGE_COUNTS,
  IMAGE_DEFAULT_SAMPLERS,
  IMAGE_QUALITIES,
  IMAGE_SAMPLER_LABELS,
  IMAGE_SAMPLERS,
  IMAGE_SIZES,
  IMAGE_TIER_LABELS,
  IMAGE_TIERS,
  MAX_REFERENCES
} from "@/constants"
import { useEngine, useStore } from "@/hooks"

import { useDefaultModel } from "../hooks/use-default-model"
import { useStudioQuery } from "../hooks/use-studio-query"
import { IMAGE_FORM_DEFAULTS, modelLabel, parseSeed } from "../utils"
import {
  FieldMessage,
  FieldRow,
  FormDivider,
  FormSection,
  SwitchField
} from "./form-parts"
import { ModelSelect } from "./model-select"
import { OptionGroup, type Option } from "./option-group"
import { ReferencePicker } from "./reference-picker"
import { SubmitBar } from "./submit-bar"

type AspectChoice = Media.Aspect | "auto"
type SamplerChoice = Media.ImageSampler | "auto"

const SAMPLER_OPTIONS: Option<SamplerChoice>[] = [
  { value: "auto", label: "Auto" },
  ...IMAGE_SAMPLERS.map((sampler) => ({
    value: sampler,
    label: IMAGE_SAMPLER_LABELS[sampler]
  }))
]

const QUALITY_OPTIONS: Option<number>[] = IMAGE_QUALITIES.map((quality) => ({
  value: quality.steps,
  label: quality.label
}))

const TIER_OPTIONS: Option<Media.ImageTier>[] = IMAGE_TIERS.map((tier) => ({
  value: tier,
  label: IMAGE_TIER_LABELS[tier]
}))

const COUNT_OPTIONS: Option<number>[] = IMAGE_COUNTS.map((count) => ({
  value: count,
  label: String(count)
}))

/**
 * The Image form: text to image, or an edit when reference images are added. Qwen-Image 2.1 does both.
 */
export function ImageForm({ isActive }: Readonly<{ isActive: boolean }>) {
  const engine = useEngine()
  const prefill = useStore((state) => state.prefill)
  const { showJob } = useStudioQuery()
  const [references, setReferences] = useState<AssetView[]>([])

  const form = useForm<ImageValidator>({
    resolver: zodResolver(imageValidator),
    defaultValues: IMAGE_FORM_DEFAULTS
  })
  const { errors, isSubmitting } = form.formState
  const [model, aspect, tier, count, steps, cfg, sampler, seed, shouldRemoveBackground] =
    useWatch({
      control: form.control,
      name: [
        "model",
        "aspect",
        "tier",
        "count",
        "steps",
        "cfg",
        "sampler",
        "seed",
        "shouldRemoveBackground"
      ]
    })

  const models = engine?.models.image?.models
  const firstModel = models?.[0]
  const modelOptions = useMemo(
    () => (models ?? []).map((name) => ({ id: name, label: modelLabel(name) })),
    [models]
  )
  const hasCutoutModel = !!engine?.models.cutout
  const hasReferences = references.length > 0

  const aspectOptions = useMemo<Option<AspectChoice>[]>(
    () => [
      ...(hasReferences ? [{ value: "auto" as const, label: "Auto" }] : []),
      ...ASPECTS.map((value) => ({ value, label: value }))
    ],
    [hasReferences]
  )
  const sizeNote = aspect
    ? IMAGE_SIZES[aspect][tier].join(" × ")
    : "Follows the first reference"

  const isPresetQuality = IMAGE_QUALITIES.some((quality) => quality.steps === steps)

  const blocker = !engine
    ? "The worker is offline, so the installed models are unknown."
    : !engine.isComfyOnline
      ? "ComfyUI is offline. Start it to load the image model."
      : !firstModel
        ? "Qwen-Image 2.1 isn't installed in ComfyUI."
        : null

  const handleReferencesChange = useCallback(
    (assets: AssetView[]) => {
      setReferences(assets)
      form.setValue(
        "references",
        assets.map((asset) => asset.id)
      )
      // "Auto" only means something with a reference to follow
      if (assets.length === 0 && form.getValues("aspect") === null) {
        form.setValue("aspect", IMAGE_FORM_DEFAULTS.aspect)
      }
    },
    [form]
  )

  const handleModelChange = useCallback(
    (value: string) => form.setValue("model", value),
    [form]
  )
  const handleAspectChange = useCallback(
    (value: AspectChoice) =>
      form.setValue("aspect", value === "auto" ? null : value, { shouldValidate: true }),
    [form]
  )
  const handleTierChange = useCallback(
    (value: Media.ImageTier) => form.setValue("tier", value),
    [form]
  )
  const handleStepsChange = useCallback(
    (value: number) => form.setValue("steps", value),
    [form]
  )
  const handleCountChange = useCallback(
    (value: number) => form.setValue("count", value as ImageValidator["count"]),
    [form]
  )
  // The field hands back nothing (or not a number) while it is being cleared
  const handleStepsInput = useCallback(
    (value: number | undefined) =>
      form.setValue(
        "steps",
        typeof value === "number" && Number.isFinite(value)
          ? Math.round(value)
          : IMAGE_FORM_DEFAULTS.steps
      ),
    [form]
  )
  const handleCfgChange = useCallback(
    (value: number | undefined) => form.setValue("cfg", value ?? IMAGE_FORM_DEFAULTS.cfg),
    [form]
  )
  const handleSamplerChange = useCallback(
    (value: SamplerChoice) => form.setValue("sampler", value === "auto" ? null : value),
    [form]
  )
  const handleSeedChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      form.setValue("seed", parseSeed(event.target.value)),
    [form]
  )
  const handleRemoveBackgroundChange = useCallback(
    (isSelected: boolean) => form.setValue("shouldRemoveBackground", isSelected),
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

        void showJob(result.ids[0] ?? null)
      }),
    [form, showJob]
  )

  useDefaultModel(models, model, handleModelChange)

  // A result sent here from the canvas: its settings, its images, or both
  useEffect(() => {
    if (prefill?.kind !== "image") return

    // Prompts sent over from a caption: only the text changes
    if (prefill.prompt) {
      form.setValue("prompt", prefill.prompt.positive, { shouldValidate: true })
      if (prefill.prompt.negative !== undefined) {
        form.setValue("negative", prefill.prompt.negative)
      }
      return
    }

    const params = prefill.source?.params
    if (prefill.source && params?.kind === "image") {
      form.reset({
        ...IMAGE_FORM_DEFAULTS,
        prompt: prefill.source.prompt,
        negative: params.negative,
        model: params.model,
        aspect: params.aspect,
        tier: params.tier,
        count: params.count as ImageValidator["count"],
        steps: params.steps,
        cfg: params.cfg,
        sampler: params.sampler ?? null,
        seed: params.seed,
        shouldRemoveBackground: params.shouldRemoveBackground
      })
    } else if (prefill.references.length > 0) {
      // An edit follows the size of what it edits, unless told otherwise
      form.setValue("aspect", null)
    }

    setReferences(prefill.references)
    form.setValue(
      "references",
      prefill.references.map((asset) => asset.id)
    )
  }, [prefill, form])

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
        label='Image model'
        models={modelOptions}
        value={model}
        onChange={handleModelChange}
      />

      <FormSection title='Prompt'>
        <TextArea
          aria-label='Prompt'
          fullWidth
          rows={6}
          variant='secondary'
          className='resize-y'
          placeholder={
            hasReferences
              ? "What to change, in plain sentences. Say what to keep, and which image is which: “Dress the woman in image 1 in the outfit from image 2. Keep her pose.”"
              : "Describe the image in plain sentences: subject, setting, light, style."
          }
          {...form.register("prompt")}
        />
        <FieldMessage message={errors.prompt?.message} />
      </FormSection>

      <FormSection
        title='Reference images'
        note={`${references.length} / ${MAX_REFERENCES.image} · optional`}>
        <ReferencePicker
          value={references}
          onChange={handleReferencesChange}
          max={MAX_REFERENCES.image}
          isOrdered
          isActive={isActive}
          hint='Drop, paste or pick images to edit or to borrow from'
        />
      </FormSection>

      <FormSection title='Output' note={sizeNote}>
        <FieldRow
          label={isPresetQuality ? "Quality" : `Quality · custom, ${steps} steps`}>
          <OptionGroup
            label='Quality'
            value={steps}
            options={QUALITY_OPTIONS}
            onChange={handleStepsChange}
          />
        </FieldRow>
        <FieldRow label='Aspect'>
          <OptionGroup
            label='Aspect'
            value={aspect ?? "auto"}
            options={aspectOptions}
            onChange={handleAspectChange}
          />
          <FieldMessage message={errors.aspect?.message} />
        </FieldRow>
        <div className='grid grid-cols-[1fr_auto] gap-3'>
          <FieldRow label='Size'>
            <OptionGroup
              label='Size'
              value={tier}
              options={TIER_OPTIONS}
              onChange={handleTierChange}
              isDisabled={aspect === null}
            />
          </FieldRow>
          <FieldRow label='Images'>
            <OptionGroup
              label='Images'
              value={count}
              options={COUNT_OPTIONS}
              onChange={handleCountChange}
            />
          </FieldRow>
        </div>
      </FormSection>

      <SwitchField
        label='Also save a cutout'
        description={
          hasCutoutModel
            ? "A second copy with the background removed, as a transparent PNG."
            : "Needs a background removal model in ComfyUI."
        }
        isSelected={shouldRemoveBackground && hasCutoutModel}
        isDisabled={!hasCutoutModel}
        onChange={handleRemoveBackgroundChange}
      />

      <FormDivider />

      <FormSection title='Advanced'>
        <FieldRow label='Negative prompt'>
          <TextArea
            aria-label='Negative prompt'
            fullWidth
            rows={2}
            variant='secondary'
            placeholder='What to avoid. Leave empty unless something keeps showing up.'
            {...form.register("negative")}
          />
        </FieldRow>
        <FieldRow label='Sampler'>
          <OptionGroup
            label='Sampler'
            value={sampler ?? "auto"}
            options={SAMPLER_OPTIONS}
            onChange={handleSamplerChange}
          />
          <p className='text-muted text-xs'>
            Auto uses {IMAGE_SAMPLER_LABELS[IMAGE_DEFAULT_SAMPLERS.create]} for a new
            image and {IMAGE_SAMPLER_LABELS[IMAGE_DEFAULT_SAMPLERS.edit]} for an edit, the
            two that are known to work. The others are there to experiment with.
          </p>
        </FieldRow>
        <div className='grid grid-cols-2 gap-3'>
          <NumberField
            fullWidth
            variant='secondary'
            minValue={1}
            maxValue={100}
            step={1}
            value={steps}
            onChange={handleStepsInput}>
            <Label className='text-muted text-xs'>Steps</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>
          <NumberField
            fullWidth
            variant='secondary'
            minValue={1}
            maxValue={15}
            step={0.5}
            value={cfg}
            onChange={handleCfgChange}>
            <Label className='text-muted text-xs'>Guidance (CFG)</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>
        </div>
        <p className='text-muted text-xs'>
          Quality picks {IMAGE_QUALITIES.map((quality) => quality.steps).join(", ")}{" "}
          steps. Any number from 1 to 100 can be typed here instead.
        </p>
        <FieldRow label='Seed'>
          <Input
            aria-label='Seed'
            fullWidth
            variant='secondary'
            inputMode='numeric'
            placeholder='Random'
            value={seed === null ? "" : String(seed)}
            onChange={handleSeedChange}
          />
        </FieldRow>
      </FormSection>

      <SubmitBar
        summary={`${steps} steps · CFG ${cfg} · ${count} ${count === 1 ? "image" : "images"}`}
        blocker={blocker}
        label={hasReferences ? "Edit image" : "Generate image"}
        icon={<ImageSparkles size={18} strokeWidth={1.75} />}
        isPending={isSubmitting}
      />
    </form>
  )
}
