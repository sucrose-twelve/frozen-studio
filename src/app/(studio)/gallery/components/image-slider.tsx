"use client"

import { Button } from "@heroui/react"
import { ChevronLeft, ChevronRight } from "@keyline-icons/react"
import { useCallback, useEffect } from "react"

import type { AssetView } from "@/actions/jobs/read"
import { cls } from "@/libs/utils"

const ICON = { size: 18, strokeWidth: 1.75 } as const

/**
 * The pictures of one job side by side on a track that slides to the one shown, with buttons and the arrow
 * keys to step through them. With a single picture it is just that picture.
 *
 * Every picture is the file itself, at full quality, as on the studio's canvas. A job has a handful at
 * most, so they all load up front and the slide never waits for one.
 *
 * @param index - The picture shown
 * @param onIndexChange - Asked for the previous or next picture; never past either end
 */
export function ImageSlider({
  images,
  index,
  alt,
  onIndexChange
}: Readonly<{
  images: AssetView[]
  index: number
  alt: string
  onIndexChange: (index: number) => void
}>) {
  const hasPrev = index > 0
  const hasNext = index < images.length - 1

  const handlePrev = useCallback(() => {
    if (hasPrev) onIndexChange(index - 1)
  }, [hasPrev, index, onIndexChange])
  const handleNext = useCallback(() => {
    if (hasNext) onIndexChange(index + 1)
  }, [hasNext, index, onIndexChange])

  useEffect(() => {
    if (images.length < 2) return

    const handleKeyDown = (event: KeyboardEvent) => {
      // Arrows in a field move its caret, not the pictures
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea"))
        return
      if (event.key === "ArrowLeft") handlePrev()
      if (event.key === "ArrowRight") handleNext()
    }
    window.addEventListener("keydown", handleKeyDown)

    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [images.length, handlePrev, handleNext])

  return (
    <div className='use-dot-grid relative size-full overflow-hidden'>
      <ul
        className='flex size-full transition-transform duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none'
        style={{ transform: `translateX(-${index * 100}%)` }}>
        {images.map((image, imageIndex) => (
          <li
            key={image.id}
            aria-hidden={imageIndex !== index}
            className='flex size-full shrink-0 items-center justify-center p-6'>
            <img
              src={image.url}
              alt={alt}
              width={image.width}
              height={image.height}
              className={cls(
                "h-auto max-h-full w-auto max-w-full rounded-xl object-contain shadow-2xl shadow-black/40",
                image.role === "cutout" && "use-checkerboard"
              )}
            />
          </li>
        ))}
      </ul>

      {images.length > 1 ? (
        <>
          <Button
            variant='tertiary'
            isIconOnly
            aria-label='Previous image'
            isDisabled={!hasPrev}
            className='bg-night/70 text-frost hover:bg-night absolute top-1/2 left-3 -translate-y-1/2 rounded-full backdrop-blur'
            onPress={handlePrev}>
            <ChevronLeft {...ICON} />
          </Button>
          <Button
            variant='tertiary'
            isIconOnly
            aria-label='Next image'
            isDisabled={!hasNext}
            className='bg-night/70 text-frost hover:bg-night absolute top-1/2 right-3 -translate-y-1/2 rounded-full backdrop-blur'
            onPress={handleNext}>
            <ChevronRight {...ICON} />
          </Button>

          <div className='absolute inset-x-0 bottom-3 flex justify-center'>
            <div className='bg-night/70 flex items-center gap-1.5 rounded-full px-3 py-2 backdrop-blur'>
              {images.map((image, imageIndex) => (
                <button
                  key={image.id}
                  type='button'
                  aria-label={`Show image ${imageIndex + 1}`}
                  aria-current={imageIndex === index}
                  onClick={() => onIndexChange(imageIndex)}
                  className={cls(
                    "h-1.5 rounded-full transition-all duration-300",
                    imageIndex === index
                      ? "bg-frost w-5"
                      : "bg-frost/40 hover:bg-frost/70 w-1.5"
                  )}
                />
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
