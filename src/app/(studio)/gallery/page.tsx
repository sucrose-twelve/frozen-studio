import { Images, SquareArrowOutUpRight } from "@keyline-icons/react"
import { Star } from "@keyline-icons/react/fill"
import type { Metadata } from "next"
import Image from "next/image"
import NextLink from "next/link"
import { z } from "zod"

import { readAssetJob, readGallery, type GalleryItem } from "@/actions/jobs/read"
import { GALLERY_KINDS } from "@/constants"
import { cls } from "@/libs/utils"

import { DeleteJobButton } from "../components/delete-job-button"
import { VoiceClip } from "../components/voice-clip"
import { GalleryFilters } from "./components/gallery-filters"
import { GalleryLoader } from "./components/gallery-loader"
import { GalleryViewer } from "./components/gallery-viewer"
import { queryValidator, type QueryValidator } from "./validator.nuqs"

export const instant = false

export const metadata: Metadata = { title: "Gallery" }

/**
 * Where a result opens in the studio: its job on the canvas, with this result picked out.
 */
function studioHref(item: GalleryItem) {
  return `/?job=${item.jobId}&mode=${item.jobKind}&asset=${item.asset.id}`
}

/**
 * The gallery as it is, with one result open in the viewer: the filters and how far it has loaded stay, so
 * the list behind the dialog doesn't change.
 */
function viewerHref(query: QueryValidator, assetId: string) {
  const params = new URLSearchParams()
  if (query.page > 1) params.set("page", String(query.page))
  if (query.kind !== GALLERY_KINDS[0]) params.set("kind", query.kind)
  if (query.favorites) params.set("favorites", "true")
  params.set("asset", assetId)

  return `/gallery?${params.toString()}`
}

/**
 * Width over height of a result, from the size stored with it, so its tile has its shape before the file
 * loads. Anything without a picture (stored as 0 × 0) is square.
 */
function aspectOf(asset: GalleryItem["asset"]) {
  return asset.width > 0 && asset.height > 0 ? asset.width / asset.height : 1
}

/**
 * One picture: a link that opens it in the viewer, with a delete button over its corner. The link replaces
 * the history entry and keeps the scroll, so closing the viewer is where it was. A picture whose job made
 * more than one (of its role) shows how many in its top-left corner: the viewer pages through them all.
 *
 * The tile is one item of a justified row (see `Gallery`): it starts `--row-height` tall at its own
 * aspect, and grows by its aspect too, so every tile of a row ends up the same height and the row fills
 * the width exactly.
 *
 * The button sits beside the link, not inside it: a button in a link is not valid, and its press would
 * follow the link. It shows on hover or keyboard focus, and always where there is no hover (touch).
 */
function GalleryTile({ item, href }: Readonly<{ item: GalleryItem; href: string }>) {
  const { asset } = item
  const aspect = aspectOf(asset)

  return (
    <li
      className='group relative'
      style={{ flexGrow: aspect, flexBasis: `calc(var(--row-height) * ${aspect})` }}>
      <NextLink
        href={href}
        replace
        scroll={false}
        prefetch={false}
        style={{ aspectRatio: aspect }}
        className={cls(
          "after:ring-border hover:after:ring-glacier relative block w-full overflow-hidden rounded-md after:absolute after:inset-0 after:rounded-[inherit] after:ring-1 after:transition-colors after:ring-inset",
          asset.role === "cutout" ? "use-checkerboard" : "bg-surface-secondary"
        )}>
        <Image
          src={asset.url}
          alt={item.prompt || "Result"}
          width={asset.width}
          height={asset.height}
          // A row grows past `--row-height` to fill the width, but rarely past 1.5 times it
          sizes={`${Math.ceil(aspect * 360)}px`}
          quality={75}
          className='size-full object-cover'
        />

        {item.setSize > 1 ? (
          <span className='bg-night/70 text-frost absolute top-2 left-2 inline-flex h-7 items-center gap-1 rounded-full px-2 text-xs font-medium tabular-nums'>
            <Images size={14} strokeWidth={1.75} aria-hidden />
            {item.setSize}
            <span className='sr-only'>images</span>
          </span>
        ) : null}

        {asset.isFavorite ? (
          <span className='bg-night/70 text-warning absolute top-2 right-2 grid size-7 place-items-center rounded-full'>
            <Star size={14} />
          </span>
        ) : null}
      </NextLink>

      <div className='absolute right-2 bottom-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100'>
        <DeleteJobButton
          jobId={item.jobId}
          resultCount={item.jobResults}
          className='bg-night/75 text-frost hover:bg-night rounded-full'
        />
      </div>
    </li>
  )
}

/**
 * One voice clip: the same row the studio shows for it, so it can be read in full and played here, with a
 * way back into the studio and the delete button beside its own two.
 */
function GalleryClip({ item }: Readonly<{ item: GalleryItem }>) {
  return (
    <VoiceClip clip={item.asset} text={item.prompt}>
      <NextLink
        href={studioHref(item)}
        aria-label='Open in the studio'
        title='Open in the studio'
        className='text-muted hover:bg-surface-secondary hover:text-foreground grid size-8 place-items-center rounded-full transition-colors'>
        <SquareArrowOutUpRight size={15} strokeWidth={1.75} />
      </NextLink>
      <DeleteJobButton jobId={item.jobId} resultCount={item.jobResults} />
    </VoiceClip>
  )
}

/**
 * The finished results of one kind, newest first, loading the next page as the end comes into view.
 * Pictures are justified rows, and one opens in a viewer over the list (`?asset=`); voice clips are a
 * list, since what tells them apart is a line of text and its sound.
 *
 * The rows are plain flex wrapping, no measuring: each tile grows in proportion to its aspect, so a row's
 * tiles share one height and keep their shape at any width. The `::after` takes the free space of the last
 * row, which would otherwise stretch its few tiles to the full width.
 */
export default async function Gallery({ searchParams }: NextSearchParams) {
  const query = queryValidator.parse(await searchParams)
  const assetId = z.uuid().safeParse(query.asset).success ? query.asset : null

  const [page, viewed] = await Promise.all([
    readGallery(query),
    assetId ? readAssetJob(assetId) : null
  ])

  return (
    <section className='max-w-9xl mx-auto flex w-full flex-col gap-6 px-5 py-8'>
      <header className='flex flex-wrap items-end justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>Gallery</h1>
          <p className='text-muted mt-1 text-sm'>
            {page.count === 1 ? "1 result" : `${page.count} results`}.{" "}
            {query.kind === "audio"
              ? "Play a clip here, or open it in the studio to reroll it or reuse its settings."
              : "Open one to reroll it, reuse its settings, or send it on; hover one to delete its job."}
          </p>
        </div>
        <GalleryFilters />
      </header>

      {page.data.length > 0 && query.kind === "audio" ? (
        <ul className='mx-auto flex w-full max-w-3xl flex-col gap-3'>
          {page.data.map((item) => (
            <li key={item.asset.id}>
              <GalleryClip item={item} />
            </li>
          ))}
        </ul>
      ) : page.data.length > 0 ? (
        <ul className='flex flex-wrap gap-1.5 [--row-height:14rem] after:grow-[1000000]'>
          {page.data.map((item) => (
            <GalleryTile
              key={item.asset.id}
              item={item}
              href={viewerHref(query, item.asset.id)}
            />
          ))}
        </ul>
      ) : (
        <div className='use-panel flex flex-col items-center gap-2 py-24 text-center'>
          <p className='text-lg font-semibold'>Nothing here</p>
          <p className='text-muted text-sm'>
            {query.favorites
              ? "No favorites of this kind yet."
              : "Results of this kind show up here as soon as a job finishes."}
          </p>
        </div>
      )}

      <GalleryLoader hasMore={page.nextPage !== null} />
      <GalleryViewer key={assetId ?? "none"} job={viewed} assetId={assetId} />
    </section>
  )
}
