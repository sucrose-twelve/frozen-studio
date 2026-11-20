"use client"

import { ImageSparkles, Mic, Scissors, VideoSparkles } from "@keyline-icons/react"
import { useCallback, useEffect } from "react"

import { JOB_KIND_LABELS } from "@/constants"
import { useStore } from "@/hooks"

import { useStudioQuery } from "../hooks/use-studio-query"
import { CutoutForm } from "./cutout-form"
import { ImageForm } from "./image-form"
import { KindSwitch, type KindItem } from "./kind-switch"
import { VideoForm } from "./video-form"
import { VoiceForm } from "./voice-form"

/**
 * The modes that make something new, which the switch shows by name.
 */
const MAKER_MODES: KindItem<Media.StudioMode>[] = [
  { id: "image", label: JOB_KIND_LABELS.image, Icon: ImageSparkles },
  { id: "video", label: JOB_KIND_LABELS.video, Icon: VideoSparkles },
  { id: "voice", label: JOB_KIND_LABELS.voice, Icon: Mic }
]

const CUTOUT_MODE: KindItem<Media.StudioMode> = {
  id: "cutout",
  label: JOB_KIND_LABELS.cutout,
  Icon: Scissors
}

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

  const handleModeChange = useCallback(
    (next: Media.StudioMode) => void setMode(next),
    [setMode]
  )

  useEffect(() => {
    if (prefill && prefill.kind !== "caption") void setMode(prefill.kind)
  }, [prefill, setMode])

  return (
    <aside className='use-panel flex min-h-0 flex-col overflow-hidden'>
      <div className='border-separator border-b p-4'>
        <KindSwitch
          label='Mode'
          items={MAKER_MODES}
          tool={CUTOUT_MODE}
          value={mode}
          onChange={handleModeChange}
        />
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
