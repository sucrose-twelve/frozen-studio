"use client"

import { Button, TextArea, toast } from "@heroui/react"
import { CircleStop, MessageSquare, SendHorizontal } from "@keyline-icons/react"
import { useRouter } from "next/navigation"
import { useCallback, useEffect, useRef, useState, useTransition } from "react"

import { cancelJob } from "@/actions/jobs/update"
import { ACTIVE_JOB_STATUSES, CHAT_MAX_MESSAGE_LENGTH } from "@/constants"
import { useStore } from "@/hooks"

import { requestReply, sendMessage } from "../actions/create"
import type { ChatThread } from "../actions/read"
import { ChatMessage } from "./chat-message"

/**
 * How close to the bottom, in pixels, still counts as reading the latest message: the thread follows a
 * reply as it is written only then, and leaves someone scrolled up alone.
 */
const FOLLOW_MARGIN_PX = 120

/**
 * The middle panel: the conversation on screen and the box to write in.
 *
 * Enter sends, Shift+Enter starts a new line. While a reply is on the way, Send becomes Stop; the text
 * written so far stays. A chat that ends on the user's message (after a reply was deleted) offers Reply.
 */
export function ChatThreadView({ thread }: Readonly<{ thread: ChatThread | null }>) {
  const router = useRouter()
  const [isRefreshing, startRefresh] = useTransition()
  const replies = useStore((state) => state.replies)
  const jobs = useStore((state) => state.jobs)
  const [text, setText] = useState("")
  const [isSending, setIsSending] = useState(false)
  const [isStopping, setIsStopping] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const isFollowingRef = useRef(true)

  const activeJobId = thread?.activeJobId ?? null
  const activeStatus = activeJobId ? (jobs[activeJobId]?.status ?? "queued") : null
  const isBusy = !!activeStatus && ACTIVE_JOB_STATUSES.includes(activeStatus)
  const last = thread?.messages.at(-1) ?? null
  const lastText = last ? (replies[last.id]?.text ?? last.content) : ""

  const refresh = useCallback(() => startRefresh(() => router.refresh()), [router])

  const handleSend = useCallback(async () => {
    if (!thread || !text.trim()) return

    setIsSending(true)
    const result = await sendMessage({ chatId: thread.id, text })
    setIsSending(false)

    if (!result.ok) {
      toast.danger(result.message)
      return
    }
    setText("")
    isFollowingRef.current = true
    refresh()
  }, [thread, text, refresh])

  const handleReply = useCallback(
    async (parentId: string) => {
      if (!thread) return

      setIsSending(true)
      const result = await requestReply({ chatId: thread.id, parentId })
      setIsSending(false)

      if (!result.ok) {
        toast.danger(result.message)
        return
      }
      isFollowingRef.current = true
      refresh()
    },
    [thread, refresh]
  )

  const handleStop = useCallback(async () => {
    if (!activeJobId) return

    setIsStopping(true)
    const result = await cancelJob({ id: activeJobId })
    setIsStopping(false)
    if (!result.ok) toast.danger(result.message)
  }, [activeJobId])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return
      event.preventDefault()
      if (!isBusy && !isSending) void handleSend()
    },
    [isBusy, isSending, handleSend]
  )

  const handleScroll = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    isFollowingRef.current =
      element.scrollHeight - element.scrollTop - element.clientHeight < FOLLOW_MARGIN_PX
  }, [])

  // Keeps the newest words in view while following: on load, on a new message, and as a reply grows
  useEffect(() => {
    const element = scrollRef.current
    if (element && isFollowingRef.current) element.scrollTop = element.scrollHeight
  }, [thread?.messages.length, lastText])

  if (!thread) {
    return (
      <section className='text-muted flex min-h-0 flex-col items-center justify-center gap-3 p-8 text-center text-sm'>
        <MessageSquare size={32} strokeWidth={1.5} />
        <p>Pick a chat on the left, or start one with a character.</p>
      </section>
    )
  }

  return (
    <section className='flex min-h-0 min-w-0 flex-col overflow-hidden'>
      {/* The scroll area spans the column, so the scrollbar sits at its edge; the messages keep to the middle */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className='min-h-0 flex-1 overflow-y-auto px-6 py-6'>
        <div className='mx-auto flex min-h-full w-full max-w-3xl flex-col gap-5'>
          {thread.messages.length === 0 ? (
            <p className='text-muted m-auto text-sm'>
              {thread.character.name} has no greeting. Say something to begin.
            </p>
          ) : null}

          {thread.messages.map((message, index) => {
            const jobLive = message.job ? jobs[message.job.id] : undefined

            return (
              <ChatMessage
                key={message.id}
                message={message}
                characterName={thread.character.name}
                characterAvatar={thread.character.avatar}
                userName={thread.persona.name}
                liveText={replies[message.id]?.text ?? null}
                liveStatus={jobLive?.status ?? null}
                liveError={jobLive?.error ?? null}
                progressLabel={jobLive?.progress?.label ?? null}
                isLast={index === thread.messages.length - 1}
                isBusy={isBusy || isSending}
                canSpeak={thread.character.hasVoice}
                onChanged={refresh}
                onRegenerate={handleReply}
              />
            )
          })}
        </div>
      </div>

      <div className='px-6 pb-6'>
        <div className='mx-auto flex w-full max-w-3xl flex-col gap-2'>
          {last?.role === "user" && !isBusy ? (
            <div className='flex items-center justify-between gap-3'>
              <p className='text-muted text-xs'>Your last message has no reply.</p>
              <Button
                variant='secondary'
                size='sm'
                isPending={isSending}
                onPress={() => void handleReply(last.id)}>
                Reply
              </Button>
            </div>
          ) : null}

          {/* Send (or Stop) sits inside the box, bottom right; the box keeps the room under the text free for it */}
          <div className='relative'>
            <TextArea
              aria-label={`Message ${thread.character.name}`}
              fullWidth
              rows={3}
              variant='secondary'
              className='block max-h-60 resize-none pb-12'
              placeholder={`Message ${thread.character.name}`}
              maxLength={CHAT_MAX_MESSAGE_LENGTH}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={handleKeyDown}
            />
            <div className='absolute right-2 bottom-2'>
              {isBusy ? (
                <Button
                  variant='secondary'
                  size='sm'
                  isPending={isStopping}
                  aria-label='Stop the reply'
                  onPress={handleStop}>
                  <CircleStop size={14} strokeWidth={1.75} />
                  Stop
                </Button>
              ) : (
                <Button
                  variant='primary'
                  size='sm'
                  isPending={isSending || isRefreshing}
                  isDisabled={!text.trim()}
                  onPress={handleSend}>
                  <SendHorizontal size={14} strokeWidth={1.75} />
                  Send
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
