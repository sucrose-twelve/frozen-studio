"use client"

import {
  Input,
  Label,
  ListBox,
  NumberField,
  Select,
  TextArea,
  toast
} from "@heroui/react"
import { zodResolver } from "@hookform/resolvers/zod"
import { ImageSparkles } from "@keyline-icons/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { Controller, useForm, useWatch } from "react-hook-form"

import { createJob } from "@/actions/jobs/create"
import type { AssetView } from "@/actions/jobs/read"
import { imageValidator, type ImageValidator } from "@/actions/jobs/validator.zod"
import {
  ASPECTS,
  IMAGE_COUNTS,
  IMAGE_FAMILIES,
  IMAGE_FAMILY_LABELS,
  IMAGE_FAMILY_SAMPLING,
  IMAGE_SAMPLER_LABELS,
  IMAGE_SAMPLERS,
  IMAGE_SIZES,
  IMAGE_TIER_LABELS,
  IMAGE_TIERS,
  IMAGE_TURBO,
  LORA_STRENGTH,
  MAX_REFERENCES
} from "@/constants"
import { useEngine, useStore } from "@/hooks"
import {
  canEditImages,
  imageEngine,
  imageFamily,
  imageSamplingDefaults,
  isGgufFile,
  isTurboImageModel,
  listImageModels,
  textEncodersFor
} from "@/libs/image-model"

import { useDefaultModel } from "../hooks/use-default-model"
import { useStudioQuery } from "../hooks/use-studio-query"
import { IMAGE_FORM_DEFAULTS, loraLabel, modelLabel, parseSeed } from "../utils"
import {
  FieldMessage,
  FieldRow,
  FormDivider,
  FormSection,
  SwitchField
} from "./form-parts"
import { ModelSelect } from "./model-select"
import { OptionGroup, type Option } from "./option-group"
import { PromptField } from "./prompt-field"
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

/**
 * The "no LoRA" choice of the LoRA list. A LoRA's own id is its file name, which always has an extension.
 */
const NO_LORA = "none"

const TIER_OPTIONS: Option<Media.ImageTier>[] = IMAGE_TIERS.map((tier) => ({
  value: tier,
  label: IMAGE_TIER_LABELS[tier]
}))

const COUNT_OPTIONS: Option<number>[] = IMAGE_COUNTS.map((count) => ({
  value: count,
  label: String(count)
}))

/**
 * The Image form: text to image, or an edit when reference images are added. Qwen-Image 2.1 does both;
 * MOSS-Image, Iris and the Turbo builds only draw new images.
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
  const [
    model,
    textEncoder,
    aspect,
    tier,
    count,
    steps,
    cfg,
    sampler,
    lora,
    loraStrength,
    seed,
    shouldRemoveBackground
  ] = useWatch({
    control: form.control,
    name: [
      "model",
      "textEncoder",
      "aspect",
      "tier",
      "count",
      "steps",
      "cfg",
      "sampler",
      "lora",
      "loraStrength",
      "seed",
      "shouldRemoveBackground"
    ]
  })

  const installed = engine?.models.image
  const models = useMemo(
    () => (installed === undefined ? undefined : listImageModels(installed)),
    [installed]
  )
  const firstModel = models?.[0]
  // What the chosen model's family has: its text encoders, its LoRAs, and how it is sampled
  const family = imageFamily(model)
  const sampling = IMAGE_FAMILY_SAMPLING[family]
  const familyModels = installed?.[family]
  const textEncoders = useMemo(
    () => (familyModels ? textEncodersFor(familyModels, model) : undefined),
    [familyModels, model]
  )
  const loras = familyModels?.loras
  // A GGUF text encoder moves the job to stable-diffusion.cpp
  const isSdCpp = imageEngine(textEncoder) === "sdcpp"
  const canEdit = canEditImages(model, installed?.[family])
  // The text encoder is out of sight unless there is a choice, so the model list says which models run on
  // stable-diffusion.cpp
  const modelOptions = useMemo(
    () =>
      (models ?? []).map((name) => {
        const firstEncoder = textEncodersFor(installed?.[imageFamily(name)], name)[0]
        const label = modelLabel(name)

        return {
          id: name,
          label:
            imageEngine(firstEncoder ?? null) === "sdcpp" ? `${label} · sd.cpp` : label
        }
      }),
    [models, installed]
  )
  const textEncoderOptions = useMemo(
    () =>
      (textEncoders ?? []).map((name) => ({
        id: name,
        label: isGgufFile(name) ? `${modelLabel(name)} · sd.cpp` : modelLabel(name)
      })),
    [textEncoders]
  )
  // Most models go with one text encoder, picked for them; the choice shows when more of their kind are
  // installed
  const hasTextEncoderChoice = textEncoderOptions.length > 1
  // A Turbo model runs its own fixed schedule: the sampling settings show it and can't be changed
  const isTurbo = isTurboImageModel(model)
  const shownSteps = isTurbo ? IMAGE_TURBO.steps : steps
  const shownCfg = isTurbo ? IMAGE_TURBO.cfg : cfg
  const qualityOptions = useMemo<Option<number>[]>(
    () =>
      sampling.qualities.map((quality) => ({
        value: quality.steps,
        label: quality.label
      })),
    [sampling]
  )
  const hasLoras = !!loras && loras.length > 0
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

  const isPresetQuality = sampling.qualities.some((quality) => quality.steps === steps)

  const blocker = !engine
    ? "The worker is offline, so the installed models are unknown."
    : !firstModel
      ? engine.isComfyOnline
        ? "No image model is installed."
        : "ComfyUI is offline. Start it to load its image models."
      : !engine.isComfyOnline && !isSdCpp
        ? "ComfyUI is offline, and this model runs on it."
        : hasReferences && !canEdit
          ? sampling.editing === "lora"
            ? `${IMAGE_FAMILY_LABELS[family]} needs its edit LoRA in ComfyUI to take reference images.`
            : "This model only draws new images. Remove the references, or pick another model to edit them."
          : null

  // Puts a family's own steps and guidance on screen: those of a new image, or of an edit
  const applySampling = useCallback(
    (nextFamily: Media.ImageFamily, isEdit: boolean) => {
      const defaults = imageSamplingDefaults(nextFamily, isEdit)
      form.setValue("steps", defaults.steps)
      form.setValue("cfg", defaults.cfg)
      form.setValue("sampler", null)
    },
    [form]
  )

  const handleReferencesChange = useCallback(
    (assets: AssetView[]) => {
      // A family whose edits are sampled differently changes its settings with the first reference, and
      // back with the last one gone
      const currentFamily = imageFamily(form.getValues("model"))
      const wasEdit = form.getValues("references").length > 0
      if (IMAGE_FAMILY_SAMPLING[currentFamily].edit && wasEdit !== assets.length > 0) {
        applySampling(currentFamily, assets.length > 0)
      }

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
    [form, applySampling]
  )

  // Another family is sampled differently, so its own settings replace the ones on screen; a LoRA only
  // fits the family it was made for
  const handleModelChange = useCallback(
    (value: string) => {
      const previous = form.getValues("model")
      const next = imageFamily(value)
      // With no model yet, the settings on screen are the default family's (IMAGE_FORM_DEFAULTS)
      if (next !== (previous ? imageFamily(previous) : IMAGE_FAMILIES[0])) {
        applySampling(next, form.getValues("references").length > 0)
        form.setValue("lora", null)
      }
      form.setValue("model", value)
    },
    [form, applySampling]
  )
  const handleTextEncoderChange = useCallback(
    (value: string) => form.setValue("textEncoder", value),
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
          : sampling.steps
      ),
    [form, sampling]
  )
  const handleCfgChange = useCallback(
    (value: number | undefined) => form.setValue("cfg", value ?? sampling.cfg),
    [form, sampling]
  )
  const handleLoraChange = useCallback(
    (key: unknown) => {
      if (typeof key === "string") form.setValue("lora", key === NO_LORA ? null : key)
    },
    [form]
  )
  const handleLoraStrengthChange = useCallback(
    (value: number | undefined) =>
      form.setValue(
        "loraStrength",
        typeof value === "number" && Number.isFinite(value)
          ? value
          : LORA_STRENGTH.initial
      ),
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
  useDefaultModel(textEncoders, textEncoder, handleTextEncoderChange)

  // A LoRA that is gone (deleted since, or brought in by "Reuse settings" from an old job) is dropped
  useEffect(() => {
    if (lora && loras && !loras.includes(lora)) form.setValue("lora", null)
  }, [lora, loras, form])

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
        // An old job has none; the effect above then picks the first one installed
        textEncoder: params.textEncoder ?? "",
        aspect: params.aspect,
        tier: params.tier,
        count: params.count as ImageValidator["count"],
        steps: params.steps,
        cfg: params.cfg,
        sampler: params.sampler ?? null,
        lora: params.lora?.name ?? null,
        loraStrength: params.lora?.strength ?? LORA_STRENGTH.initial,
        seed: params.seed,
        shouldRemoveBackground: params.shouldRemoveBackground
      })
    } else if (prefill.references.length > 0) {
      // An edit follows the size of what it edits, unless told otherwise
      form.setValue("aspect", null)
      // And, as when a reference is added by hand, starts from its family's edit settings
      const currentFamily = imageFamily(form.getValues("model"))
      if (
        IMAGE_FAMILY_SAMPLING[currentFamily].edit &&
        form.getValues("references").length === 0
      ) {
        applySampling(currentFamily, true)
      }
    }

    setReferences(prefill.references)
    form.setValue(
      "references",
      prefill.references.map((asset) => asset.id)
    )
  }, [prefill, form, applySampling])

  useEffect(() => {
    if (!isActive) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // Keys pressed in a dialog belong to it: the prompt's own has a copy that isn't in the form yet
      if (event.target instanceof Element && event.target.closest("[role='dialog']"))
        return
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
      {hasTextEncoderChoice ? (
        <ModelSelect
          title='Text encoder'
          label='Text encoder'
          models={textEncoderOptions}
          value={textEncoder}
          onChange={handleTextEncoderChange}
        />
      ) : null}
      {isSdCpp ? (
        <p className='text-muted -mt-3 text-xs'>
          This model's text encoder is a GGUF, which only stable-diffusion.cpp reads: the
          job runs there instead of on ComfyUI, and loads its models anew every time.
        </p>
      ) : null}

      <FormSection title='Prompt'>
        <Controller
          control={form.control}
          name='prompt'
          render={({ field }) => (
            <PromptField
              label='Prompt'
              placeholder={
                !hasReferences
                  ? "Describe the image in plain sentences: subject, setting, light, style."
                  : family === "moss"
                    ? "Describe only the change, and what to keep: “Change only the jacket to a black wool coat. Keep the face, hair, pose and background unchanged.” With more images, say what each one is for."
                    : "What to change, in plain sentences. Say what to keep, and which image is which: “Dress the woman in image 1 in the outfit from image 2. Keep her pose.”"
              }
              {...field}
            />
          )}
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
          label={
            isTurbo
              ? `Quality · Turbo, ${IMAGE_TURBO.steps} steps`
              : isPresetQuality
                ? "Quality"
                : `Quality · custom, ${steps} steps`
          }>
          <OptionGroup
            label='Quality'
            value={shownSteps}
            options={qualityOptions}
            onChange={handleStepsChange}
            isDisabled={isTurbo}
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
          !hasCutoutModel
            ? "Needs a background removal model in ComfyUI."
            : isSdCpp
              ? "Not in a stable-diffusion.cpp job. Use Cut out on the result instead."
              : "A second copy with the background removed, as a transparent PNG."
        }
        isSelected={shouldRemoveBackground && hasCutoutModel && !isSdCpp}
        isDisabled={!hasCutoutModel || isSdCpp}
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
            disabled={isTurbo}
            placeholder='What to avoid. Leave empty unless something keeps showing up.'
            {...form.register("negative")}
          />
          {isTurbo ? (
            <p className='text-muted text-xs'>
              A Turbo model runs without guidance, so it never reads a negative prompt.
              Pick another model to use one.
            </p>
          ) : null}
        </FieldRow>
        <FieldRow label='Sampler'>
          <OptionGroup
            label='Sampler'
            value={isTurbo ? IMAGE_TURBO.sampler : (sampler ?? "auto")}
            options={SAMPLER_OPTIONS}
            onChange={handleSamplerChange}
            isDisabled={isTurbo}
          />
          <p className='text-muted text-xs'>
            {isTurbo ? (
              <>
                A Turbo model was made for one schedule: {IMAGE_TURBO.steps} steps with{" "}
                {IMAGE_SAMPLER_LABELS[IMAGE_TURBO.sampler]} at CFG {IMAGE_TURBO.cfg}. The
                sampler, steps and guidance are fixed.
              </>
            ) : (
              <>
                {sampling.samplers.create === sampling.samplers.edit
                  ? `Auto uses ${IMAGE_SAMPLER_LABELS[sampling.samplers.create]}, the one ${IMAGE_FAMILY_LABELS[family]} is known to work with.`
                  : `Auto uses ${IMAGE_SAMPLER_LABELS[sampling.samplers.create]} for a new image and ${IMAGE_SAMPLER_LABELS[sampling.samplers.edit]} for an edit, the two that are known to work.`}{" "}
                The others are there to experiment with.
              </>
            )}
          </p>
        </FieldRow>
        <div className='grid grid-cols-2 gap-3'>
          <NumberField
            fullWidth
            variant='secondary'
            minValue={1}
            maxValue={100}
            step={1}
            isDisabled={isTurbo}
            value={shownSteps}
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
            isDisabled={isTurbo}
            value={shownCfg}
            onChange={handleCfgChange}>
            <Label className='text-muted text-xs'>Guidance (CFG)</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>
        </div>
        {isTurbo ? null : (
          <p className='text-muted text-xs'>
            Quality picks {sampling.qualities.map((quality) => quality.steps).join(", ")}{" "}
            steps. Any number from 1 to 100 can be typed here instead.
          </p>
        )}
        <div className='grid grid-cols-[1fr_8rem] gap-3'>
          <FieldRow label='LoRA'>
            <Select
              aria-label='LoRA'
              fullWidth
              variant='secondary'
              isDisabled={!hasLoras}
              value={lora && loras?.includes(lora) ? lora : NO_LORA}
              onChange={handleLoraChange}>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id={NO_LORA} textValue='None'>
                    None
                    <ListBox.ItemIndicator />
                  </ListBox.Item>
                  {(loras ?? []).map((name) => (
                    <ListBox.Item key={name} id={name} textValue={loraLabel(name)}>
                      {loraLabel(name)}
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </FieldRow>
          <NumberField
            fullWidth
            variant='secondary'
            minValue={LORA_STRENGTH.min}
            maxValue={LORA_STRENGTH.max}
            step={LORA_STRENGTH.step}
            isDisabled={!hasLoras || !lora}
            value={loraStrength}
            onChange={handleLoraStrengthChange}>
            <Label className='text-muted text-xs'>Strength</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>
        </div>
        <p className='text-muted text-xs'>
          {hasLoras
            ? "A LoRA changes what the model draws, or how. Most need their trigger word at the start of the prompt: see the LoRA's own page."
            : `No LoRA for ${IMAGE_FAMILY_LABELS[family]} is installed.`}
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
        summary={`${shownSteps} steps · CFG ${shownCfg} · ${count} ${count === 1 ? "image" : "images"}`}
        blocker={blocker}
        label={hasReferences ? "Edit image" : "Generate image"}
        icon={<ImageSparkles size={18} strokeWidth={1.75} />}
        isPending={isSubmitting}
      />
    </form>
  )
}
