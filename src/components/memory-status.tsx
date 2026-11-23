"use client"

import { Meter, Tooltip } from "@heroui/react"

import { useEngine } from "@/hooks"

const GIBIBYTE = 1024 ** 3

const gigabytes = (bytes: number) => (bytes / GIBIBYTE).toFixed(1)

/**
 * The fill turns amber past three quarters and red past nine tenths: by then a model load may spill into
 * system RAM, or out of it into the page file.
 */
function colorOf(usage: Engine.MemoryUsage) {
  const share = usage.used / usage.total
  return share >= 0.9 ? "danger" : share >= 0.75 ? "warning" : "default"
}

function MemoryGauge({
  label,
  usage
}: Readonly<{ label: string; usage: Engine.MemoryUsage }>) {
  return (
    <span className='inline-flex items-center gap-2'>
      <span className='text-muted'>{label}</span>
      <Meter
        aria-label={`${label} used`}
        size='sm'
        color={colorOf(usage)}
        value={usage.used}
        maxValue={usage.total}
        className='w-12'>
        <Meter.Track>
          <Meter.Fill />
        </Meter.Track>
      </Meter>
      <span className='font-mono tabular-nums'>
        {gigabytes(usage.used)}/{gigabytes(usage.total)} GB
      </span>
    </span>
  )
}

function MemoryLine({
  label,
  usage
}: Readonly<{ label: string; usage: Engine.MemoryUsage }>) {
  return (
    <span className='flex justify-between gap-4'>
      <span className='font-medium'>{label}</span>
      <span className='font-mono tabular-nums'>
        {gigabytes(usage.used)} GB used · {gigabytes(usage.total - usage.used)} GB free
      </span>
    </span>
  )
}

/**
 * The header's memory chip: system RAM and the GPU's VRAM, used out of total, with what is free on hover.
 * Read by the worker, so it is hidden while the worker isn't running.
 */
export function MemoryStatus() {
  const engine = useEngine()
  if (!engine) return null

  const { ram, vram } = engine.memory

  return (
    <Tooltip delay={200}>
      <Tooltip.Trigger>
        <span className='border-border bg-surface text-foreground inline-flex h-8 items-center gap-4 rounded-full border px-3 text-xs font-medium whitespace-nowrap'>
          <MemoryGauge label='RAM' usage={ram} />
          {vram ? <MemoryGauge label='VRAM' usage={vram} /> : null}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content placement='bottom' className='flex flex-col gap-1 text-xs'>
        <MemoryLine label='RAM' usage={ram} />
        {vram ? (
          <MemoryLine label='VRAM' usage={vram} />
        ) : (
          <span className='text-muted'>
            VRAM can't be read: nvidia-smi didn't answer.
          </span>
        )}
      </Tooltip.Content>
    </Tooltip>
  )
}
