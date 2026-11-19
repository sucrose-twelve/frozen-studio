"use client"

import { Input, ListBox, Select, TextArea, toast } from "@heroui/react"
import { zodResolver } from "@hookform/resolvers/zod"
import { Mic } from "@keyline-icons/react"
import { useCallback, useEffect, useMemo } from "react"
import { useForm, useWatch } from "react-hook-form"

import { createJob } from "@/actions/jobs/create"
import { voiceValidator, type VoiceValidator } from "@/actions/jobs/validator.zod"
import { VOICE_CUSTOM, VOICE_MAX_LINES, VOICE_PRESETS } from "@/constants"
import { useEngine, useStore } from "@/hooks"
import { scriptLines } from "@/libs/job"

import { useStudioQuery } from "../hooks/use-studio-query"
import { parseSeed, VOICE_FORM_DEFAULTS, voiceLabel } from "../utils"
import { FieldMessage, FieldRow, FormDivider, FormSection } from "./form-parts"
import { SubmitBar } from "./submit-bar"

const VOICE_OPTIONS = [
  ...VOICE_PRESETS.map((preset) => ({
    id: preset.id as string,
    label: preset.label as string
  })),
  { id: VOICE_CUSTOM, label: voiceLabel(VOICE_CUSTOM) }
]

/**
 * The Voice form: a script in Japanese, spoken one clip per line by Japanese Parler-TTS.
 *
 * The voice isn't picked from a list of speakers. The model is told what the speaker sounds like, in
 * English, and the presets are such descriptions; editing one makes it a custom voice.
 */
export function VoiceForm({ isActive }: Readonly<{ isActive: boolean }>) {
  const engine = useEngine()
  const prefill = useStore((state) => state.prefill)
  const { showJob } = useStudioQuery()

  const form = useForm<VoiceValidator>({
    resolver: zodResolver(voiceValidator),
    defaultValues: VOICE_FORM_DEFAULTS
  })
  const { errors, isSubmitting } = form.formState
  const [prompt, voice, seed] = useWatch({
    control: form.control,
    name: ["prompt", "voice", "seed"]
  })

  const lineCount = useMemo(() => scriptLines(prompt).length, [prompt])
  const blocker = !engine
    ? "The worker is offline, so the voice engine can't be checked."
    : !engine.models.voice
      ? "The voice engine isn't installed. The README says how to set it up."
      : null
  const summary =
    lineCount === 0
      ? "Every line of the script becomes its own clip."
      : `${lineCount} ${lineCount === 1 ? "clip" : "clips"} · ${voiceLabel(voice)}`

  // Typing in the description makes the voice the user's own, whichever preset it started from
  const handleDescriptionChange = useCallback(
    () => form.setValue("voice", VOICE_CUSTOM),
    [form]
  )
  const handleVoiceChange = useCallback(
    (key: unknown) => {
      if (key === VOICE_CUSTOM) {
        form.setValue("voice", VOICE_CUSTOM)
        return
      }

      const preset = VOICE_PRESETS.find((item) => item.id === key)
      if (!preset) return

      form.setValue("voice", preset.id)
      form.setValue("description", preset.description, { shouldValidate: true })
    },
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

  // "Reuse settings" on a voice result: its script, voice and seed
  useEffect(() => {
    const source = prefill?.kind === "voice" ? prefill.source : null
    if (source?.params.kind !== "voice") return

    form.reset({
      kind: "voice",
      prompt: source.prompt,
      voice: source.params.voice,
      description: source.params.description,
      seed: source.params.seed
    })
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
      <FormSection
        title='Script'
        note={`${lineCount} / ${VOICE_MAX_LINES} lines · Japanese`}>
        <TextArea
          aria-label='Script'
          lang='ja'
          fullWidth
          rows={7}
          variant='secondary'
          className='resize-y'
          placeholder={
            "One line of dialogue per row. Each row becomes its own clip.\n\nこんにちは、今日はどのようにお過ごしですか？"
          }
          {...form.register("prompt")}
        />
        <FieldMessage message={errors.prompt?.message} />
      </FormSection>

      <FormSection title='Voice' note='Japanese Parler-TTS'>
        <Select
          aria-label='Voice'
          fullWidth
          variant='secondary'
          value={voice}
          onChange={handleVoiceChange}>
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {VOICE_OPTIONS.map((option) => (
                <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
                  {option.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <FieldRow label='Description'>
          <TextArea
            aria-label='Voice description'
            fullWidth
            rows={4}
            variant='secondary'
            className='resize-y'
            placeholder='In English: who is speaking, how high or low, how fast, in what tone, and how the recording sounds.'
            // Registered on every render like the other fields: a reset drops the fields react-hook-form
            // knows, and only a fresh `register` hands this one back to it
            {...form.register("description", { onChange: handleDescriptionChange })}
          />
          <FieldMessage message={errors.description?.message} />
        </FieldRow>
        <p className='text-muted text-xs'>
          The description is what shapes the voice: pitch, pace, tone. This model only has
          female voices.
        </p>
      </FormSection>

      <FormDivider />

      <FormSection title='Advanced'>
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
        <p className='text-muted text-xs'>
          Every line of a job is spoken with the same seed. Reuse a seed with the same
          description to stay close to a voice you liked.
        </p>
      </FormSection>

      <SubmitBar
        summary={summary}
        blocker={blocker}
        label='Generate voice'
        icon={<Mic size={18} strokeWidth={1.75} />}
        isPending={isSubmitting}
      />
    </form>
  )
}
