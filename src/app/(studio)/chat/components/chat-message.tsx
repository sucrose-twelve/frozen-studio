"use client"

import {
  AlertDialog,
  Button,
  Spinner,
  TextArea,
  toast,
  useOverlayState
} from "@heroui/react"
import {
  Bin,
  ChevronLeft,
  ChevronRight,
  PenLine,
  RefreshCw,
  Volume
} from "@keyline-icons/react"
import { useCallback, useState } from "react"

import type { AssetView } from "@/actions/jobs/read"
import { ACTIVE_JOB_STATUSES, CHAT_MAX_FIELD_LENGTH } from "@/constants"
import { useStore } from "@/hooks"
import { cls } from "@/libs/utils"

import { speakMessage } from "../actions/create"
import { deleteMessage } from "../actions/delete"
import type { ThreadMessage } from "../actions/read"
import { editMessage, selectSwipe } from "../actions/update"
import { messageParts } from "../utils"
import { CharacterAvatar } from "./character-avatar"
import { MessageSpeech } from "./message-speech"

/**
 * A message's text, with the actions between asterisks set apart from what is said.
 */
function MessageText({ text }: Readonly<{ text: string }>) {
  return (
    <p className='text-[15px] leading-relaxed whitespace-pre-wrap'>
      {messageParts(text).map((part, index) =>
        part.isAction ? (
          <em key={index} className='text-muted'>
            {part.text}
          </em>
        ) : (
          <span key={index}>{part.text}</span>
        )
      )}
    </p>
  )
}

/**
 * Deletes a message and what followed it, after asking.
 */
function DeleteMessageButton({
  messageId,
  isDisabled,
  onDone
}: Readonly<{
  messageId: string
  isDisabled: boolean
  onDone: () => void
}>) {
  const dialog = useOverlayState()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = useCallback(async () => {
    setIsDeleting(true)
    const result = await deleteMessage({ id: messageId })
    setIsDeleting(false)

    if (!result.ok) {
      toast.danger(result.message)
      return
    }
    dialog.close()
    onDone()
  }, [messageId, dialog, onDone])

  return (
    <>
      <Button
        variant='ghost'
        size='sm'
        isIconOnly
        aria-label='Delete this message and everything after it'
        isDisabled={isDisabled}
        onPress={dialog.open}>
        <Bin size={14} strokeWidth={1.75} />
      </Button>

      <AlertDialog.Backdrop isOpen={dialog.isOpen} onOpenChange={dialog.setOpen}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className='max-w-[400px]'>
            <AlertDialog.Header>
              <AlertDialog.Icon status='danger' />
              <AlertDialog.Heading>Delete from here?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                This message goes, with everything that came after it on every branch.
                This can&apos;t be undone.
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
 * One message of the thread. The character's sit on the left beside its avatar, the user's on the right.
 *
 * A reply being written shows the text so far (`liveText`), or what the engine is doing before the first
 * words. Under each message: its takes (‹ 2/3 ›) when there are several, and Edit and Delete; the last
 * reply also has Regenerate.
 *
 * @param isBusy - A reply is on the way in this chat, so nothing that changes the branch can run
 * @param canSpeak - The character has a voice, so its messages can be said aloud
 * @param onChanged - Called after an action changed the chat, to load it again
 * @param onRegenerate - Writes another take of this reply
 */
export function ChatMessage({
  message,
  characterName,
  characterAvatar,
  userName,
  liveText,
  liveStatus,
  liveError,
  progressLabel,
  isLast,
  isBusy,
  canSpeak,
  onChanged,
  onRegenerate
}: Readonly<{
  message: ThreadMessage
  characterName: string
  characterAvatar: AssetView | null
  userName: string
  liveText: string | null
  liveStatus: Media.JobStatus | null
  liveError: string | null
  progressLabel: string | null
  isLast: boolean
  isBusy: boolean
  canSpeak: boolean
  onChanged: () => void
  onRegenerate: (parentId: string) => void
}>) {
  const [draft, setDraft] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isSwiping, setIsSwiping] = useState(false)
  const [isQueueingSpeech, setIsQueueingSpeech] = useState(false)
  // Set when the user asks to hear the message, so its clip plays as soon as it is ready
  const [isWaitingToHear, setIsWaitingToHear] = useState(false)
  const speechStatus = useStore((state) =>
    message.speech ? (state.jobs[message.speech.jobId]?.status ?? null) : null
  )

  const isUser = message.role === "user"
  const status = liveStatus ?? message.job?.status ?? null
  const isWriting = !!status && ACTIVE_JOB_STATUSES.includes(status)
  const text = isWriting
    ? (liveText ?? message.content)
    : message.content || (liveText ?? "")
  const error = status === "failed" ? (liveError ?? message.job?.error ?? null) : null
  const canRegenerate = !isUser && isLast && message.parentId !== null && !isBusy
  const isSpeaking =
    !!message.speech &&
    ACTIVE_JOB_STATUSES.includes(speechStatus ?? message.speech.status)

  const handleEdit = useCallback(() => setDraft(message.content), [message.content])
  const handleCancelEdit = useCallback(() => setDraft(null), [])

  const handleSave = useCallback(async () => {
    if (draft === null) return

    setIsSaving(true)
    const result = await editMessage({ id: message.id, content: draft })
    setIsSaving(false)

    if (!result.ok) {
      toast.danger(result.message)
      return
    }
    setDraft(null)
    onChanged()
  }, [draft, message.id, onChanged])

  const handleSwipe = useCallback(
    async (id: string | null) => {
      if (!id) return

      setIsSwiping(true)
      const result = await selectSwipe({ id })
      setIsSwiping(false)

      if (result.ok) onChanged()
      else toast.danger(result.message)
    },
    [onChanged]
  )

  const handleSpeak = useCallback(async () => {
    setIsQueueingSpeech(true)
    const result = await speakMessage({ id: message.id })
    setIsQueueingSpeech(false)

    if (!result.ok) {
      toast.danger(result.message)
      return
    }
    setIsWaitingToHear(true)
    onChanged()
  }, [message.id, onChanged])

  const handlePlayed = useCallback(() => setIsWaitingToHear(false), [])

  const handleRegenerate = useCallback(() => {
    if (message.parentId) onRegenerate(message.parentId)
  }, [message.parentId, onRegenerate])

  return (
    <article className={cls("group flex gap-3", isUser && "flex-row-reverse")}>
      {isUser ? null : (
        <CharacterAvatar name={characterName} avatar={characterAvatar} size={40} />
      )}

      <div
        className={cls(
          "flex max-w-[44rem] min-w-0 flex-col gap-1",
          isUser && "items-end"
        )}>
        <span className='text-muted px-1 text-xs font-medium'>
          {isUser ? userName : characterName}
        </span>

        <div
          className={cls(
            "rounded-2xl px-4 py-3",
            isUser ? "bg-default rounded-tr-md" : "bg-surface-secondary rounded-tl-md"
          )}>
          {draft !== null ? (
            <div className='flex w-[36rem] max-w-full flex-col gap-2'>
              <TextArea
                aria-label='Edit the message'
                fullWidth
                rows={6}
                variant='secondary'
                className='resize-y'
                maxLength={CHAT_MAX_FIELD_LENGTH}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <div className='flex justify-end gap-2'>
                <Button variant='tertiary' size='sm' onPress={handleCancelEdit}>
                  Cancel
                </Button>
                <Button
                  variant='primary'
                  size='sm'
                  isPending={isSaving}
                  isDisabled={!draft.trim()}
                  onPress={handleSave}>
                  Save
                </Button>
              </div>
            </div>
          ) : text ? (
            <MessageText text={text} />
          ) : isWriting ? (
            <span className='text-muted flex items-center gap-2 text-sm'>
              <Spinner size='sm' color='current' />
              {status === "queued"
                ? "Waiting for the engine"
                : (progressLabel ?? "Starting")}
            </span>
          ) : error ? null : (
            <span className='text-muted text-sm italic'>
              {status === "canceled" ? "Stopped before writing anything." : "Empty."}
            </span>
          )}

          {error ? <p className='text-danger mt-1 text-sm'>{error}</p> : null}
        </div>

        {message.speech && !isUser ? (
          <MessageSpeech
            speech={message.speech}
            shouldPlay={isWaitingToHear}
            onPlayed={handlePlayed}
          />
        ) : null}

        <div
          className={cls(
            "flex items-center gap-0.5 transition-opacity",
            isLast || error
              ? "opacity-100"
              : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
          )}>
          {message.swipe.count > 1 ? (
            <span className='text-muted flex items-center text-xs'>
              <Button
                variant='ghost'
                size='sm'
                isIconOnly
                aria-label='Previous take'
                isDisabled={!message.swipe.previousId || isBusy || isSwiping}
                onPress={() => void handleSwipe(message.swipe.previousId)}>
                <ChevronLeft size={14} strokeWidth={1.75} />
              </Button>
              <span className='tabular-nums'>
                {message.swipe.index + 1}/{message.swipe.count}
              </span>
              <Button
                variant='ghost'
                size='sm'
                isIconOnly
                aria-label='Next take'
                isDisabled={!message.swipe.nextId || isBusy || isSwiping}
                onPress={() => void handleSwipe(message.swipe.nextId)}>
                <ChevronRight size={14} strokeWidth={1.75} />
              </Button>
            </span>
          ) : null}

          {canSpeak && !isUser && text && !isWriting ? (
            <Button
              variant='ghost'
              size='sm'
              isIconOnly
              aria-label={
                message.speech ? "Speak this message again" : "Speak this message"
              }
              isPending={isQueueingSpeech}
              isDisabled={isSpeaking}
              onPress={handleSpeak}>
              <Volume size={14} strokeWidth={1.75} />
            </Button>
          ) : null}
          {canRegenerate ? (
            <Button
              variant='ghost'
              size='sm'
              isIconOnly
              aria-label='Write another take of this reply'
              onPress={handleRegenerate}>
              <RefreshCw size={14} strokeWidth={1.75} />
            </Button>
          ) : null}
          <Button
            variant='ghost'
            size='sm'
            isIconOnly
            aria-label='Edit this message'
            isDisabled={isWriting || draft !== null}
            onPress={handleEdit}>
            <PenLine size={14} strokeWidth={1.75} />
          </Button>
          <DeleteMessageButton
            messageId={message.id}
            isDisabled={isBusy}
            onDone={onChanged}
          />
        </div>
      </div>
    </article>
  )
}
