"use client"

import { Spinner } from "@heroui/react"
import { useQueryStates } from "nuqs"
import { useEffect, useRef, useTransition } from "react"

import { galleryParsers } from "../validator.nuqs"

/**
 * How far below the screen the end of the list may still be when the next page starts loading, so it is
 * usually there before it is scrolled to.
 */
const PRELOAD_MARGIN = "800px 0px"

/**
 * The end of the gallery: loads the next page when it comes near the screen, by raising `page` in the URL
 * so the server renders one page more. Shows a spinner while that page loads, and nothing once there is no
 * page left.
 *
 * The observer is set up again after every load. It only reports changes, so a page too short to push this
 * off the screen would otherwise never ask for the one after it.
 *
 * @param hasMore - Whether the server has another page
 */
export function GalleryLoader({ hasMore }: Readonly<{ hasMore: boolean }>) {
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [isPending, startTransition] = useTransition()
  const [{ page }, setQuery] = useQueryStates(galleryParsers, {
    shallow: false,
    scroll: false,
    startTransition
  })

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasMore || isPending) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) return
        observer.disconnect()
        void setQuery({ page: page + 1 })
      },
      { rootMargin: PRELOAD_MARGIN }
    )
    observer.observe(sentinel)

    return () => observer.disconnect()
  }, [hasMore, isPending, page, setQuery])

  if (!hasMore) return null

  return (
    <div
      ref={sentinelRef}
      role='status'
      className='text-muted flex h-16 items-center justify-center gap-2 text-sm'>
      {isPending ? (
        <>
          <Spinner size='sm' color='current' />
          Loading more
        </>
      ) : null}
    </div>
  )
}
