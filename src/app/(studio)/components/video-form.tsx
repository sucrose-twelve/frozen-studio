"use client"

import { Input, Label, NumberField, TextArea, toast } from "@heroui/react"
import { zodResolver } from "@hookform/resolvers/zod"
import { VideoSparkles } from "@keyline-icons/react"
import { useCallback, useEffect, useMemo, useState } from "react"
import { useForm, useWatch } from "react-hook-form"

import { createJob } from "@/actions/jobs/create"
import type { AssetView } from "@/actions/jobs/read"
import { videoValidator, type VideoValidator } from "@/actions/jobs/validator.zod"
import {
  ASPECTS,
  MAX_REFERENCES,
  VIDEO_FPS,
  VIDEO_RESOLUTIONS,
  VIDEO_SAMPLING,
  VIDEO_SECONDS,
  VIDEO_STEPS
} from "@/constants"
import { useEngine, useStore } from "@/hooks"
import { aspectRatioOf, countFrames, planSegments, videoSize } from "@/libs/video-plan"

import { useDefaultModel } from "../hooks/use-default-model"
import { useStudioQuery } from "../hooks/use-studio-query"
import { parseSeed, VIDEO_FORM_DEFAULTS } from "../utils"
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

const SECONDS_OPTIONS: Option<number>[] = VIDEO_SECONDS.map((seconds) => ({
  value: seconds,
  label: `${seconds}s`
}))

const RESOLUTION_OPTIONS: Option<Media.VideoResolution>[] = VIDEO_RESOLUTIONS.map(
  (resolution) => ({ value: resolution, label: `${resolution}p` })
)

const ASPECT_OPTIONS: Option<Media.Aspect>[] = ASPECTS.map((aspect) => ({
  value: aspect,
  label: aspect
}))

/**
 * What the reference slots mean at each count, shown under them.
 */
function describeSource(count: number) {
  if (count === 0) return "Text to video: the first frame is drawn from the prompt."
  if (count === 1) return "Image to video: the image is the first frame."
  return `Keyframes: the video moves through the ${count} images in order.`
}

/**
 * The Video form, on Wan 2.2: from text alone, from one image, or through several keyframes.
 */
export function VideoForm({ isActive }: Readonly<{ isActive: boolean }>) {
  const engine = useEngine()
  const prefill = useStore((state) => state.prefill)
  const { showJob } = useStudioQuery()
  const [references, setReferences] = useState<AssetView[]>([])

  const form = useForm<VideoValidator>({
    resolver: zodResolver(videoValidator),
    defaultValues: VIDEO_FORM_DEFAULTS
  })
  const { errors, isSubmitting } = form.formState
  const [
    seconds,
    resolution,
    aspect,
    isStaticCamera,
    isLoop,
    isFast,
    steps,
    seed,
    shouldSaveFrames,
    shouldRemoveBackground
  ] = useWatch({
    control: form.control,
    name: [
      "seconds",
      "resolution",
      "aspect",
      "isStaticCamera",
      "isLoop",
      "isFast",
      "steps",
      "seed",
      "shouldSaveFrames",
      "shouldRemoveBackground"
    ]
  })

  const model = useWatch({ control: form.control, name: "model" })

  const models = engine?.models
  const videoModels = models?.video?.models
  const modelNames = useMemo(() => videoModels?.map((pair) => pair.name), [videoModels])
  const modelOptions = useMemo(
    () => (modelNames ?? []).map((name) => ({ id: name, label: name })),
    [modelNames]
  )
  const hasFastModels = !!models?.video?.fastHighNoise && !!models.video.fastLowNoise
  // Fast mode as the job will actually run it: asked for, and the LoRAs are there
  const isFastRun = isFast && hasFastModels
  const hasCutoutModel = !!models?.cutout
  const isTextToVideo = references.length === 0
  const canLoop = references.length > 1

  const summary = useMemo(() => {
    const segments = planSegments(seconds, references.length, isLoop && canLoop)
    const frames = countFrames(segments)
    const first = references[0]
    const size = videoSize(
      resolution,
      first ? first.width / first.height : aspectRatioOf(aspect)
    )
    const passes = segments.length === 1 ? "1 pass" : `${segments.length} passes`

    return `${size.width} × ${size.height} · ${(frames / VIDEO_FPS).toFixed(1)}s · ${frames} frames · ${passes}`
  }, [seconds, references, isLoop, canLoop, resolution, aspect])

  const blocker = !engine
    ? "The worker is offline, so the installed models are unknown."
    : !engine.isComfyOnline
      ? "ComfyUI is offline. Start it to load the video models."
      : !models?.video
        ? "The Wan 2.2 video models aren't installed in ComfyUI."
        : isTextToVideo && !models.image
          ? "Text to video needs the image model for its first frame. Add an image instead."
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

  const handleSecondsChange = useCallback(
    (value: number) => form.setValue("seconds", value as VideoValidator["seconds"]),
    [form]
  )
  const handleResolutionChange = useCallback(
    (value: Media.VideoResolution) => form.setValue("resolution", value),
    [form]
  )
  const handleAspectChange = useCallback(
    (value: Media.Aspect) => form.setValue("aspect", value),
    [form]
  )
  const handleStaticCameraChange = useCallback(
    (isSelected: boolean) => form.setValue("isStaticCamera", isSelected),
    [form]
  )
  const handleLoopChange = useCallback(
    (isSelected: boolean) => form.setValue("isLoop", isSelected),
    [form]
  )
  const handleFastChange = useCallback(
    (isSelected: boolean) => form.setValue("isFast", isSelected),
    [form]
  )
  const handleSaveFramesChange = useCallback(
    (isSelected: boolean) => form.setValue("shouldSaveFrames", isSelected),
    [form]
  )
  const handleRemoveBackgroundChange = useCallback(
    (isSelected: boolean) => form.setValue("shouldRemoveBackground", isSelected),
    [form]
  )
  // The field hands back nothing (or not a number) while it is being cleared
  const handleStepsChange = useCallback(
    (value: number | undefined) =>
      form.setValue(
        "steps",
        typeof value === "number" && Number.isFinite(value)
          ? Math.round(value)
          : VIDEO_FORM_DEFAULTS.steps
      ),
    [form]
  )
  const handleSeedChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) =>
      form.setValue("seed", parseSeed(event.target.value)),
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

  useDefaultModel(modelNames, model, handleModelChange)

  // A result sent here from the canvas: its settings, its images, or both
  useEffect(() => {
    if (prefill?.kind !== "video") return

    // Prompts sent over from a caption: only the text changes
    if (prefill.prompt) {
      form.setValue("prompt", prefill.prompt.positive, { shouldValidate: true })
      if (prefill.prompt.negative !== undefined) {
        form.setValue("negative", prefill.prompt.negative)
      }
      return
    }

    const params = prefill.source?.params
    if (prefill.source && params?.kind === "video") {
      form.reset({
        ...VIDEO_FORM_DEFAULTS,
        // An older job names no model; the form's own stays, or the first one is picked for it
        model: params.model ?? form.getValues("model"),
        prompt: prefill.source.prompt,
        seconds: params.seconds as VideoValidator["seconds"],
        resolution: params.resolution,
        aspect: params.aspect,
        isStaticCamera: params.isStaticCamera,
        isLoop: params.isLoop,
        isFast: params.isFast,
        // A fast job stored its fixed 4 steps, which is not what the full schedule should start from
        steps: params.isFast ? VIDEO_FORM_DEFAULTS.steps : params.steps,
        negative: params.negative ?? "",
        seed: params.seed,
        shouldSaveFrames: params.shouldSaveFrames,
        shouldRemoveBackground: params.shouldRemoveBackground
      })
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
        label='Video model'
        models={modelOptions}
        value={model}
        onChange={handleModelChange}
      />

      <FormSection title='Prompt'>
        <TextArea
          aria-label='Prompt'
          fullWidth
          rows={5}
          variant='secondary'
          className='resize-y'
          placeholder={
            isTextToVideo
              ? "Describe the scene and what happens in it: subject, action, camera."
              : "Describe the motion: what moves, how, and what the camera does."
          }
          {...form.register("prompt")}
        />
        <FieldMessage message={errors.prompt?.message} />
      </FormSection>

      <FormSection
        title='Images'
        note={`${references.length} / ${MAX_REFERENCES.video} · optional`}>
        <ReferencePicker
          value={references}
          onChange={handleReferencesChange}
          max={MAX_REFERENCES.video}
          isOrdered
          isActive={isActive}
          hint='One image to animate, or several as keyframes'
        />
        <p className='text-muted text-xs'>{describeSource(references.length)}</p>
      </FormSection>

      <FormSection title='Output'>
        <FieldRow label='Length'>
          <OptionGroup
            label='Length'
            value={seconds}
            options={SECONDS_OPTIONS}
            onChange={handleSecondsChange}
          />
        </FieldRow>
        <FieldRow label='Resolution'>
          <OptionGroup
            label='Resolution'
            value={resolution}
            options={RESOLUTION_OPTIONS}
            onChange={handleResolutionChange}
          />
        </FieldRow>
        <FieldRow label={isTextToVideo ? "Aspect" : "Aspect · follows image 1"}>
          <OptionGroup
            label='Aspect'
            value={aspect}
            options={ASPECT_OPTIONS}
            onChange={handleAspectChange}
            isDisabled={!isTextToVideo}
          />
        </FieldRow>
      </FormSection>

      <div className='flex flex-col gap-3.5'>
        <SwitchField
          label='Fast mode'
          description={
            hasFastModels
              ? "4 steps with the Lightning LoRAs. Turn off for the full 20-step schedule."
              : "Needs the Wan 2.2 Lightning LoRAs in ComfyUI."
          }
          isSelected={isFast && hasFastModels}
          isDisabled={!hasFastModels}
          onChange={handleFastChange}
        />
        <SwitchField
          label='Static camera'
          description='Asks for a camera that does not move, so only the subject does.'
          isSelected={isStaticCamera}
          onChange={handleStaticCameraChange}
        />
        <SwitchField
          label='Loop back to the first image'
          description={
            canLoop
              ? "Adds a last stretch from the final keyframe to the first, for a seamless loop."
              : "Needs two or more keyframes."
          }
          isSelected={isLoop && canLoop}
          isDisabled={!canLoop}
          onChange={handleLoopChange}
        />
        <SwitchField
          label='Save frames for a sprite sheet'
          description='Keeps every frame as a PNG next to the video.'
          isSelected={shouldSaveFrames}
          onChange={handleSaveFramesChange}
        />
        <SwitchField
          label='Cut out the frames'
          description={
            hasCutoutModel
              ? "Removes the background of each saved frame. The video keeps it."
              : "Needs a background removal model in ComfyUI."
          }
          isSelected={shouldRemoveBackground && shouldSaveFrames && hasCutoutModel}
          isDisabled={!shouldSaveFrames || !hasCutoutModel}
          onChange={handleRemoveBackgroundChange}
        />
      </div>

      <FormDivider />

      <FormSection title='Advanced'>
        <FieldRow label='Negative prompt'>
          <TextArea
            aria-label='Negative prompt'
            fullWidth
            rows={2}
            variant='secondary'
            disabled={isFastRun}
            placeholder='What to keep out of the video. Leave empty unless something keeps showing up.'
            {...form.register("negative")}
          />
          <p className='text-muted text-xs'>
            {isFastRun
              ? "Fast mode ignores a negative prompt. Turn it off to use one."
              : "Added to the list Wan always gets (blur, extra fingers, frozen frames)."}
          </p>
        </FieldRow>
        <div className='grid grid-cols-2 gap-3'>
          <NumberField
            fullWidth
            variant='secondary'
            minValue={VIDEO_STEPS.min}
            maxValue={VIDEO_STEPS.max}
            step={1}
            isDisabled={isFastRun}
            value={isFastRun ? VIDEO_SAMPLING.fast.steps : steps}
            onChange={handleStepsChange}>
            <Label className='text-muted text-xs'>Steps</Label>
            <NumberField.Group>
              <NumberField.DecrementButton />
              <NumberField.Input />
              <NumberField.IncrementButton />
            </NumberField.Group>
          </NumberField>
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
        </div>
        <p className='text-muted text-xs'>
          {isFastRun
            ? `Fast mode always runs ${VIDEO_SAMPLING.fast.steps} steps. Turn it off to set them.`
            : `${VIDEO_SAMPLING.full.steps} is Wan's own setting. The time a video takes grows with the steps.`}
        </p>
      </FormSection>

      <SubmitBar
        summary={summary}
        blocker={blocker}
        label='Generate video'
        icon={<VideoSparkles size={18} strokeWidth={1.75} />}
        isPending={isSubmitting}
      />
    </form>
  )
}
