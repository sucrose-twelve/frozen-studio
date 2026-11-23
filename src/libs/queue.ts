import { ENGINE_STATUS_TTL_SECONDS, REDIS_KEYS } from "@/constants"

import { redis } from "./redis"

/**
 * Sends an event to every open browser (`/api/events` relays the channel).
 */
export async function publishEvent(event: Engine.Event) {
  const client = await redis()
  await client.publish(REDIS_KEYS.events, JSON.stringify(event))
}

/**
 * Puts jobs on the worker's queue, oldest first, and tells the browsers they are waiting, with what each
 * one is so a page can show it before loading it.
 *
 * @param jobs - Rows already saved with status `queued`
 */
export async function enqueueJobs(jobs: Engine.JobBrief[]) {
  if (jobs.length === 0) return

  const client = await redis()
  await client.lPush(
    REDIS_KEYS.queue,
    jobs.map((job) => job.id)
  )
  await Promise.all(
    jobs.map((brief) =>
      publishEvent({ type: "job", id: brief.id, status: "queued", brief })
    )
  )
}

/**
 * Takes waiting jobs back off the queue, e.g. when they are canceled or deleted before they start.
 */
export async function dequeueJobs(ids: string[]) {
  const client = await redis()
  await Promise.all(ids.map((id) => client.lRem(REDIS_KEYS.queue, 0, id)))
}

/**
 * Asks the worker to stop the job it is running. A job that isn't running is ignored there.
 */
export async function requestCancel(id: string) {
  const client = await redis()
  const control: Engine.Control = { type: "cancel", id }
  await client.publish(REDIS_KEYS.control, JSON.stringify(control))
}

/**
 * The worker's last report, or `null` when it hasn't reported within the TTL (it isn't running).
 */
export async function readEngineStatus() {
  const client = await redis()
  const stored = await client.get(REDIS_KEYS.engine)

  return stored ? (JSON.parse(stored) as Engine.Status) : null
}

/**
 * Stores the worker's status for the app's first render and streams it to open browsers.
 */
export async function writeEngineStatus(engine: Engine.Status) {
  const client = await redis()
  await client.set(REDIS_KEYS.engine, JSON.stringify(engine), {
    expiration: { type: "EX", value: ENGINE_STATUS_TTL_SECONDS }
  })
  await publishEvent({ type: "engine", engine })
}
