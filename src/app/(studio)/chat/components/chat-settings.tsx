"use client"

import { Button, Input, Label, NumberField, TextArea, toast } from "@heroui/react"
import { useRouter } from "next/navigation"
import { useCallback, useMemo, useState } from "react"

import {
  CHAT_MAX_FIELD_LENGTH,
  CHAT_MAX_SUMMARY_LENGTH,
  CHAT_SAMPLING_LIMITS
} from "@/constants"
import { useEngine } from "@/hooks"
import { chatModelLabel } from "@/libs/chat"

import { FieldRow, FormDivider, FormSection } from "../../components/form-parts"
import { ModelSelect } from "../../components/model-select"
import type { ChatThread } from "../actions/read"
import { updateChatSettings, updatePersona, updateStory } from "../actions/update"

type SamplingKey = keyof Media.ChatSampling

const SAMPLING_FIELDS: { key: SamplingKey; label: string }[] = [
  { key: "temperature", label: "Temperature" },
  { key: "minP", label: "Min P" },
  { key: "repeatPenalty", label: "Repeat penalty" },
  { key: "dryMultiplier", label: "DRY" },
  { key: "maxTokens", label: "Max tokens" }
]

/**
 * Who the user is in every chat: a name for `{{user}}`, and a description the character is told.
 */
function PersonaForm({
  persona
}: Readonly<{ persona: { name: string; description: string } }>) {
  const router = useRouter()
  const [name, setName] = useState(persona.name)
  const [description, setDescription] = useState(persona.description)
  const [isSaving, setIsSaving] = useState(false)
  const isChanged = name !== persona.name || description !== persona.description

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    const result = await updatePersona({ name, description })
    setIsSaving(false)

    if (result.ok) router.refresh()
    else toast.danger(result.message)
  }, [name, description, router])

  return (
    <FormSection title='You' note='In every chat'>
      <FieldRow label='Name'>
        <Input
          aria-label='Your name'
          fullWidth
          variant='secondary'
          maxLength={100}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </FieldRow>
      <FieldRow label='About you'>
        <TextArea
          aria-label='About you'
          fullWidth
          rows={4}
          variant='secondary'
          className='resize-y'
          placeholder='What the character knows about you'
          maxLength={CHAT_MAX_FIELD_LENGTH}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FieldRow>
      <Button
        variant='secondary'
        size='sm'
        isDisabled={!isChanged || !name.trim()}
        isPending={isSaving}
        onPress={handleSave}>
        Save
      </Button>
    </FormSection>
  )
}

/**
 * The chat's summary of its older messages, editable so a wrong or missing fact can be put right. Replies read
 * it in place of the messages it covers.
 */
function StoryForm({ story }: Readonly<{ story: NonNullable<ChatThread["story"]> }>) {
  const router = useRouter()
  const [text, setText] = useState(story.text)
  const [isSaving, setIsSaving] = useState(false)

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    const result = await updateStory({ messageId: story.messageId, text })
    setIsSaving(false)

    if (result.ok) router.refresh()
    else toast.danger(result.message)
  }, [story.messageId, text, router])

  return (
    <>
      <TextArea
        aria-label='The story so far'
        fullWidth
        rows={10}
        variant='secondary'
        className='resize-y'
        maxLength={CHAT_MAX_SUMMARY_LENGTH}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
      <Button
        variant='secondary'
        size='sm'
        isDisabled={text === story.text || !text.trim()}
        isPending={isSaving}
        onPress={handleSave}>
        Save
      </Button>
    </>
  )
}

/**
 * The right panel: the character's portrait, then the chat's model and sampling, saved as they change and
 * used from the next reply on, then the user's persona.
 */
export function ChatSettings({
  thread,
  persona
}: Readonly<{
  thread: ChatThread | null
  persona: { name: string; description: string }
}>) {
  const router = useRouter()
  const engine = useEngine()
  const [settings, setSettings] = useState(thread?.settings ?? null)

  const models = useMemo(
    () =>
      (engine?.models.chat?.models ?? []).map((model) => ({
        id: model,
        label: chatModelLabel(model)
      })),
    [engine]
  )

  const save = useCallback(
    async (next: Media.ChatSettings) => {
      if (!thread) return

      setSettings(next)
      const result = await updateChatSettings({ chatId: thread.id, ...next })
      if (result.ok) router.refresh()
      else toast.danger(result.message)
    },
    [thread, router]
  )

  const handleModelChange = useCallback(
    (model: string) => {
      if (settings && model !== settings.model) void save({ ...settings, model })
    },
    [settings, save]
  )

  const handleSamplingChange = useCallback(
    (key: SamplingKey, value: number | undefined) => {
      if (!settings || value === undefined || Number.isNaN(value)) return
      void save({ ...settings, sampling: { ...settings.sampling, [key]: value } })
    },
    [settings, save]
  )

  const portrait = thread?.character.portrait ?? null

  return (
    <aside className='border-separator flex min-h-0 flex-col overflow-hidden border-l'>
      <div className='flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-4'>
        {portrait ? (
          // The portrait at full quality, like a result on the canvas
          <img
            src={portrait.url}
            alt={`${thread?.character.name ?? "The character"}'s portrait`}
            className='bg-surface-secondary max-h-[22rem] w-full rounded-xl object-contain'
          />
        ) : null}

        {thread && settings ? (
          <>
            <ModelSelect
              label='Chat model'
              models={models}
              value={settings.model}
              onChange={handleModelChange}
            />
            <FormSection title='Sampling' note='From the next reply'>
              <div className='flex flex-col gap-3'>
                {SAMPLING_FIELDS.map(({ key, label }) => {
                  const limits = CHAT_SAMPLING_LIMITS[key]

                  return (
                    <NumberField
                      key={key}
                      fullWidth
                      variant='secondary'
                      minValue={limits.min}
                      maxValue={limits.max}
                      step={limits.step}
                      value={settings.sampling[key]}
                      onChange={(value) => handleSamplingChange(key, value)}>
                      <Label className='text-muted text-xs'>{label}</Label>
                      <NumberField.Group>
                        <NumberField.DecrementButton />
                        <NumberField.Input />
                        <NumberField.IncrementButton />
                      </NumberField.Group>
                    </NumberField>
                  )
                })}
              </div>
              <p className='text-muted text-xs'>
                DRY keeps the character from repeating what it said in its last few
                replies; 0 turns it off. A lower temperature makes the replies more alike.
              </p>
            </FormSection>
            <FormDivider />
            <FormSection
              title='Story so far'
              note={
                thread.story ? `The first ${thread.story.covers} messages` : "None yet"
              }>
              {thread.story ? (
                <StoryForm
                  key={`${thread.story.messageId}-${thread.story.text}`}
                  story={thread.story}
                />
              ) : null}
              <p className='text-muted text-xs'>
                When the chat grows too long for the model to read at once, its older
                messages are summarized here, and replies read the summary instead.
                Editing a message it covers makes a new one.
              </p>
            </FormSection>
            <FormDivider />
          </>
        ) : null}

        <PersonaForm persona={persona} />
      </div>
    </aside>
  )
}
