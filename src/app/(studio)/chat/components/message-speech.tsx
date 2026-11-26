"use client"

import { Spinner } from "@heroui/react"
import { useEffect, useRef } from "react"

import { ACTIVE_JOB_STATUSES } from "@/constants"
import { useStore } from "@/hooks"
import { isJapanese } from "@/libs/chat"

import type { ThreadMessage } from "../actions/read"

/**
 * A message spoken aloud: what the engine is doing while it works, then a player and the words that were
 * said (in Japanese, when the character speaks it).
 *
 * @param shouldPlay - The user just asked to hear it: play the clip as soon as it arrives
 * @param onPlayed - Called once the clip has been started that way
 */
export function MessageSpeech({
  speech,
  shouldPlay,
  onPlayed
}: Readonly<{
  speech: NonNullable<ThreadMessage["speech"]>
  shouldPlay: boolean
  onPlayed: () => void
}>) {
  const live = useStore((state) => state.jobs[speech.jobId])
  const audioRef = useRef<HTMLAudioElement>(null)

  const status = live?.status ?? speech.status
  const isWorking = ACTIVE_JOB_STATUSES.includes(status)
  const url = speech.audio?.url ?? null

  // Plays the clip the user asked for once the page has loaded it
  useEffect(() => {
    if (!shouldPlay || !url || !audioRef.current) return
    void audioRef.current.play().catch(() => undefined)
    onPlayed()
  }, [shouldPlay, url, onPlayed])

  if (isWorking) {
    return (
      <span className='text-muted flex items-center gap-2 px-1 text-xs'>
        <Spinner size='sm' color='current' />
        {status === "queued"
          ? "Waiting for the engine"
          : (live?.progress?.label ?? "Starting the voice engine")}
      </span>
    )
  }
  if (status === "failed") {
    return (
      <p className='text-danger px-1 text-xs'>
        Couldn&apos;t speak it: {live?.error ?? speech.error}
      </p>
    )
  }
  if (!url) return null

  return (
    <div className='flex w-[28rem] max-w-full flex-col gap-1'>
      <audio
        ref={audioRef}
        controls
        preload='metadata'
        src={url}
        className='h-9 w-full'
      />
      {speech.text ? (
        <p
          lang={isJapanese(speech.text) ? "ja" : undefined}
          className='text-muted px-1 text-xs leading-relaxed'>
          {speech.text}
        </p>
      ) : null}
    </div>
  )
}
