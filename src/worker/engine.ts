import { sql } from "drizzle-orm"

import { ENGINE_HEARTBEAT_MS, REDIS_KEYS } from "@/constants"
import { COMFY, DB, REDIS } from "@/constants/env"
import { db } from "@/drizzle"
import { isComfyOnline } from "@/libs/comfy/client"
import { discoverModels, type ComfyModels } from "@/libs/comfy/discover"
import { logger } from "@/libs/logger"
import { readEngineStatus, writeEngineStatus } from "@/libs/queue"
import { redis } from "@/libs/redis"

import { findCaptionModels } from "./caption"
import { readVramUsers } from "./gpu"
import { readMemory } from "./memory"
import { withSdCppModels } from "./sdcpp"
import { describeServices } from "./service"
import { findVoiceModels } from "./voice"

/**
 * How long Postgres gets to answer the status check. A database that is down can leave a connection
 * attempt hanging for far longer, which would hold up every beat behind it.
 */
const DATABASE_CHECK_MS = 1_500

const NO_COMFY_MODELS: ComfyModels = { image: null, cutout: null }

/**
 * Model files change rarely (a download, a delete), and the VRAM counter costs a PowerShell start: both are
 * refreshed on a slower beat than the status itself.
 */
const MODELS_REFRESH_MS = 30_000
const VRAM_REFRESH_MS = 20_000

type EngineState = {
  isComfyOnline: boolean
  models: ComfyModels
  vramUsers: Engine.VramUser[]
  runningJobId: string | null
  modelsAt: number
  vramAt: number
}

const state: EngineState = {
  isComfyOnline: false,
  models: NO_COMFY_MODELS,
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
 * Everything that can run right now: what ComfyUI has, what stable-diffusion.cpp adds to its image models,
 * and the voice and caption engines, which are installed beside this project and don't need ComfyUI at
 * all.
 */
function allModels(): Engine.Models {
  const voice = findVoiceModels()
  const caption = findCaptionModels()

  return {
    ...state.models,
    image: withSdCppModels(state.models.image),
    voice: voice.length > 0 ? { models: voice } : null,
    caption: caption.length > 0 ? { models: caption } : null
  }
}

async function isDatabaseOnline() {
  const timeout = new Promise<false>((resolve) =>
    setTimeout(() => resolve(false), DATABASE_CHECK_MS)
  )
  const check = db
    .execute(sql`select 1`)
    .then(() => true)
    .catch(() => false)

  return Promise.race([check, timeout])
}

/**
 * The programs the header lists, as of this beat. Redis is online by definition: this status only reaches
 * a browser through it.
 */
async function describeAll(): Promise<Engine.Service[]> {
  const [isDatabaseUp, pythonServices] = await Promise.all([
    isDatabaseOnline(),
    describeServices()
  ])

  return [
    {
      name: "ComfyUI",
      state: state.isComfyOnline ? "online" : "offline",
      address: new URL(COMFY.url).host
    },
    {
      name: "Postgres",
      state: isDatabaseUp ? "online" : "offline",
      address: `${DB.host}:${DB.port}`
    },
    { name: "Redis", state: "online", address: `${REDIS.host}:${REDIS.port}` },
    ...pythonServices
  ]
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
    state.models = NO_COMFY_MODELS
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

  const [client, services, memory] = await Promise.all([
    redis(),
    describeAll(),
    readMemory()
  ])
  await writeEngineStatus({
    isComfyOnline: state.isComfyOnline,
    models: allModels(),
    vramUsers: state.vramUsers,
    services,
    memory,
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
  return allModels()
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
