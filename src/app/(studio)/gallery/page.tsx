import { AudioLines, ChevronLeft, ChevronRight } from "@keyline-icons/react"
import { Play, Star } from "@keyline-icons/react/fill"
import type { Metadata } from "next"
import Image from "next/image"
import NextLink from "next/link"

import { readGallery, type GalleryItem } from "@/actions/jobs/read"
import { cls } from "@/libs/utils"

import { DeleteJobButton } from "../components/delete-job-button"
import { GalleryFilters } from "./components/gallery-filters"
import { queryValidator, type QueryValidator } from "./validator.nuqs"

export const instant = false

export const metadata: Metadata = { title: "Gallery" }

/**
 * A link to another page of the gallery that keeps the current filters.
 */
function pageHref(query: QueryValidator, page: number) {
  const params = new URLSearchParams()
  if (page > 1) params.set("page", String(page))
  if (query.kind) params.set("kind", query.kind)
  if (query.favorites) params.set("favorites", "true")

  const search = params.toString()
  return search ? `/gallery?${search}` : "/gallery"
}

/**
 * One result: a link back into the studio, with a delete button over its corner.
 *
 * The button sits beside the link, not inside it: a button in a link is not valid, and its press would
 * follow the link. It shows on hover or keyboard focus, and always where there is no hover (touch).
 */
function GalleryTile({ item }: Readonly<{ item: GalleryItem }>) {
  const { asset, poster } = item
  const cover = asset.kind === "image" ? asset : poster

  return (
    <div className='group relative'>
      <NextLink
        href={`/?job=${item.jobId}&mode=${item.jobKind}&asset=${asset.id}`}
        title={item.prompt || undefined}
        className={cls(
          "border-border hover:border-glacier relative block aspect-square overflow-hidden rounded-xl border transition-colors",
          asset.role === "cutout" ? "use-checkerboard" : "bg-surface-secondary"
        )}>
        {asset.kind === "audio" ? (
          <span className='flex size-full flex-col gap-2 p-3'>
            <AudioLines size={22} strokeWidth={1.5} className='text-glacier shrink-0' />
            <span lang='ja' className='line-clamp-5 text-sm leading-relaxed'>
              {item.prompt}
            </span>
          </span>
        ) : cover ? (
          <Image
            src={cover.url}
            alt={item.prompt || "Result"}
            width={cover.width}
            height={cover.height}
            sizes='(min-width: 1280px) 16vw, (min-width: 768px) 25vw, 50vw'
            quality={75}
            className='size-full object-contain transition-transform duration-300'
          />
        ) : null}

        {asset.kind === "video" ? (
          <span className='bg-night/70 text-frost absolute bottom-2 left-2 grid size-7 place-items-center rounded-full'>
            <Play size={13} />
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
    </div>
  )
}

/**
 * Every finished result, newest first: a grid that opens a result back in the studio.
 */
export default async function Gallery({ searchParams }: NextSearchParams) {
  const query = queryValidator.parse(await searchParams)
  const page = await readGallery(query)

  return (
    <section className='max-w-9xl mx-auto flex w-full flex-col gap-6 px-5 py-8'>
      <header className='flex flex-wrap items-end justify-between gap-4'>
        <div>
          <h1 className='text-2xl font-semibold tracking-tight'>Gallery</h1>
          <p className='text-muted mt-1 text-sm'>
            {page.count === 1 ? "1 result" : `${page.count} results`}. Open one to reroll
            it, reuse its settings, or send it on; hover one to delete its job.
          </p>
        </div>
        <GalleryFilters />
      </header>

      {page.data.length > 0 ? (
        <ul className='grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-6'>
          {page.data.map((item) => (
            <li key={item.asset.id}>
              <GalleryTile item={item} />
            </li>
          ))}
        </ul>
      ) : (
        <div className='use-panel flex flex-col items-center gap-2 py-24 text-center'>
          <p className='text-lg font-semibold'>Nothing matches</p>
          <p className='text-muted text-sm'>
            {query.kind || query.favorites
              ? "Try another filter."
              : "Results show up here as soon as a job finishes."}
          </p>
        </div>
      )}

      {page.lastPage > 1 ? (
        <nav
          aria-label='Pages'
          className='flex items-center justify-center gap-4 text-sm'>
          {page.prevPage ? (
            <NextLink
              href={pageHref(query, page.prevPage)}
              className='hover:bg-surface inline-flex h-9 items-center gap-1 rounded-full px-3 font-medium transition-colors'>
              <ChevronLeft size={16} strokeWidth={1.75} />
              Previous
            </NextLink>
          ) : null}
          <span className='text-muted tabular-nums'>
            Page {page.currentPage} of {page.lastPage}
          </span>
          {page.nextPage ? (
            <NextLink
              href={pageHref(query, page.nextPage)}
              className='hover:bg-surface inline-flex h-9 items-center gap-1 rounded-full px-3 font-medium transition-colors'>
              Next
              <ChevronRight size={16} strokeWidth={1.75} />
            </NextLink>
          ) : null}
        </nav>
      ) : null}
    </section>
  )
}
