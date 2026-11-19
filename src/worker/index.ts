import { asc, eq } from "drizzle-orm"

import { REDIS_KEYS } from "@/constants"
import { db, schema } from "@/drizzle"
import { logger } from "@/libs/logger"
import { publishEvent } from "@/libs/queue"
import { redis, redisDedicated } from "@/libs/redis"

import { CanceledError, connectComfySocket } from "./comfy-socket"
import {
  isAnotherWorkerRunning,
  setRunningJob,
  startEngineMonitor,
  waitForComfy
} from "./engine"
import { processJob, runsOnComfy, type RunControl } from "./process"
import { stopServices } from "./service"

const STOPPED_MESSAGE = "Interrupted: the worker stopped while this job was running"

let current: RunControl | null = null

async function readJob(jobId: string) {
  const [job] = await db
    .select()
    .from(schema.jobs)
    .where(eq(schema.jobs.id, jobId))
    .limit(1)

  return job ?? null
}

async function finishJob(jobId: string, status: Media.JobStatus, error: string | null) {
  await db
    .update(schema.jobs)
    .set({ status, error, finishedAt: new Date() })
    .where(eq(schema.jobs.id, jobId))
  await publishEvent({ type: "job", id: jobId, status, ...(error ? { error } : {}) })
}

/**
 * Puts the queue back in step with the database after a restart.
 *
 * - A job still marked `running` belonged to a worker that is gone: it failed.
 * - A `queued` job missing from the Redis list (Redis was flushed, or the push never happened) is pushed
 *   again, oldest first.
 */
async function recover() {
  const interrupted = await db
    .update(schema.jobs)
    .set({ status: "failed", error: STOPPED_MESSAGE, finishedAt: new Date() })
    .where(eq(schema.jobs.status, "running"))
    .returning({ id: schema.jobs.id })

  const queued = await db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(eq(schema.jobs.status, "queued"))
    .orderBy(asc(schema.jobs.createdAt))

  const client = await redis()
  const listed = new Set(await client.lRange(REDIS_KEYS.queue, 0, -1))
  const missing = queued.filter((job) => !listed.has(job.id)).map((job) => job.id)
  if (missing.length > 0) await client.lPush(REDIS_KEYS.queue, missing)

  if (interrupted.length > 0 || missing.length > 0) {
    logger(`Recovered: ${interrupted.length} interrupted, ${missing.length} re-queued`)
  }
}

/**
 * Runs one job from the queue to its end, whatever that end is.
 *
 * A job that is no longer `queued` was canceled or deleted while it waited and is skipped. If ComfyUI isn't
 * up yet the job keeps waiting as `queued`, so it can still be canceled the cheap way. Voice and caption
 * jobs don't run on ComfyUI and don't wait for it.
 */
async function runJob(jobId: string) {
  let job = await readJob(jobId)
  if (job?.status !== "queued") return

  if (runsOnComfy(job.kind)) {
    await waitForComfy(
      () =>
        void publishEvent({
          type: "progress",
          id: jobId,
          label: "Waiting for ComfyUI to start",
          value: 0,
          max: 0
        })
    )

    job = await readJob(jobId)
    if (job?.status !== "queued") return
  }

  const startedAt = new Date()
  const control: RunControl = { jobId, cancel: null, isCanceled: false }
  current = control

  await db
    .update(schema.jobs)
    .set({ status: "running", startedAt, error: null })
    .where(eq(schema.jobs.id, jobId))
  await publishEvent({ type: "job", id: jobId, status: "running" })
  await setRunningJob(jobId)

  const name = `${job.kind} job ${jobId.slice(0, 8)}`
  try {
    await processJob(job, control)
    await finishJob(jobId, "succeeded", null)
    logger(`Finished ${name}`, startedAt)
  } catch (error) {
    if (error instanceof CanceledError || control.isCanceled) {
      await finishJob(jobId, "canceled", null)
      logger(`Canceled ${name}`, startedAt)
    } else {
      const message = error instanceof Error ? error.message : String(error)
      await finishJob(jobId, "failed", message)
      logger(`Failed ${name}: ${message}`, startedAt)
    }
  } finally {
    current = null
    await setRunningJob(null)
  }
}

async function handleControl(message: string) {
  const control = JSON.parse(message) as Engine.Control
  if (control.type !== "cancel" || current?.jobId !== control.id) return

  current.isCanceled = true
  await current.cancel?.()
}

/**
 * The worker: takes jobs off the Redis queue one at a time (one GPU, one job) and runs them on their engine,
 * while reporting its status and listening for cancel requests. Runs until the process is stopped.
 */
export async function startWorker() {
  logger("Worker starting")
  if (await isAnotherWorkerRunning()) {
    logger("Another worker is already running. Stop it before starting this one")
    process.exit(1)
  }

  await recover()

  connectComfySocket()
  const stopMonitor = startEngineMonitor()

  const controlClient = await redisDedicated()
  await controlClient.subscribe(REDIS_KEYS.control, (message) => {
    handleControl(message).catch((error: Error) => logger(`Control: ${error.message}`))
  })

  // BRPOP holds its connection for the whole wait, so the queue gets one of its own
  const queueClient = await redisDedicated()
  let isStopping = false

  const stop = async () => {
    if (isStopping) return
    isStopping = true
    logger("Worker stopping")
    stopMonitor()

    if (current) {
      await current.cancel?.().catch(() => undefined)
      await finishJob(current.jobId, "failed", STOPPED_MESSAGE).catch(() => undefined)
    }
    stopServices()

    const client = await redis()
    await client.del(REDIS_KEYS.engine).catch(() => undefined)
    process.exit(0)
  }
  process.on("SIGINT", stop)
  process.on("SIGTERM", stop)

  logger("Worker ready, waiting for jobs")
  while (!isStopping) {
    const popped = await queueClient.brPop(REDIS_KEYS.queue, 5).catch(() => null)
    if (popped) await runJob(popped.element)
  }
}
