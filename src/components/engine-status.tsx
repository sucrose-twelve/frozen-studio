"use client"

import { Popover } from "@heroui/react"
import { ChevronDown, TriangleAlert } from "@keyline-icons/react"

import { VRAM_WARNING_GB } from "@/constants"
import { useEngine } from "@/hooks"
import { cls } from "@/libs/utils"

type Tone = "ok" | "warning" | "offline"

const TONE_CLASSES: Record<Tone, string> = {
  ok: "bg-success",
  warning: "bg-warning",
  offline: "bg-danger"
}

const STATE_LABELS: Record<Engine.ServiceState, string> = {
  online: "Online",
  loaded: "Model loaded",
  standby: "Starts when needed",
  offline: "Offline"
}

const STATE_DOTS: Record<Engine.ServiceState, string> = {
  online: "bg-success",
  loaded: "bg-success",
  standby: "bg-muted/50",
  offline: "bg-danger"
}

/**
 * The chip's light: red without a worker, amber while something it needs is down or another program holds
 * enough VRAM to slow generation down, green otherwise.
 */
function toneOf(engine: Engine.Status | null, heldGigabytes: number): Tone {
  if (!engine) return "offline"
  if (engine.services.some((service) => service.state === "offline")) return "warning"
  return heldGigabytes >= VRAM_WARNING_GB ? "warning" : "ok"
}

function ServiceRow({
  name,
  state,
  address
}: Readonly<{ name: string; state: Engine.ServiceState; address?: string }>) {
  return (
    <li className='flex items-center gap-3 py-1.5'>
      <span className={cls("size-2 shrink-0 rounded-full", STATE_DOTS[state])} />
      <span className='min-w-0 flex-1'>
        <span className='block truncate text-sm'>{name}</span>
        {address ? (
          <span className='text-muted block font-mono text-[11px]'>{address}</span>
        ) : null}
      </span>
      <span
        className={cls(
          "shrink-0 text-xs",
          state === "offline" ? "text-danger" : "text-muted"
        )}>
        {STATE_LABELS[state]}
      </span>
    </li>
  )
}

/**
 * The header's status chip: online while the worker reports, offline when it doesn't. Pressing it lists
 * every program behind the app and how each is doing. Jobs aren't shown here; they have their toasts
 * (`JobToasts`).
 */
export function EngineStatus() {
  const engine = useEngine()
  const held = engine?.vramUsers.reduce((total, user) => total + user.gigabytes, 0) ?? 0
  const tone = toneOf(engine, held)

  return (
    <Popover>
      <Popover.Trigger
        aria-label='Service status'
        className='border-border bg-surface text-foreground hover:bg-surface-secondary inline-flex h-8 items-center gap-2 rounded-full border px-3 text-xs font-medium whitespace-nowrap transition-colors'>
        <span className={cls("size-2 rounded-full", TONE_CLASSES[tone])} />
        {engine ? "Online" : "Offline"}
        <ChevronDown size={14} strokeWidth={1.75} className='text-muted' />
      </Popover.Trigger>
      <Popover.Content placement='bottom end' className='w-96'>
        <Popover.Dialog>
          <Popover.Heading className='text-sm font-semibold'>Services</Popover.Heading>

          <ul className='divide-separator mt-2 divide-y'>
            <ServiceRow name='Worker' state={engine ? "online" : "offline"} />
            {engine?.services.map((service) => (
              <ServiceRow key={service.name} {...service} />
            ))}
          </ul>

          {!engine && (
            <p className='text-muted mt-3 text-xs'>
              The worker reports on ComfyUI, the database and the voice and caption
              services. Start it with Frozen, or with `bun run dev`.
            </p>
          )}

          {held >= VRAM_WARNING_GB && (
            <p className='bg-warning/10 text-warning mt-3 flex gap-2 rounded-lg p-2.5 text-xs'>
              <TriangleAlert size={14} strokeWidth={1.75} className='mt-px shrink-0' />
              <span>
                {engine?.vramUsers
                  .map((user) => `${user.name} (${user.gigabytes.toFixed(1)} GB)`)
                  .join(", ")}{" "}
                is using VRAM. Image jobs may crawl or hang; close it, then restart
                ComfyUI.
              </span>
            </p>
          )}
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  )
}
