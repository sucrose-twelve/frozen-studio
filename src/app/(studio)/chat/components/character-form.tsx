"use client"

import {
  AlertDialog,
  Button,
  Input,
  TextArea,
  toast,
  useOverlayState
} from "@heroui/react"
import { zodResolver } from "@hookform/resolvers/zod"
import { ArrowLeft, Bin, Plus, X } from "@keyline-icons/react"
import NextLink from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useMemo, useState } from "react"
import { useFieldArray, useForm } from "react-hook-form"

import type { AssetView } from "@/actions/jobs/read"
import { CHAT_MAX_FIELD_LENGTH } from "@/constants"

import {
  FieldMessage,
  FieldRow,
  FormDivider,
  FormSection
} from "../../components/form-parts"
import { ReferencePicker } from "../../components/reference-picker"
import { createCharacter } from "../actions/create"
import { deleteCharacter } from "../actions/delete"
import type { CharacterDetail } from "../actions/read"
import { updateCharacter } from "../actions/update"
import { characterValidator, type CharacterValidator } from "../validator.zod"
import { CharacterVoice } from "./character-voice"

/**
 * The long text fields of a card, in the order the model reads them.
 */
const TEXT_FIELDS = [
  {
    name: "description",
    title: "Description",
    hint: "Looks, age, background, what they like and dislike.",
    rows: 8
  },
  {
    name: "personality",
    title: "Personality",
    hint: "How they behave, and what changes it.",
    rows: 6
  },
  {
    name: "speakingStyle",
    title: "Speaking style",
    hint: "Words, rhythm, politeness, the actions they show between asterisks.",
    rows: 5
  },
  {
    name: "scenario",
    title: "Scenario",
    hint: "Where the chat starts and what is going on. {{user}} is you.",
    rows: 5
  },
  {
    name: "exampleDialogues",
    title: "Example dialogue",
    hint: "A few exchanges as {{user}}: … / {{char}}: … lines. The model copies their voice and language.",
    rows: 10
  },
  {
    name: "systemPrompt",
    title: "System prompt",
    hint: "Rules for the model: stay in character, which language to answer in. Empty uses a short default.",
    rows: 8
  }
] as const satisfies readonly {
  name: keyof CharacterValidator
  title: string
  hint: string
  rows: number
}[]

/**
 * Deletes the character after asking.
 */
function DeleteCharacterButton({ id, name }: Readonly<{ id: string; name: string }>) {
  const router = useRouter()
  const dialog = useOverlayState()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = useCallback(async () => {
    setIsDeleting(true)
    const result = await deleteCharacter({ id })
    setIsDeleting(false)

    if (!result.ok) {
      toast.danger(result.message)
      return
    }
    dialog.close()
    router.push("/chat")
  }, [id, dialog, router])

  return (
    <>
      <Button variant='danger-soft' onPress={dialog.open}>
        <Bin size={15} strokeWidth={1.75} />
        Delete
      </Button>

      <AlertDialog.Backdrop isOpen={dialog.isOpen} onOpenChange={dialog.setOpen}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className='max-w-[400px]'>
            <AlertDialog.Header>
              <AlertDialog.Icon status='danger' />
              <AlertDialog.Heading>Delete {name}?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                The character and every chat with them are deleted. This can&apos;t be
                undone. The pictures stay as uploads.
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot='close' variant='tertiary'>
                Cancel
              </Button>
              <Button variant='danger' isPending={isDeleting} onPress={handleDelete}>
                Delete
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  )
}

/**
 * The character editor: pictures on the left, the card on the right. Saving goes back to the Chat page
 * with the character open.
 *
 * `{{char}}` and `{{user}}` in any field stand for the character's name and yours.
 */
export function CharacterForm({
  character
}: Readonly<{ character: CharacterDetail | null }>) {
  const router = useRouter()
  const [avatar, setAvatar] = useState<AssetView[]>(
    character?.avatar ? [character.avatar] : []
  )
  const [portrait, setPortrait] = useState<AssetView[]>(
    character?.portrait ? [character.portrait] : []
  )

  const defaultValues = useMemo<CharacterValidator>(
    () => ({
      id: character?.id ?? null,
      name: character?.name ?? "",
      avatarAssetId: character?.avatar?.id ?? null,
      portraitAssetId: character?.portrait?.id ?? null,
      description: character?.description ?? "",
      personality: character?.personality ?? "",
      speakingStyle: character?.speakingStyle ?? "",
      scenario: character?.scenario ?? "",
      greetings: (character?.greetings.length ? character.greetings : [""]).map(
        (text) => ({
          text
        })
      ),
      exampleDialogues: character?.exampleDialogues ?? "",
      systemPrompt: character?.systemPrompt ?? "",
      tags: character?.tags.join(", ") ?? ""
    }),
    [character]
  )

  const form = useForm<CharacterValidator>({
    resolver: zodResolver(characterValidator),
    defaultValues
  })
  const greetings = useFieldArray({ control: form.control, name: "greetings" })
  const { errors, isSubmitting } = form.formState

  const handleAvatarChange = useCallback(
    (assets: AssetView[]) => {
      setAvatar(assets)
      form.setValue("avatarAssetId", assets[0]?.id ?? null)
    },
    [form]
  )
  const handlePortraitChange = useCallback(
    (assets: AssetView[]) => {
      setPortrait(assets)
      form.setValue("portraitAssetId", assets[0]?.id ?? null)
    },
    [form]
  )

  const handleAddGreeting = useCallback(() => greetings.append({ text: "" }), [greetings])

  const handleSubmit = useMemo(
    () =>
      form.handleSubmit(async (values) => {
        const result = values.id
          ? await updateCharacter(values)
          : await createCharacter(values)

        if (result.ok) router.push(`/chat?character=${result.id}`)
        else toast.danger(result.message)
      }),
    [form, router]
  )

  return (
    <form
      onSubmit={handleSubmit}
      className='mx-auto grid h-[calc(100svh-4rem)] max-w-6xl grid-cols-[20rem_minmax(0,1fr)] gap-4 p-4'>
      <aside className='use-panel flex min-h-0 flex-col gap-5 overflow-y-auto p-4'>
        <NextLink
          href={character ? `/chat?character=${character.id}` : "/chat"}
          className='text-muted hover:text-foreground inline-flex items-center gap-1.5 text-sm transition-colors'>
          <ArrowLeft size={14} strokeWidth={1.75} />
          Back to chats
        </NextLink>
        <FormSection title='Avatar' note='Beside each reply'>
          <ReferencePicker
            value={avatar}
            onChange={handleAvatarChange}
            max={1}
            hint='A square picture works best.'
            isActive={false}
          />
        </FormSection>
        <FormSection title='Portrait' note='Beside the chat'>
          <ReferencePicker
            value={portrait}
            onChange={handlePortraitChange}
            max={1}
            hint='A tall picture of the whole character.'
            isActive={false}
          />
        </FormSection>
        <FormDivider />
        {character ? (
          <CharacterVoice
            characterId={character.id}
            voice={character.voice}
            sample={character.voiceSample}
          />
        ) : (
          <FormSection title='Voice'>
            <p className='text-muted text-xs'>
              Create the character first, then give them a voice.
            </p>
          </FormSection>
        )}
      </aside>

      <section className='use-panel flex min-h-0 flex-col overflow-hidden'>
        <div className='flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5'>
          <h1 className='text-lg font-semibold'>
            {character ? `Edit ${character.name}` : "New character"}
          </h1>

          <div className='grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-4'>
            <FieldRow label='Name'>
              <Input
                aria-label='Name'
                fullWidth
                variant='secondary'
                maxLength={100}
                {...form.register("name")}
              />
              <FieldMessage message={errors.name?.message} />
            </FieldRow>
            <FieldRow label='Tags'>
              <Input
                aria-label='Tags'
                fullWidth
                variant='secondary'
                placeholder='Shy, Alchemist, Glasses'
                {...form.register("tags")}
              />
            </FieldRow>
          </div>

          {TEXT_FIELDS.map((field) => (
            <FormSection key={field.name} title={field.title} note={field.hint}>
              <TextArea
                aria-label={field.title}
                fullWidth
                rows={field.rows}
                variant='secondary'
                className='resize-y'
                maxLength={CHAT_MAX_FIELD_LENGTH}
                {...form.register(field.name)}
              />
              <FieldMessage message={errors[field.name]?.message} />
            </FormSection>
          ))}

          <FormDivider />

          <FormSection
            title='Greetings'
            note='How a new chat opens. With several, swipe between them'>
            {greetings.fields.map((greeting, index) => (
              <div key={greeting.id} className='flex items-start gap-2'>
                <TextArea
                  aria-label={`Greeting ${index + 1}`}
                  fullWidth
                  rows={6}
                  variant='secondary'
                  className='resize-y'
                  maxLength={CHAT_MAX_FIELD_LENGTH}
                  {...form.register(`greetings.${index}.text`)}
                />
                <Button
                  variant='ghost'
                  size='sm'
                  isIconOnly
                  aria-label={`Remove greeting ${index + 1}`}
                  isDisabled={greetings.fields.length === 1}
                  onPress={() => greetings.remove(index)}>
                  <X size={14} strokeWidth={1.75} />
                </Button>
              </div>
            ))}
            <Button variant='tertiary' size='sm' onPress={handleAddGreeting}>
              <Plus size={14} strokeWidth={1.75} />
              Add a greeting
            </Button>
          </FormSection>
        </div>

        <div className='border-separator flex items-center justify-between gap-3 border-t p-4'>
          {character ? (
            <DeleteCharacterButton id={character.id} name={character.name} />
          ) : (
            <span />
          )}
          <Button type='submit' variant='primary' isPending={isSubmitting}>
            {character ? "Save" : "Create"}
          </Button>
        </div>
      </section>
    </form>
  )
}
