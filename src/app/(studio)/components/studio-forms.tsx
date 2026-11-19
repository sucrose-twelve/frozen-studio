"use client"

import { ToggleButton, ToggleButtonGroup } from "@heroui/react"
import { ImageSparkles, Mic, Scissors, VideoSparkles } from "@keyline-icons/react"
import { useCallback, useEffect, useMemo } from "react"

import { JOB_KIND_LABELS, STUDIO_MODES } from "@/constants"
import { useStore } from "@/hooks"

import { useStudioQuery } from "../hooks/use-studio-query"
import { CutoutForm } from "./cutout-form"
import { ImageForm } from "./image-form"
import { VideoForm } from "./video-form"
import { VoiceForm } from "./voice-form"

const MODE_ICONS = {
  image: ImageSparkles,
  video: VideoSparkles,
  cutout: Scissors,
  voice: Mic
} satisfies Record<Media.StudioMode, unknown>

/**
 * The left panel: the mode switch and the four forms.
 *
 * All of them stay mounted and only the chosen one shows, so switching modes never loses what was typed in
 * the others. A prefill request from the canvas brings its form forward; one for the Caption form is that
 * page's to answer.
 */
export function StudioForms() {
  const { query, setMode } = useStudioQuery()
  const prefill = useStore((state) => state.prefill)
  const mode = query.mode
  const selectedKeys = useMemo(() => [mode], [mode])

  const handleSelectionChange = useCallback(
    (keys: Set<string | number>) => {
      const [key] = keys
      const next = STUDIO_MODES.find((kind) => kind === key)
      if (next) void setMode(next)
    },
    [setMode]
  )

  useEffect(() => {
    if (prefill && prefill.kind !== "caption") void setMode(prefill.kind)
  }, [prefill, setMode])

  return (
    <aside className='use-panel flex min-h-0 flex-col overflow-hidden'>
      <div className='border-separator border-b p-4'>
        <ToggleButtonGroup
          aria-label='Mode'
          selectionMode='single'
          fullWidth
          disallowEmptySelection
          selectedKeys={selectedKeys}
          onSelectionChange={handleSelectionChange}>
          {STUDIO_MODES.map((kind, index) => {
            const Icon = MODE_ICONS[kind]

            return (
              <ToggleButton key={kind} id={kind} className='min-w-0 flex-1 px-2'>
                {index > 0 ? <ToggleButtonGroup.Separator /> : null}
                <Icon size={17} strokeWidth={1.75} />
                {JOB_KIND_LABELS[kind]}
              </ToggleButton>
            )
          })}
        </ToggleButtonGroup>
      </div>

      <div className='min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-4 pt-4'>
        <div hidden={mode !== "image"} className='h-full'>
          <ImageForm isActive={mode === "image"} />
        </div>
        <div hidden={mode !== "video"} className='h-full'>
          <VideoForm isActive={mode === "video"} />
        </div>
        <div hidden={mode !== "cutout"} className='h-full'>
          <CutoutForm isActive={mode === "cutout"} />
        </div>
        <div hidden={mode !== "voice"} className='h-full'>
          <VoiceForm isActive={mode === "voice"} />
        </div>
      </div>
    </aside>
  )
}
