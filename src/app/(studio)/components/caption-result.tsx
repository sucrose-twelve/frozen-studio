"use client"

import { Button, Chip } from "@heroui/react"
import {
  Check,
  Copy,
  ImageSparkles,
  SlidersHorizontal,
  VideoSparkles
} from "@keyline-icons/react"
import { useCallback, useEffect, useMemo, useState } from "react"

import type { JobDetail } from "@/actions/jobs/read"
import { CAPTION_MODE_LABELS, CAPTION_STYLE_LABELS } from "@/constants"
import { formatElapsed } from "@/libs/utils"

import { usePrefill } from "../hooks/use-prefill"
import { DeleteJobButton } from "./delete-job-button"

const ICON = { size: 15, strokeWidth: 1.75 } as const

/**
 * How long the copy button shows its tick before going back to the copy icon.
 */
const COPIED_MS = 1_500

/**
 * One piece of a caption: its title, the text, and a button that copies the text.
 *
 * @param note - Said under the title, for a piece that needs explaining
 */
function CaptionText({
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

/**
 * The canvas for a finished caption job: the image beside what the model wrote about it, each piece with
 * its own copy button, and the text one press away from the Image and Video forms.
 *
 * A "prompts" job shows its description and both prompts. An "answer" job shows the prompt it was given
 * and the model's reply, which is what goes to the other forms: asking for a prompt is one use of it.
 */
export function CaptionResult({ job }: Readonly<{ job: JobDetail }>) {
  const requestPrefill = usePrefill()
  const caption = job.result
  const [image] = job.inputs
  const isAnswer = job.params.kind === "caption" && job.params.mode === "answer"

  const facts = useMemo(() => {
    const list: string[] = []
    if (job.params.kind === "caption") {
      list.push(
        job.params.model,
        isAnswer ? CAPTION_MODE_LABELS.answer : CAPTION_STYLE_LABELS[job.params.style]
      )
    }
    if (job.startedAt && job.finishedAt) {
      list.push(formatElapsed(job.finishedAt - job.startedAt))
    }

    return list
  }, [job, isAnswer])

  const sendPrompt = useCallback(
    (kind: "image" | "video") => {
      if (!caption) return

      requestPrefill({
        kind,
        references: [],
        source: null,
        // An answer has no negative prompt, and leaves the form's own alone
        prompt: isAnswer
          ? { positive: caption.description }
          : { positive: caption.positive, negative: caption.negative }
      })
    },
    [caption, isAnswer, requestPrefill]
  )
  const handleUseForImage = useCallback(() => sendPrompt("image"), [sendPrompt])
  const handleUseForVideo = useCallback(() => sendPrompt("video"), [sendPrompt])
  const handleReuse = useCallback(
    () => requestPrefill({ kind: "caption", references: job.inputs, source: job }),
    [job, requestPrefill]
  )

  if (!caption) {
    return (
      <div className='text-muted grid min-h-0 flex-1 place-items-center p-6 text-sm'>
        This job finished without a description to show.
      </div>
    )
  }

  return (
    <div className='flex min-h-0 flex-1 flex-col'>
      <div className='use-dot-grid grid min-h-56 flex-1 gap-4 overflow-y-auto p-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]'>
        {image ? (
          <div className='flex items-start justify-center'>
            {/* The canvas shows the file itself, at full quality, as it does for a result */}
            <img
              src={image.url}
              alt='The image that was described'
              width={image.width}
              height={image.height}
              className='h-auto max-h-[60vh] w-auto max-w-full rounded-xl object-contain shadow-2xl shadow-black/40'
            />
          </div>
        ) : null}

        <div className='flex min-w-0 flex-col gap-3'>
          {job.prompt ? (
            <p className='border-separator text-muted border-l-2 pl-3 text-sm italic'>
              {job.prompt}
            </p>
          ) : null}
          <CaptionText
            title={isAnswer ? "Answer" : "Description"}
            text={caption.description}
          />
          {caption.positive ? (
            <CaptionText title='Positive prompt' text={caption.positive} />
          ) : null}
          {caption.negative ? (
            <CaptionText
              title='Negative prompt'
              note="The model's advice for this kind of image; it can't be read off the image itself."
              text={caption.negative}
            />
          ) : null}
        </div>
      </div>

      <div className='border-separator flex flex-col gap-3 border-t p-4'>
        <div className='flex flex-wrap items-center gap-1.5'>
          {facts.map((fact) => (
            <Chip key={fact} size='sm' variant='soft' className='font-mono text-[11px]'>
              {fact}
            </Chip>
          ))}
        </div>

        <div className='flex flex-wrap items-center gap-2'>
          {isAnswer || caption.positive ? (
            <>
              <Button variant='secondary' size='sm' onPress={handleUseForImage}>
                <ImageSparkles {...ICON} />
                Use for an image
              </Button>
              <Button variant='secondary' size='sm' onPress={handleUseForVideo}>
                <VideoSparkles {...ICON} />
                Use for a video
              </Button>
            </>
          ) : null}
          <Button variant='secondary' size='sm' onPress={handleReuse}>
            <SlidersHorizontal {...ICON} />
            Reuse settings
          </Button>

          <div className='ml-auto flex items-center gap-2'>
            <DeleteJobButton jobId={job.id} />
          </div>
        </div>
      </div>
    </div>
  )
}
