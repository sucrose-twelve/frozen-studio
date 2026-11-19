"use server"

import { and, eq } from "drizzle-orm"

import { db, schema } from "@/drizzle"
import { dequeueJobs, publishEvent, requestCancel } from "@/libs/queue"

import { jobIdValidator } from "./validator.zod"

/**
 * Stops a job. One that is still waiting is marked canceled right here and taken off the queue; a running
 * one is the worker's to stop, so it is only asked to (the status changes when ComfyUI lets go).
 *
 * @param input - `{ id }` of the job
 */
export async function cancelJob(input: unknown) {
  const parsed = jobIdValidator.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: "Invalid job" }

  const { id } = parsed.data
  const [canceled] = await db
    .update(schema.jobs)
    .set({ status: "canceled", finishedAt: new Date() })
    .where(and(eq(schema.jobs.id, id), eq(schema.jobs.status, "queued")))
    .returning({ id: schema.jobs.id })

  if (canceled) {
    await dequeueJobs([id])
    await publishEvent({ type: "job", id, status: "canceled" })
  } else {
    await requestCancel(id)
  }

  return { ok: true as const }
}
