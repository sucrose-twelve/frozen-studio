"use server"

import fs from "node:fs"

import { and, asc, eq, inArray, or } from "drizzle-orm"

import { ACTIVE_JOB_STATUSES } from "@/constants"
import { db, schema } from "@/drizzle"
import { assetFilePath, removeJobFolder } from "@/libs/media"

import { assetIdValidator } from "./validator.zod"

/**
 * The roles that are a job's results: what the gallery shows, and what can be deleted one at a time.
 */
const RESULT_ROLES: Media.AssetRole[] = ["output", "cutout"]

/**
 * Deletes one result of a finished job and its file, so a bad picture in a set can go while the good ones
 * stay. This can't be undone; the UI asks first.
 *
 * - An image takes its cutout with it (the job's cutout at the same position): it is the same picture.
 * - When nothing of the job's results would be left, the whole job goes, as with `deleteJob`.
 *
 * @param input - `{ id }` of the asset: an output or a cutout, never an upload
 * @returns Whether the job went too, and the result to show next in its place: the next one of the same
 *   role, or the one before when it was the last
 */
export async function deleteAsset(input: unknown) {
  const parsed = assetIdValidator.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: "Invalid result" }

  const [asset] = await db
    .select({
      id: schema.assets.id,
      jobId: schema.assets.jobId,
      role: schema.assets.role,
      position: schema.assets.position,
      status: schema.jobs.status
    })
    .from(schema.assets)
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.assets.jobId))
    .where(eq(schema.assets.id, parsed.data.id))
    .limit(1)
  if (!asset?.jobId) return { ok: true as const, isJobDeleted: false, nextAssetId: null }
  if (!RESULT_ROLES.includes(asset.role)) {
    return { ok: false as const, message: "Only results can be deleted here." }
  }
  if (ACTIVE_JOB_STATUSES.includes(asset.status)) {
    return { ok: false as const, message: "Cancel the job before deleting from it." }
  }

  const results = await db
    .select({
      id: schema.assets.id,
      role: schema.assets.role,
      position: schema.assets.position,
      root: schema.assets.root,
      path: schema.assets.path
    })
    .from(schema.assets)
    .where(
      and(eq(schema.assets.jobId, asset.jobId), inArray(schema.assets.role, RESULT_ROLES))
    )
    .orderBy(asc(schema.assets.position))

  const isDoomed = (result: (typeof results)[number]) =>
    result.id === asset.id ||
    (asset.role === "output" &&
      result.role === "cutout" &&
      result.position === asset.position)
  const doomed = results.filter(isDoomed)

  if (doomed.length === results.length) {
    await db.delete(schema.jobs).where(eq(schema.jobs.id, asset.jobId))
    await removeJobFolder(asset.jobId)
    return { ok: true as const, isJobDeleted: true, nextAssetId: null }
  }

  await db
    .delete(schema.assets)
    .where(or(...doomed.map((result) => eq(schema.assets.id, result.id))))
  await Promise.all(
    doomed.map((result) => {
      const filePath = assetFilePath(result)
      return filePath ? fs.promises.rm(filePath, { force: true }) : undefined
    })
  )

  const siblings = results.filter(
    (result) => result.role === asset.role && !isDoomed(result)
  )
  const next =
    siblings.find((result) => result.position > asset.position) ?? siblings.at(-1)

  return { ok: true as const, isJobDeleted: false, nextAssetId: next?.id ?? null }
}
