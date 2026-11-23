"use client"

import { Button } from "@heroui/react"
import { Check, Copy } from "@keyline-icons/react"
import { useCallback, useEffect, useState } from "react"

const ICON = { size: 15, strokeWidth: 1.75 } as const

/**
 * How long the copy button shows its tick before going back to the copy icon.
 */
const COPIED_MS = 1_500

/**
 * A titled piece of text with a button that copies it: a caption's description, a prompt.
 *
 * @param note - Said under the title, for a piece that needs explaining
 */
export function CopyText({
  title,
  note,
  text
}: Readonly<{
  title: string
  note?: string
  text: string
}>) {
  const [isCopied, setIsCopied] = useState(false)

  const handleCopy = useCallback(async () => {
    await navigator.clipboard.writeText(text)
    setIsCopied(true)
  }, [text])

  useEffect(() => {
    if (!isCopied) return

    const timer = setTimeout(() => setIsCopied(false), COPIED_MS)
    return () => clearTimeout(timer)
  }, [isCopied])

  return (
    <section className='use-panel flex flex-col gap-2 p-3'>
      <div className='flex items-start justify-between gap-3'>
        <div className='min-w-0'>
          <h3 className='text-sm font-semibold'>{title}</h3>
          {note ? <p className='text-muted text-xs'>{note}</p> : null}
        </div>
        <Button
          variant='tertiary'
          size='sm'
          isIconOnly
          aria-label={`Copy the ${title.toLowerCase()}`}
          onPress={handleCopy}>
          {isCopied ? <Check {...ICON} /> : <Copy {...ICON} />}
        </Button>
      </div>
      <p className='text-sm leading-relaxed whitespace-pre-wrap'>{text}</p>
    </section>
  )
}
