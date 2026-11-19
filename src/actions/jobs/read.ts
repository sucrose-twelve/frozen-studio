import { and, asc, count, desc, eq, inArray } from "drizzle-orm"
import { groupBy, pick } from "es-toolkit"

import { GALLERY_PAGE_SIZE, RECENT_JOBS } from "@/constants"
import { db, schema } from "@/drizzle"
import { assetColumns, jobColumns } from "@/drizzle/table-columns"
import { lastPageOf, toPagination, withPagination } from "@/drizzle/utils"
import { scriptLines } from "@/libs/job"
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
   * An image that stands for the job in lists: its first result, or for a video the frame it starts on.
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
  frames: AssetView[]
  still: AssetView | null
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
   * For a video, the image to show before it plays.
   */
  poster: AssetView | null
  /**
   * How many results of the same job the gallery holds, this one included. Deleting the job takes them all.
   */
  jobResults: number
}

const assetViewColumns = pick(assetColumns, [
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

function toAssetView(row: AssetRow): AssetView {
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
    images.find((asset) => asset.role === "cutout") ??
    images.find((asset) => asset.role === "still")

  return own ? toAssetView(own) : (firstInput ?? null)
}

/**
 * Assets that can stand for a job in a list: everything but video frames and uploads.
 */
const COVER_ROLES: Media.AssetRole[] = ["output", "cutout", "still"]

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
    cutouts: byRole.cutout ?? [],
    frames: byRole.frame ?? [],
    still: byRole.still?.[0] ?? null
  }
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
 * One page of finished results, newest first.
 *
 * @param query.kind - Only images or only videos; `null` for both
 * @param query.favorites - Only favorites
 */
export async function readGallery(query: {
  page: number
  kind: Media.AssetKind | null
  favorites: boolean
}): Promise<Pagination<GalleryItem>> {
  const filter = and(
    inArray(schema.assets.role, GALLERY_ROLES),
    query.kind ? eq(schema.assets.kind, query.kind) : undefined,
    query.favorites ? eq(schema.assets.isFavorite, true) : undefined
  )

  const [{ total = 0 } = {}] = await db
    .select({ total: count() })
    .from(schema.assets)
    .where(filter)
  const page = Math.min(Math.max(1, query.page), lastPageOf(total, GALLERY_PAGE_SIZE))

  const rows = await withPagination(
    db
      .select({
        asset: assetViewColumns,
        job: pick(jobColumns, ["id", "kind", "prompt"])
      })
      .from(schema.assets)
      .innerJoin(schema.jobs, eq(schema.jobs.id, schema.assets.jobId))
      .where(filter)
      .orderBy(desc(schema.assets.createdAt), asc(schema.assets.position))
      .$dynamic(),
    page,
    GALLERY_PAGE_SIZE
  )

  const jobIds = [...new Set(rows.map((row) => row.job.id))]
  const videoJobIds = [
    ...new Set(rows.filter((row) => row.asset.kind === "video").map((row) => row.job.id))
  ]
  const [resultCounts, stills, firstInputs] = await Promise.all([
    jobIds.length > 0
      ? db
          .select({ jobId: schema.assets.jobId, total: count() })
          .from(schema.assets)
          .where(
            and(
              inArray(schema.assets.jobId, jobIds),
              inArray(schema.assets.role, GALLERY_ROLES)
            )
          )
          .groupBy(schema.assets.jobId)
      : [],
    videoJobIds.length > 0
      ? db
          .select(assetViewColumns)
          .from(schema.assets)
          .where(
            and(
              inArray(schema.assets.jobId, videoJobIds),
              eq(schema.assets.role, "still")
            )
          )
      : [],
    readFirstInputs(videoJobIds)
  ])
  const stillByJob = new Map(stills.map((still) => [still.jobId, toAssetView(still)]))
  const resultsByJob = new Map(resultCounts.map((row) => [row.jobId, row.total]))

  const data = rows.map((row) => ({
    asset: toAssetView(row.asset),
    jobId: row.job.id,
    jobKind: row.job.kind,
    prompt:
      row.asset.kind === "audio"
        ? (scriptLines(row.job.prompt)[row.asset.position] ?? row.job.prompt)
        : row.job.prompt,
    poster:
      row.asset.kind === "video"
        ? (stillByJob.get(row.job.id) ?? firstInputs.get(row.job.id) ?? null)
        : null,
    jobResults: resultsByJob.get(row.job.id) ?? 1
  }))

  return toPagination(data, total, page, GALLERY_PAGE_SIZE)
}
