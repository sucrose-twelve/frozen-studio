import { ENGINE_HEARTBEAT_MS, REDIS_KEYS } from "@/constants"
import { isComfyOnline } from "@/libs/comfy/client"
import { discoverModels } from "@/libs/comfy/discover"
import { logger } from "@/libs/logger"
import { readEngineStatus, writeEngineStatus } from "@/libs/queue"
import { redis } from "@/libs/redis"

import { readVramUsers } from "./gpu"

const NO_MODELS: Engine.Models = { image: null, video: null, cutout: null }

/**
 * Model files change rarely (a download, a delete), and the VRAM counter costs a PowerShell start: both are
 * refreshed on a slower beat than the status itself.
 */
const MODELS_REFRESH_MS = 30_000
const VRAM_REFRESH_MS = 20_000

type EngineState = {
  isComfyOnline: boolean
  models: Engine.Models
  vramUsers: Engine.VramUser[]
  runningJobId: string | null
  modelsAt: number
  vramAt: number
}

const state: EngineState = {
  isComfyOnline: false,
  models: NO_MODELS,
  vramUsers: [],
  runningJobId: null,
  modelsAt: 0,
  vramAt: 0
}

/**
 * Whether another worker is alive, judged by its status in Redis still getting newer. Two workers would run
 * two jobs on the one GPU at once, and the second would fail the first one's job as "interrupted" on its
 * way up, so a second worker must not start.
 *
 * A status left behind by a worker that was killed stops changing; waiting two heartbeats tells the two
 * apart. With no status at all (the usual case) this returns at once.
 */
export async function isAnotherWorkerRunning() {
  const before = await readEngineStatus()
  if (!before) return false

  await new Promise((resolve) => setTimeout(resolve, ENGINE_HEARTBEAT_MS * 2))
  const after = await readEngineStatus()

  return !!after && after.updatedAt > before.updatedAt
}

/**
 * Checks ComfyUI and writes the worker's status to Redis. Called on a timer, and directly whenever the
 * running job changes so the browsers hear about it at once.
 */
export async function reportEngine() {
  const now = Date.now()
  const wasOnline = state.isComfyOnline
  state.isComfyOnline = await isComfyOnline()

  if (!state.isComfyOnline) {
    state.models = NO_MODELS
    state.modelsAt = 0
  } else if (!wasOnline || now - state.modelsAt > MODELS_REFRESH_MS) {
    state.models = await discoverModels().catch(() => state.models)
    state.modelsAt = now
    if (!wasOnline) logger("ComfyUI is online")
  }
  if (wasOnline && !state.isComfyOnline) logger("ComfyUI went offline")

  if (now - state.vramAt > VRAM_REFRESH_MS) {
    state.vramAt = now
    state.vramUsers = await readVramUsers()
  }

  const client = await redis()
  await writeEngineStatus({
    isComfyOnline: state.isComfyOnline,
    models: state.models,
    vramUsers: state.vramUsers,
    runningJobId: state.runningJobId,
    queued: await client.lLen(REDIS_KEYS.queue),
    updatedAt: now
  })
}

/**
 * Starts the status heartbeat. A failed beat (Redis or ComfyUI hiccup) is logged and the next one tries
 * again.
 *
 * @returns Stops the heartbeat
 */
export function startEngineMonitor() {
  let isReporting = false
  const beat = async () => {
    if (isReporting) return
    isReporting = true
    try {
      await reportEngine()
    } catch (error) {
      logger(`Engine status failed: ${error instanceof Error ? error.message : error}`)
    } finally {
      isReporting = false
    }
  }

  void beat()
  const timer = setInterval(beat, ENGINE_HEARTBEAT_MS)
  return () => clearInterval(timer)
}

export function setRunningJob(id: string | null) {
  state.runningJobId = id
  return reportEngine().catch(() => undefined)
}

/**
 * The models found on the last check, looked up now if ComfyUI hasn't been reached yet.
 */
export async function currentModels() {
  if (state.modelsAt === 0) await reportEngine()
  return state.models
}

/**
 * Resolves once ComfyUI answers, checking every few seconds.
 *
 * @param onWaiting - Called before each wait, to tell the user why nothing is happening
 */
export async function waitForComfy(onWaiting: () => void) {
  while (!(await isComfyOnline())) {
    onWaiting()
    await new Promise((resolve) => setTimeout(resolve, 3_000))
  }
}
