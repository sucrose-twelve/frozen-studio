"use client"

import { Button, Spinner, TextArea, toast } from "@heroui/react"
import { AudioLines } from "@keyline-icons/react"
import { useRouter } from "next/navigation"
import { useCallback, useMemo, useState } from "react"

import type { AssetView } from "@/actions/jobs/read"
import {
  ACTIVE_JOB_STATUSES,
  SPEECH_LANGUAGE_LABELS,
  SPEECH_LANGUAGES
} from "@/constants"
import { useEngine, useStore } from "@/hooks"
import { voiceFamily } from "@/libs/voice-model"

import { FieldRow, FormSection } from "../../components/form-parts"
import { ModelSelect } from "../../components/model-select"
import { OptionGroup } from "../../components/option-group"
import { useDefaultModel } from "../../hooks/use-default-model"
import { createVoiceSample } from "../actions/create"
import { deleteCharacterVoice } from "../actions/delete"

const LANGUAGE_OPTIONS = SPEECH_LANGUAGES.map((language) => ({
  value: language,
  label: SPEECH_LANGUAGE_LABELS[language]
}))

/**
 * How a character sounds: a voice model, a description of the voice, and the language it speaks in.
 *
 * "Make a sample" saves these and has the model make a voice up from the description into a short clip. The
 * character's messages are then spoken by cloning that clip, so the voice stays the same. Each sample is a
 * new voice: make another until one fits. Only VoxCPM2 can clone; the other models make a voice up for each
 * message.
 *
 * Saving here is separate from the card's Save, and needs a saved character.
 */
export function CharacterVoice({
  characterId,
  voice,
  sample
}: Readonly<{
  characterId: string
  voice: Media.CharacterVoice | null
  sample: AssetView | null
}>) {
  const router = useRouter()
  const engine = useEngine()
  const jobs = useStore((state) => state.jobs)
  const [model, setModel] = useState(voice?.model ?? "")
  const [description, setDescription] = useState(voice?.description ?? "")
  const [language, setLanguage] = useState<Media.SpeechLanguage>(voice?.language ?? "ja")
  const [jobId, setJobId] = useState<string | null>(null)
  const [isQueueing, setIsQueueing] = useState(false)
  const [isRemoving, setIsRemoving] = useState(false)

  const models = engine?.models.voice?.models
  const modelOptions = useMemo(
    () => (models ?? []).map((name) => ({ id: name, label: name })),
    [models]
  )
  const job = jobId ? jobs[jobId] : undefined
  const isMaking = !!job && (!job.status || ACTIVE_JOB_STATUSES.includes(job.status))
  const canClone = !model || voiceFamily(model) === "voxcpm"

  useDefaultModel(models, model, setModel)

  const handleMakeSample = useCallback(async () => {
    setIsQueueing(true)
    const result = await createVoiceSample({ characterId, model, description, language })
    setIsQueueing(false)

    if (result.ok) setJobId(result.jobId)
    else toast.danger(result.message)
  }, [characterId, model, description, language])

  const handleRemove = useCallback(async () => {
    setIsRemoving(true)
    const result = await deleteCharacterVoice({ id: characterId })
    setIsRemoving(false)

    if (result.ok) router.refresh()
    else toast.danger(result.message)
  }, [characterId, router])

  return (
    <div className='flex flex-col gap-5'>
      <ModelSelect
        label='Voice model'
        title='Voice'
        models={modelOptions}
        value={model}
        onChange={setModel}
      />
      {!canClone ? (
        <p className='text-warning text-xs'>
          Only VoxCPM2 keeps one voice from the sample. This model makes a voice up for
          each message, so it will change a little from one to the next.
        </p>
      ) : null}

      <FormSection title='Speaks in' note='What you read stays as written'>
        <OptionGroup
          label='Spoken language'
          value={language}
          options={LANGUAGE_OPTIONS}
          onChange={setLanguage}
        />
        <p className='text-muted text-xs'>
          {language === "ja"
            ? "What the character says is translated into Japanese by the chat model, then spoken."
            : "What the character says is spoken in the language it is written in."}
        </p>
      </FormSection>

      <FieldRow label='The voice'>
        <TextArea
          aria-label='The voice'
          fullWidth
          rows={4}
          variant='secondary'
          className='resize-y'
          maxLength={600}
          placeholder='A young woman with a soft, slightly high voice; shy, gentle, a little slow.'
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FieldRow>

      <FormSection
        title='Sample'
        note={sample ? "Messages clone this voice" : "None yet"}>
        {sample ? (
          <audio controls preload='metadata' src={sample.url} className='w-full' />
        ) : null}
        {isMaking ? (
          <span className='text-muted flex items-center gap-2 text-sm'>
            <Spinner size='sm' color='current' />
            {job?.progress?.label ?? "Waiting for the engine"}
          </span>
        ) : null}
        {job?.status === "failed" ? (
          <p className='text-danger text-sm'>{job.error}</p>
        ) : null}
        <div className='flex gap-2'>
          <Button
            variant='secondary'
            size='sm'
            isPending={isQueueing || isMaking}
            isDisabled={!model || !description.trim()}
            onPress={handleMakeSample}>
            <AudioLines size={14} strokeWidth={1.75} />
            {sample ? "Make another sample" : "Make a sample"}
          </Button>
          {voice ? (
            <Button
              variant='ghost'
              size='sm'
              isPending={isRemoving}
              onPress={handleRemove}>
              Remove the voice
            </Button>
          ) : null}
        </div>
        <p className='text-muted text-xs'>
          Saves the voice and makes a new one from the description. Changing the
          description takes effect with the next sample.
        </p>
      </FormSection>
    </div>
  )
}
