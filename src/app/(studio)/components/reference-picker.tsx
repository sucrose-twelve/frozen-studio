"use client"

import { Spinner, toast } from "@heroui/react"
import { ArrowLeft, ArrowRight, ImagePlus, X } from "@keyline-icons/react"
import Image from "next/image"
import { useCallback, useEffect, useRef, useState } from "react"

import type { AssetView } from "@/actions/jobs/read"
import { uploadReference } from "@/libs/upload"
import { cls } from "@/libs/utils"

/**
 * The reference images of a form: thumbnails in order, and a tile to add more by picking, dropping or (while
 * the form is showing) pasting.
 *
 * Files are uploaded as they are added, so the form only ever holds stored assets.
 *
 * @param isOrdered - Shows each image's number and arrows to move it, for forms where the order matters
 * @param isActive - Whether this form is the visible one; only then does it take pasted images
 */
export function ReferencePicker({
  value,
  onChange,
  max,
  hint,
  isOrdered = false,
  isActive
}: Readonly<{
  value: AssetView[]
  onChange: (assets: AssetView[]) => void
  max: number
  hint: string
  isOrdered?: boolean
  isActive: boolean
}>) {
  const inputRef = useRef<HTMLInputElement>(null)
  const valueRef = useRef(value)
  const [uploading, setUploading] = useState(0)
  const [isDragOver, setIsDragOver] = useState(false)
  const isFull = value.length + uploading >= max

  useEffect(() => {
    valueRef.current = value
  }, [value])

  const addFiles = useCallback(
    async (files: File[]) => {
      const room = max - valueRef.current.length
      const images = files.filter((file) => file.type.startsWith("image/")).slice(0, room)
      if (images.length === 0) return

      setUploading((count) => count + images.length)
      for (const image of images) {
        try {
          const asset = await uploadReference(image)
          // Appended one by one from the ref, so files that finish later don't drop earlier ones
          valueRef.current = [...valueRef.current, asset]
          onChange(valueRef.current)
        } catch (error) {
          toast.danger(error instanceof Error ? error.message : "The upload failed")
        } finally {
          setUploading((count) => count - 1)
        }
      }
    },
    [max, onChange]
  )

  const handlePick = useCallback(() => inputRef.current?.click(), [])

  const handleInputChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      void addFiles([...(event.target.files ?? [])])
      event.target.value = ""
    },
    [addFiles]
  )

  const handleDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      setIsDragOver(false)
      void addFiles([...event.dataTransfer.files])
    },
    [addFiles]
  )

  const handleDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = useCallback(() => setIsDragOver(false), [])

  const handleRemove = useCallback(
    (id: string) => onChange(value.filter((asset) => asset.id !== id)),
    [value, onChange]
  )

  const handleMove = useCallback(
    (index: number, offset: -1 | 1) => {
      const next = [...value]
      const [moved] = next.splice(index, 1)
      next.splice(index + offset, 0, moved!)
      onChange(next)
    },
    [value, onChange]
  )

  useEffect(() => {
    if (!isActive) return

    const handlePaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])]
      if (files.some((file) => file.type.startsWith("image/"))) {
        event.preventDefault()
        void addFiles(files)
      }
    }

    document.addEventListener("paste", handlePaste)
    return () => document.removeEventListener("paste", handlePaste)
  }, [isActive, addFiles])

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      className={cls(
        "border-field-border bg-field flex flex-col gap-2 rounded-xl border border-dashed p-2 transition-colors",
        isDragOver && "border-glacier bg-surface-secondary"
      )}>
      <input
        ref={inputRef}
        type='file'
        accept='image/*'
        multiple={max > 1}
        hidden
        onChange={handleInputChange}
      />

      {value.length > 0 || uploading > 0 ? (
        <ul className='grid grid-cols-4 gap-2'>
          {value.map((asset, index) => (
            <li
              key={asset.id}
              className='group bg-surface-secondary relative aspect-square overflow-hidden rounded-lg'>
              <Image
                src={asset.url}
                alt={`Reference ${index + 1}`}
                width={asset.width}
                height={asset.height}
                sizes='96px'
                quality={75}
                className='size-full object-contain'
              />
              {isOrdered ? (
                <span className='bg-night/80 text-frost absolute top-1 left-1 grid size-5 place-items-center rounded-full text-[10px] font-semibold'>
                  {index + 1}
                </span>
              ) : null}
              <button
                type='button'
                aria-label={`Remove reference ${index + 1}`}
                onClick={() => handleRemove(asset.id)}
                className='bg-night/80 text-frost hover:bg-danger absolute top-1 right-1 grid size-5 place-items-center rounded-full transition-colors hover:text-white'>
                <X size={12} strokeWidth={2.25} />
              </button>
              {isOrdered && value.length > 1 ? (
                <span className='absolute inset-x-1 bottom-1 flex justify-between opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100'>
                  <button
                    type='button'
                    aria-label={`Move reference ${index + 1} earlier`}
                    disabled={index === 0}
                    onClick={() => handleMove(index, -1)}
                    className='bg-night/80 text-frost grid size-5 place-items-center rounded-full disabled:opacity-30'>
                    <ArrowLeft size={12} strokeWidth={2.25} />
                  </button>
                  <button
                    type='button'
                    aria-label={`Move reference ${index + 1} later`}
                    disabled={index === value.length - 1}
                    onClick={() => handleMove(index, 1)}
                    className='bg-night/80 text-frost grid size-5 place-items-center rounded-full disabled:opacity-30'>
                    <ArrowRight size={12} strokeWidth={2.25} />
                  </button>
                </span>
              ) : null}
            </li>
          ))}

          {Array.from({ length: uploading }, (_, index) => (
            <li
              key={`uploading-${index}`}
              className='bg-surface-secondary grid aspect-square place-items-center rounded-lg'>
              <Spinner size='sm' color='current' />
            </li>
          ))}

          {isFull ? null : (
            <li>
              <button
                type='button'
                aria-label='Add a reference image'
                onClick={handlePick}
                className='border-field-border text-muted hover:border-glacier hover:text-foreground grid aspect-square w-full place-items-center rounded-lg border border-dashed transition-colors'>
                <ImagePlus size={20} strokeWidth={1.5} />
              </button>
            </li>
          )}
        </ul>
      ) : (
        <button
          type='button'
          onClick={handlePick}
          className='text-muted hover:text-foreground flex flex-col items-center gap-1.5 rounded-lg px-3 py-5 text-center transition-colors'>
          <ImagePlus size={22} strokeWidth={1.5} />
          <span className='text-foreground text-sm font-medium'>Add images</span>
          <span className='text-xs'>{hint}</span>
        </button>
      )}
    </div>
  )
}
