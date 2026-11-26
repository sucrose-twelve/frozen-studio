import { and, asc, count, desc, eq, inArray, ne, notInArray } from "drizzle-orm"
import { groupBy, pick } from "es-toolkit"

import { ACTIVE_JOB_STATUSES, GALLERY_PAGE_SIZE, RECENT_JOBS } from "@/constants"
import { db, schema } from "@/drizzle"
import { assetColumns, jobColumns } from "@/drizzle/table-columns"
import { lastPageOf, toPagination } from "@/drizzle/utils"
import { jobDetails, scriptLines } from "@/libs/job"
import { assetFileName } from "@/libs/media"

/**
 * An asset as the browser sees it: addressed by id (`url`), never by its path on disk.
 */
export type AssetView = {
  id: string
  kind: Media.AssetKind
  role: Media.AssetRole
  width: number
  height: number
  position: number
  isFavorite: boolean
  name: string
  url: string
}

export type JobSummary = {
  id: string
  kind: Media.JobKind
  status: Media.JobStatus
  prompt: string
  createdAt: number
  /**
   * An image that stands for the job in lists: its first result, or the reference it started from.
   */
  cover: AssetView | null
}

export type JobDetail = {
  id: string
  kind: Media.JobKind
  status: Media.JobStatus
  prompt: string
  params: Media.JobParams
  error: string | null
  /**
   * What a caption job wrote; `null` for every other kind, and until the job has finished.
   */
  result: Media.Caption | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  inputs: AssetView[]
  outputs: AssetView[]
  cutouts: AssetView[]
}

export type GalleryItem = {
  asset: AssetView
  jobId: string
  jobKind: Media.JobKind
  /**
   * The job's prompt, or for a voice clip the one line it speaks.
   */
  prompt: string
  /**
   * How many results of the same job the gallery holds, this one included. Deleting the job takes them all.
   */
  jobResults: number
  /**
   * How many pictures the viewer pages through from this one: the job's results of the same role (its
   * outputs, or its cutouts), this one included.
   */
  setSize: number
}

/**
 * The asset columns an `AssetView` is made from. Select them and map the rows with `toAssetView`.
 */
export const assetViewColumns = pick(assetColumns, [
  "id",
  "jobId",
  "kind",
  "role",
  "path",
  "width",
  "height",
  "position",
  "isFavorite"
])

type AssetRow = Pick<typeof schema.assets.$inferSelect, keyof typeof assetViewColumns>

export function toAssetView(row: AssetRow): AssetView {
  return {
    id: row.id,
    kind: row.kind,
    role: row.role,
    width: row.width,
    height: row.height,
    position: row.position,
    isFavorite: row.isFavorite,
    name: assetFileName(row.path),
    url: `/api/media/${row.id}`
  }
}

/**
 * The first reference image of each job, by job id.
 */
async function readFirstInputs(jobIds: string[]) {
  if (jobIds.length === 0) return new Map<string, AssetView>()

  const rows = await db
    .select({ jobId: schema.jobInputs.jobId, asset: assetViewColumns })
    .from(schema.jobInputs)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.jobInputs.assetId))
    .where(and(inArray(schema.jobInputs.jobId, jobIds), eq(schema.jobInputs.position, 0)))

  return new Map(rows.map((row) => [row.jobId, toAssetView(row.asset)]))
}

/**
 * Picks the image that stands for a job: its own first image, else the reference it started from.
 */
function coverOf(assets: AssetRow[], firstInput: AssetView | undefined) {
  const images = assets
    .filter((asset) => asset.kind === "image")
    .toSorted((a, b) => a.position - b.position)
  const own =
    images.find((asset) => asset.role === "output") ??
    images.find((asset) => asset.role === "cutout")

  return own ? toAssetView(own) : (firstInput ?? null)
}

/**
 * Assets that can stand for a job in a list: everything but uploads.
 */
const COVER_ROLES: Media.AssetRole[] = ["output", "cutout"]

/**
 * Assets the gallery shows: the results themselves, and their cutouts.
 */
const GALLERY_ROLES: Media.AssetRole[] = ["output", "cutout"]

/**
 * The newest jobs with a cover each, for a page's recent strip.
 *
 * @param kinds - The kinds that page shows: the studio's modes, or captions on their own page
 */
export async function readRecentJobs(
  kinds: readonly Media.JobKind[],
  limit = RECENT_JOBS
): Promise<JobSummary[]> {
  const jobs = await db
    .select(pick(jobColumns, ["id", "kind", "status", "prompt", "createdAt"]))
    .from(schema.jobs)
    .where(inArray(schema.jobs.kind, [...kinds]))
    .orderBy(desc(schema.jobs.createdAt))
    .limit(limit)
  if (jobs.length === 0) return []

  const jobIds = jobs.map((job) => job.id)
  const [assets, firstInputs] = await Promise.all([
    db
      .select(assetViewColumns)
      .from(schema.assets)
      .where(
        and(
          inArray(schema.assets.jobId, jobIds),
          inArray(schema.assets.role, COVER_ROLES)
        )
      ),
    readFirstInputs(jobIds)
  ])
  const assetsByJob = groupBy(assets, (asset) => asset.jobId ?? "")

  return jobs.map((job) => ({
    id: job.id,
    kind: job.kind,
    status: job.status,
    prompt: job.prompt,
    createdAt: job.createdAt.getTime(),
    cover: coverOf(assetsByJob[job.id] ?? [], firstInputs.get(job.id))
  }))
}

export type ActiveJob = Engine.JobBrief & { status: Media.JobStatus }

/**
 * Every job the worker still has to finish, oldest first: the job toasts a page opens with.
 */
export async function readActiveJobs(): Promise<ActiveJob[]> {
  const jobs = await db
    .select(pick(jobColumns, ["id", "kind", "status", "prompt", "params"]))
    .from(schema.jobs)
    .where(inArray(schema.jobs.status, [...ACTIVE_JOB_STATUSES]))
    .orderBy(asc(schema.jobs.createdAt))

  return jobs.map((job) => ({
    id: job.id,
    kind: job.kind,
    status: job.status,
    details: jobDetails(job.prompt, job.params)
  }))
}

/**
 * One job with everything it used and produced.
 */
export async function readJob(id: string): Promise<JobDetail | null> {
  const [[job], assets, inputs] = await Promise.all([
    db.select().from(schema.jobs).where(eq(schema.jobs.id, id)).limit(1),
    db
      .select(assetViewColumns)
      .from(schema.assets)
      .where(eq(schema.assets.jobId, id))
      .orderBy(asc(schema.assets.position)),
    db
      .select({ asset: assetViewColumns })
      .from(schema.jobInputs)
      .innerJoin(schema.assets, eq(schema.assets.id, schema.jobInputs.assetId))
      .where(eq(schema.jobInputs.jobId, id))
      .orderBy(asc(schema.jobInputs.position))
  ])
  if (!job) return null

  const byRole = groupBy(assets.map(toAssetView), (asset) => asset.role)

  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    prompt: job.prompt,
    params: job.params,
    error: job.error,
    result: job.result,
    createdAt: job.createdAt.getTime(),
    startedAt: job.startedAt?.getTime() ?? null,
    finishedAt: job.finishedAt?.getTime() ?? null,
    inputs: inputs.map((row) => toAssetView(row.asset)),
    outputs: byRole.output ?? [],
    cutouts: byRole.cutout ?? []
  }
}

/**
 * The job that made an asset, with everything it used and produced; `null` for an upload or an asset that
 * is gone. The gallery opens a result this way, knowing only the result.
 */
export async function readAssetJob(assetId: string): Promise<JobDetail | null> {
  const [asset] = await db
    .select({ jobId: schema.assets.jobId })
    .from(schema.assets)
    .where(eq(schema.assets.id, assetId))
    .limit(1)

  return asset?.jobId ? readJob(asset.jobId) : null
}

/**
 * Assets by id, in the order asked for; ids that don't exist are left out. Used to put images back into a
 * form (a reference sent from a result, or the references of a job being reused).
 */
export async function readAssets(ids: string[]): Promise<AssetView[]> {
  if (ids.length === 0) return []

  const rows = await db
    .select(assetViewColumns)
    .from(schema.assets)
    .where(inArray(schema.assets.id, ids))
  const byId = new Map(rows.map((row) => [row.id, toAssetView(row)]))

  return ids.flatMap((id) => byId.get(id) ?? [])
}

/**
 * Finished results of one kind, newest first: every page up to `query.page`, for a gallery that loads the
 * next page as it is scrolled. Rendering them all again on each load (rather than appending on the client)
 * keeps `router.refresh()` working: a deleted job or a new result shows without the pages drifting apart.
 * `currentPage` is the last page loaded, `nextPage` whether there is another.
 *
 * @param query.kind - Images or voice clips, or `"cutout"`: the transparent copies, whichever kind
 *   of job made them. They are images too, and are left out of `"image"` so each shows once
 * @param query.favorites - Only favorites
 */
export async function readGallery(query: {
  page: number
  kind: Media.GalleryKind
  favorites: boolean
}): Promise<Pagination<GalleryItem>> {
  const filter = and(
    inArray(schema.assets.role, GALLERY_ROLES),
    // A spoken chat message is the chat's, and is heard there
    notInArray(
      schema.assets.jobId,
      db
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(eq(schema.jobs.kind, "speech"))
    ),
    query.kind === "cutout"
      ? eq(schema.assets.role, "cutout")
      : and(eq(schema.assets.kind, query.kind), ne(schema.assets.role, "cutout")),
    query.favorites ? eq(schema.assets.isFavorite, true) : undefined
  )

  const [{ total = 0 } = {}] = await db
    .select({ total: count() })
    .from(schema.assets)
    .where(filter)
  const page = Math.min(Math.max(1, query.page), lastPageOf(total, GALLERY_PAGE_SIZE))

  const rows = await db
    .select({
      asset: assetViewColumns,
      job: pick(jobColumns, ["id", "kind", "prompt"])
    })
    .from(schema.assets)
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.assets.jobId))
    .where(filter)
    .orderBy(desc(schema.assets.createdAt), asc(schema.assets.position))
    .limit(page * GALLERY_PAGE_SIZE)

  const jobIds = [...new Set(rows.map((row) => row.job.id))]
  const resultCounts =
    jobIds.length > 0
      ? await db
          .select({
            jobId: schema.assets.jobId,
            role: schema.assets.role,
            total: count()
          })
          .from(schema.assets)
          .where(
            and(
              inArray(schema.assets.jobId, jobIds),
              inArray(schema.assets.role, GALLERY_ROLES)
            )
          )
          .groupBy(schema.assets.jobId, schema.assets.role)
      : []
  const resultsByJob = new Map<string | null, number>()
  const resultsByRole = new Map<string, number>()
  for (const row of resultCounts) {
    resultsByJob.set(row.jobId, (resultsByJob.get(row.jobId) ?? 0) + row.total)
    resultsByRole.set(`${row.jobId}:${row.role}`, row.total)
  }

  const data = rows.map((row) => ({
    asset: toAssetView(row.asset),
    jobId: row.job.id,
    jobKind: row.job.kind,
    prompt:
      row.asset.kind === "audio"
        ? (scriptLines(row.job.prompt)[row.asset.position] ?? row.job.prompt)
        : row.job.prompt,
    jobResults: resultsByJob.get(row.job.id) ?? 1,
    setSize: resultsByRole.get(`${row.job.id}:${row.asset.role}`) ?? 1
  }))

  return toPagination(data, total, page, GALLERY_PAGE_SIZE)
}
