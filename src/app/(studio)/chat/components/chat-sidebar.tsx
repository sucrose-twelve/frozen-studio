"use client"

import {
  AlertDialog,
  Button,
  ListBox,
  Select,
  toast,
  Tooltip,
  useOverlayState
} from "@heroui/react"
import { Bin, MessagePlus, PenLine, UserPlus } from "@keyline-icons/react"
import NextLink from "next/link"
import { useRouter } from "next/navigation"
import { useCallback, useState } from "react"

import { useEngine } from "@/hooks"
import { cls } from "@/libs/utils"

import { createChat } from "../actions/create"
import { deleteChat } from "../actions/delete"
import type { CharacterSummary, ChatSummary } from "../actions/read"
import { useChatQuery } from "../hooks/use-chat-query"
import { chatLabel } from "../utils"
import { CharacterAvatar } from "./character-avatar"

/**
 * Deletes a chat after asking: its messages go with it.
 */
function DeleteChatButton({
  chat,
  characterId,
  isCurrent
}: Readonly<{
  chat: ChatSummary
  characterId: string
  isCurrent: boolean
}>) {
  const router = useRouter()
  const { showCharacter } = useChatQuery()
  const dialog = useOverlayState()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = useCallback(async () => {
    setIsDeleting(true)
    const result = await deleteChat({ id: chat.id })
    setIsDeleting(false)

    if (!result.ok) {
      toast.danger(result.message)
      return
    }
    dialog.close()
    // The chat on screen gives way to its character's list; the URL change reloads the page
    if (isCurrent) void showCharacter(characterId)
    else router.refresh()
  }, [chat.id, characterId, dialog, isCurrent, showCharacter, router])

  return (
    <>
      <Button
        variant='ghost'
        size='sm'
        isIconOnly
        aria-label={`Delete the chat of ${chatLabel(chat)}`}
        className='opacity-0 group-focus-within:opacity-100 group-hover:opacity-100'
        onPress={dialog.open}>
        <Bin size={14} strokeWidth={1.75} />
      </Button>

      <AlertDialog.Backdrop isOpen={dialog.isOpen} onOpenChange={dialog.setOpen}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className='max-w-[400px]'>
            <AlertDialog.Header>
              <AlertDialog.Icon status='danger' />
              <AlertDialog.Heading>Delete this chat?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                Every message in it is deleted, with every other take of each reply. This
                can&apos;t be undone. The character stays.
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
 * A link drawn as an icon button, named by a tooltip.
 */
function IconLink({
  href,
  label,
  children
}: Readonly<{ href: string; label: string; children: React.ReactNode }>) {
  return (
    <Tooltip delay={200}>
      <Tooltip.Trigger>
        <NextLink
          href={href}
          aria-label={label}
          className='text-muted hover:bg-surface-secondary hover:text-foreground grid size-9 shrink-0 place-items-center rounded-xl transition-colors'>
          {children}
        </NextLink>
      </Tooltip.Trigger>
      <Tooltip.Content placement='bottom' className='text-xs'>
        {label}
      </Tooltip.Content>
    </Tooltip>
  )
}

/**
 * The left panel: a dropdown of the characters, with buttons to edit the one picked and to make another,
 * then that character's chats, the latest first, under a button to start another.
 *
 * A new chat runs on the first installed model; its settings panel changes that.
 */
export function ChatSidebar({
  characters,
  openCharacterId,
  currentChatId
}: Readonly<{
  characters: CharacterSummary[]
  openCharacterId: string | null
  currentChatId: string | null
}>) {
  const engine = useEngine()
  const { showChat, showCharacter } = useChatQuery()
  const [isCreating, setIsCreating] = useState(false)
  const model = engine?.models.chat?.models[0] ?? null
  const character = characters.find((item) => item.id === openCharacterId) ?? null

  const handleNewChat = useCallback(async () => {
    if (!model || !character) return

    setIsCreating(true)
    const result = await createChat({ characterId: character.id, model })
    setIsCreating(false)

    if (result.ok) void showChat(result.id)
    else toast.danger(result.message)
  }, [model, character, showChat])

  const handleCharacterChange = useCallback(
    (key: unknown) => {
      if (typeof key === "string" && key !== openCharacterId) void showCharacter(key)
    },
    [openCharacterId, showCharacter]
  )

  return (
    <aside className='border-separator flex min-h-0 flex-col overflow-hidden border-r'>
      <div className='border-separator flex flex-col gap-3 border-b p-4'>
        <div className='flex items-center gap-1'>
          {characters.length > 0 ? (
            <Select
              aria-label='Character'
              fullWidth
              variant='secondary'
              className='min-w-0 flex-1'
              value={character?.id ?? null}
              onChange={handleCharacterChange}>
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  {characters.map((item) => (
                    <ListBox.Item key={item.id} id={item.id} textValue={item.name}>
                      <span className='flex min-w-0 items-center gap-2'>
                        <CharacterAvatar
                          name={item.name}
                          avatar={item.avatar}
                          size={24}
                        />
                        <span className='truncate'>{item.name}</span>
                      </span>
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          ) : (
            <p className='text-muted min-w-0 flex-1 text-sm'>No characters yet.</p>
          )}
          {character ? (
            <IconLink
              href={`/chat/characters/${character.id}`}
              label='Edit this character'>
              <PenLine size={16} strokeWidth={1.75} />
            </IconLink>
          ) : null}
          <IconLink href='/chat/characters/new' label='New character'>
            <UserPlus size={16} strokeWidth={1.75} />
          </IconLink>
        </div>

        {character ? (
          <Button
            variant='secondary'
            fullWidth
            isDisabled={!model}
            isPending={isCreating}
            onPress={() => void handleNewChat()}>
            <MessagePlus size={16} strokeWidth={1.75} />
            New chat
          </Button>
        ) : null}
        {character && !model ? (
          <p className='text-muted text-xs'>
            Needs llama-server and a GGUF model in chat/models.
          </p>
        ) : null}
      </div>

      <ul className='flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-4 py-3'>
        {characters.length === 0 ? (
          <li className='text-muted p-3 text-sm'>
            Make one with New character, or import a card with
            <code className='text-foreground'> bun tests/import-character.spec.ts</code>.
          </li>
        ) : null}
        {character && character.chats.length === 0 ? (
          <li className='text-muted p-3 text-sm'>No chats with {character.name} yet.</li>
        ) : null}

        {character?.chats.map((chat) => {
          const isCurrent = chat.id === currentChatId

          return (
            <li key={chat.id} className='group flex items-center gap-1'>
              <button
                type='button'
                aria-current={isCurrent ? "page" : undefined}
                onClick={() => void showChat(chat.id)}
                className={cls(
                  "min-w-0 flex-1 truncate rounded-lg px-3 py-2 text-left text-sm transition-colors",
                  isCurrent
                    ? "bg-default text-foreground"
                    : "text-muted hover:bg-surface-secondary/60 hover:text-foreground"
                )}>
                {chatLabel(chat)}
              </button>
              <DeleteChatButton
                chat={chat}
                characterId={character.id}
                isCurrent={isCurrent}
              />
            </li>
          )
        })}
      </ul>
    </aside>
  )
}
