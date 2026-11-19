"use client"

import { Tooltip } from "@heroui/react"

import { VRAM_WARNING_GB } from "@/constants"
import { useEngine } from "@/hooks"
import { cls } from "@/libs/utils"

type Tone = "ok" | "warning" | "offline"

const TONE_CLASSES: Record<Tone, string> = {
  ok: "bg-success",
  warning: "bg-warning",
  offline: "bg-danger"
}

function describe(engine: Engine.Status | null) {
  if (!engine) {
    return {
      tone: "offline" as Tone,
      label: "Worker offline",
      hint: "The queue worker isn't running. Start it with `bun run dev` (or `bun run worker`)."
    }
  }
  if (!engine.isComfyOnline) {
    return {
      tone: "offline" as Tone,
      label: "ComfyUI offline",
      hint: "The worker is waiting for ComfyUI. Jobs stay queued until it starts."
    }
  }

  const held = engine.vramUsers.reduce((total, user) => total + user.gigabytes, 0)
  if (held >= VRAM_WARNING_GB) {
    const names = engine.vramUsers
      .map((user) => `${user.name} (${user.gigabytes.toFixed(1)} GB)`)
      .join(", ")

    return {
      tone: "warning" as Tone,
      label: `VRAM shared · ${held.toFixed(1)} GB`,
      hint: `${names} is using VRAM. Video jobs may crawl or hang; close it, then restart ComfyUI.`
    }
  }

  const waiting = engine.queued > 0 ? `${engine.queued} waiting` : null
  const label = engine.runningJobId
    ? ["Working", waiting].filter(Boolean).join(" · ")
    : (waiting ?? "Ready")

  return {
    tone: "ok" as Tone,
    label,
    hint: "ComfyUI is online and the worker is listening for jobs."
  }
}

/**
 * The header's status light: whether the worker and ComfyUI are up, how much is queued, and a warning when
 * another program (a game, usually) holds enough VRAM to slow generation down.
 */
export function EngineStatus() {
  const engine = useEngine()
  const { tone, label, hint } = describe(engine)

  return (
    <Tooltip delay={200}>
      <Tooltip.Trigger>
        <span className='border-border bg-surface text-foreground inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium whitespace-nowrap'>
          <span className={cls("size-2 rounded-full", TONE_CLASSES[tone])} />
          {label}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content placement='bottom' className='max-w-72 text-xs'>
        {hint}
      </Tooltip.Content>
    </Tooltip>
  )
}
