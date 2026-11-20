"use client"

import { useCallback } from "react"

import type { AssetView } from "@/actions/jobs/read"
import { cls, pad2 } from "@/libs/utils"

import { DownloadButton, FavoriteButton } from "./asset-buttons"

/**
 * One voice clip as a row: the line it speaks, a player, and its own download and favorite buttons. The
 * studio's voice result and the gallery's voice list are both made of these.
 *
 * Only one clip plays at a time: starting one pauses whichever other is playing on the page, where it is,
 * so it can be picked up again.
 *
 * @param text - The line of the script the clip speaks
 * @param number - The clip's place in its job, shown in front of the line; left out where clips of many
 *   jobs are listed together
 * @param isHighlighted - Points the row out, for a link that named this clip
 * @param children - More buttons for the row, after its own two
 */
export function VoiceClip({
  clip,
  text,
  number,
  isHighlighted = false,
  children
}: Readonly<{
  clip: AssetView
  text: string
  number?: number
  isHighlighted?: boolean
  children?: React.ReactNode
}>) {
  // The players don't know of each other, and the page is the one place they all are
  const handlePlay = useCallback((event: React.SyntheticEvent<HTMLAudioElement>) => {
    for (const player of document.querySelectorAll("audio")) {
      if (player !== event.currentTarget && !player.paused) player.pause()
    }
  }, [])

  return (
    <div
      className={cls(
        "use-panel flex w-full flex-col gap-2.5 p-3",
        isHighlighted && "border-accent"
      )}>
      <div className='flex items-start gap-3'>
        {number === undefined ? null : (
          <span className='text-muted pt-1 font-mono text-xs tabular-nums'>
            {pad2(number)}
          </span>
        )}
        <p lang='ja' className='min-w-0 flex-1 pt-0.5 text-sm leading-relaxed'>
          {text}
        </p>
        <div className='flex shrink-0 items-center gap-1'>
          <DownloadButton asset={clip} isLabeled={false} />
          <FavoriteButton asset={clip} />
          {children}
        </div>
      </div>
      <audio
        controls
        preload='metadata'
        src={clip.url}
        className='h-9 w-full'
        onPlay={handlePlay}
      />
    </div>
  )
}
