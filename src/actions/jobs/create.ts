"use server"

import { asc, eq, inArray } from "drizzle-orm"
import { z } from "zod"

import { db, schema } from "@/drizzle"
import { randomSeed, toImageParams, toVideoParams } from "@/libs/job"
import { enqueueJobs, readEngineStatus } from "@/libs/queue"

import { jobIdValidator, jobValidator } from "./validator.zod"

type Draft = {
  kind: Media.JobKind
  prompt: string
  params: Media.JobParams
  references: string[]
}

/**
 * Saves job rows with their reference images and puts them on the worker's queue.
 *
 * @returns The new job ids, in the order of `drafts`
 */
async function saveAndEnqueue(drafts: Draft[]) {
  const ids = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(schema.jobs)
      .values(drafts.map(({ kind, prompt, params }) => ({ kind, prompt, params })))
      .returning({ id: schema.jobs.id })

    const inputs = rows.flatMap((row, index) =>
      drafts[index].references.map((assetId, position) => ({
        jobId: row.id,
        assetId,
        position
      }))
    )
    if (inputs.length > 0) await tx.insert(schema.jobInputs).values(inputs)

    return rows.map((row) => row.id)
  })

  await enqueueJobs(ids)
  return ids
}

/**
 * Queues what a studio form asks for: one image or video job, or one cutout job per image.
 *
 * @param input - A form's values; see `jobValidator`
 * @returns The new job ids, field `errors` for an invalid form, or a `message` when the job can't run
 */
export async function createJob(input: unknown) {
  const parsed = jobValidator.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false as const,
      message: "Check the highlighted fields",
      errors: z.flattenError(parsed.error).fieldErrors
    }
  }

  const data = parsed.data
  const referenceIds = [...new Set(data.references)]
  if (referenceIds.length > 0) {
    const found = await db
      .select({ id: schema.assets.id, kind: schema.assets.kind })
      .from(schema.assets)
      .where(inArray(schema.assets.id, referenceIds))

    if (found.length !== referenceIds.length || found.some((a) => a.kind !== "image")) {
      return {
        ok: false as const,
        message: "A reference image no longer exists. Remove it and add it again."
      }
    }
  }

  const engine = await readEngineStatus().catch(() => null)
  let drafts: Draft[]

  switch (data.kind) {
    case "image": {
      const installed = engine?.models.image?.models
      if (installed && !installed.includes(data.model)) {
        return {
          ok: false as const,
          message: "That image model isn't installed any more."
        }
      }

      drafts = [
        {
          kind: "image",
          prompt: data.prompt,
          params: toImageParams(data),
          references: data.references
        }
      ]
      break
    }
    case "video": {
      const result = toVideoParams(data, engine?.models ?? null)
      if (!result.ok) return { ok: false as const, message: result.message }

      drafts = [
        {
          kind: "video",
          prompt: data.prompt,
          params: result.params,
          references: data.references
        }
      ]
      break
    }
    case "cutout":
      drafts = data.references.map((assetId) => ({
        kind: "cutout",
        prompt: "",
        params: { kind: "cutout" },
        references: [assetId]
      }))
      break
  }

  return { ok: true as const, ids: await saveAndEnqueue(drafts) }
}

/**
 * Queues a copy of a job with a new seed: the same prompt, settings and references, a different roll.
 *
 * @param input - `{ id }` of the job to repeat
 * @returns The new job's id, or a `message` when the job is gone
 */
export async function rerollJob(input: unknown) {
  const parsed = jobIdValidator.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: "Invalid job" }

  const [job] = await db
    .select({
      kind: schema.jobs.kind,
      prompt: schema.jobs.prompt,
      params: schema.jobs.params
    })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, parsed.data.id))
    .limit(1)
  if (!job) return { ok: false as const, message: "That job no longer exists." }

  const inputs = await db
    .select({ assetId: schema.jobInputs.assetId })
    .from(schema.jobInputs)
    .where(eq(schema.jobInputs.jobId, parsed.data.id))
    .orderBy(asc(schema.jobInputs.position))

  const params =
    job.params.kind === "cutout" ? job.params : { ...job.params, seed: randomSeed() }
  const [id] = await saveAndEnqueue([
    {
      kind: job.kind,
      prompt: job.prompt,
      params,
      references: inputs.map((row) => row.assetId)
    }
  ])

  return { ok: true as const, id: id! }
}
