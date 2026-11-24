"use server"

import { eq } from "drizzle-orm"

import { ACTIVE_JOB_STATUSES } from "@/constants"
import { db, schema } from "@/drizzle"
import { removeJobFolder } from "@/libs/media"

import { jobIdValidator } from "./validator.zod"

/**
 * Deletes a finished job with every file it produced. This can't be undone; the UI asks first.
 *
 * Each job writes into its own folder (`<output>/frozen/<jobId>`), so the files go with the folder and the
 * asset rows with the job (cascade). Reference images the user uploaded are kept: other jobs may use them.
 *
 * @param input - `{ id }` of the job
 * @returns A `message` when the job is still queued or running (cancel it first)
 */
export async function deleteJob(input: unknown) {
  const parsed = jobIdValidator.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: "Invalid job" }

  const { id } = parsed.data
  const [job] = await db
    .select({ status: schema.jobs.status })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, id))
    .limit(1)
  if (!job) return { ok: true as const }
  if (ACTIVE_JOB_STATUSES.includes(job.status)) {
    return { ok: false as const, message: "Cancel the job before deleting it." }
  }

  await db.delete(schema.jobs).where(eq(schema.jobs.id, id))
  await removeJobFolder(id)
  return { ok: true as const }
}
