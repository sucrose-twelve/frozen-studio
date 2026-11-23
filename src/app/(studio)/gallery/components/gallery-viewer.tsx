"use client"

import { Chip, Modal } from "@heroui/react"
import { format } from "date-fns"
import Image from "next/image"
import { useRouter, useSearchParams } from "next/navigation"
import { useCallback, useMemo, useState } from "react"

import type { JobDetail } from "@/actions/jobs/read"
import { JOB_KIND_LABELS } from "@/constants"

import { CopyText } from "../../components/copy-text"
import { ResultActions } from "../../components/result-actions"
import { loraLabel, modelLabel, resultFacts } from "../../utils"
import { ImageSlider } from "./image-slider"

/**
 * The pictures to step through: the opened one's siblings of the same role, so a cutout opened from the
 * Cutout filter pages through cutouts, and a result through results.
 */
function slidesOf(job: JobDetail, assetId: string | null) {
  if (job.cutouts.some((asset) => asset.id === assetId)) return job.cutouts
  return job.outputs
}

/**
 * One result of the gallery opened in a dialog the size of the studio, laid out like it: the pictures of
 * its job on the left, and on the right what made them (the settings as chips, the prompts) with the same
 * actions as the studio's canvas.
 *
 * A tile's link opens it (`?asset=`), and the server renders it with that asset's job; the page gives it a
 * `key` per asset, so each one mounts open. Closing shuts the dialog at once and takes the param out of the
 * URL through the router, like the link put it in: the dialog has animated out by the time the page comes
 * back without it. (Dropping the param with nuqs left its value for `asset` stale, so the next link opened
 * nothing.)
 *
 * @param job - The job of the opened result, or `null` when nothing is open or it is gone
 * @param assetId - The result the server rendered `job` for
 */
export function GalleryViewer({
  job,
  assetId
}: Readonly<{
  job: JobDetail | null
  assetId: string | null
}>) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isOpen, setIsOpen] = useState(true)
  const slides = useMemo(() => (job ? slidesOf(job, assetId) : []), [job, assetId])
  const [index, setIndex] = useState(() =>
    Math.max(
      0,
      slides.findIndex((asset) => asset.id === assetId)
    )
  )
  const asset = slides[index] ?? null

  const tags = useMemo(() => {
    if (!job || !asset) return []

    const params = job.params
    const list: string[] = []
    if (params.kind === "image") {
      list.push(modelLabel(params.model))
      if (params.lora) list.push(loraLabel(params.lora.name))
    }

    return [...list, ...resultFacts(job, asset)]
  }, [job, asset])

  const handleOpenChange = useCallback(
    (isOpenNow: boolean) => {
      if (isOpenNow) return

      setIsOpen(false)
      const params = new URLSearchParams(searchParams)
      params.delete("asset")
      const search = params.toString()
      router.replace(search ? `/gallery?${search}` : "/gallery", { scroll: false })
    },
    [searchParams, router]
  )

  if (!job || !asset) return null

  const negative = job.params.kind === "image" ? job.params.negative : ""

  return (
    <Modal.Backdrop isOpen={isOpen} onOpenChange={handleOpenChange}>
      <Modal.Container className='w-full p-4'>
        <Modal.Dialog
          aria-label='Result'
          className='grid h-[calc(100svh-6rem)] max-w-[calc(var(--container-9xl)-2rem)] grid-cols-[minmax(0,1fr)_30rem] grid-rows-1 overflow-hidden p-0'>
          <div className='min-h-0'>
            <ImageSlider
              images={slides}
              index={index}
              alt={job.prompt || "Result"}
              onIndexChange={setIndex}
            />
          </div>

          <aside className='border-separator flex min-h-0 flex-col border-l'>
            <Modal.Header className='gap-1 p-5 pr-14'>
              <p className='text-muted text-xs tracking-wide uppercase'>
                {JOB_KIND_LABELS[job.kind]} · {format(job.createdAt, "d MMM yyyy, HH:mm")}
              </p>
              <Modal.Heading className='text-lg font-semibold'>
                {slides.length > 1 ? `Image ${index + 1} of ${slides.length}` : "Result"}
              </Modal.Heading>
            </Modal.Header>
            <Modal.CloseTrigger />

            <Modal.Body className='m-0 flex flex-col gap-4 px-5 pb-5 text-current'>
              <div className='flex flex-wrap items-center gap-1.5'>
                {tags.map((tag) => (
                  <Chip
                    key={tag}
                    size='sm'
                    variant='soft'
                    className='font-mono text-[11px]'>
                    {tag}
                  </Chip>
                ))}
              </div>

              {job.prompt ? <CopyText title='Prompt' text={job.prompt} /> : null}
              {negative ? <CopyText title='Negative prompt' text={negative} /> : null}

              {job.inputs.length > 0 ? (
                <section className='flex flex-col gap-2'>
                  <h3 className='text-sm font-semibold'>
                    {job.kind === "cutout" ? "Cut out from" : "References"}
                  </h3>
                  <ul className='flex flex-wrap gap-2'>
                    {job.inputs.map((input) => (
                      <li
                        key={input.id}
                        className='bg-surface-secondary size-16 overflow-hidden rounded-lg'>
                        <Image
                          src={input.url}
                          alt=''
                          width={input.width}
                          height={input.height}
                          sizes='64px'
                          quality={75}
                          className='size-full object-cover'
                        />
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </Modal.Body>

            <div className='border-separator border-t p-4'>
              <ResultActions key={asset.id} job={job} asset={asset} />
            </div>
          </aside>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  )
}
