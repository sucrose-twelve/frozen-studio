"use client"

import { AlertDialog, Button, toast, useOverlayState } from "@heroui/react"
import { Bin } from "@keyline-icons/react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { useCallback, useState } from "react"

import { deleteAsset } from "@/actions/assets/delete"
import type { AssetView } from "@/actions/jobs/read"

import { useStudioQuery } from "../hooks/use-studio-query"

/**
 * Deletes one image of a job after asking, so a bad picture in a set goes and the good ones stay. Its cutout
 * goes with it; the job goes too when it was the job's last result.
 *
 * Afterwards whatever showed the image moves on: the studio's canvas and the gallery's viewer to the next
 * image of the job (or, with the job gone, the newest job / closed), and a gallery tile just disappears.
 *
 * @param isLastResult - Whether nothing of the job would be left without this image (see `isLastResultOf`),
 *   so the question can say that the job goes too
 * @param className - Extra classes for the button, e.g. to make it readable on top of an image
 */
export function DeleteAssetButton({
  asset,
  isLastResult,
  className
}: Readonly<{
  asset: AssetView
  isLastResult: boolean
  className?: string
}>) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { showJob, showAsset } = useStudioQuery()
  const dialog = useOverlayState()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = useCallback(async () => {
    setIsDeleting(true)
    const result = await deleteAsset({ id: asset.id })
    setIsDeleting(false)

    if (!result.ok) {
      toast.danger(result.message)
      return
    }

    dialog.close()
    if (pathname === "/gallery") {
      // The viewer is open on this image: move it to the next one, or close it with the job gone
      if (searchParams.get("asset") === asset.id) {
        const params = new URLSearchParams(searchParams)
        if (result.nextAssetId) params.set("asset", result.nextAssetId)
        else params.delete("asset")
        const search = params.toString()
        router.replace(search ? `/gallery?${search}` : "/gallery", { scroll: false })
      } else {
        router.refresh()
      }
      return
    }

    if (result.isJobDeleted) await showJob(null)
    else await showAsset(result.nextAssetId)
  }, [asset.id, dialog, pathname, searchParams, router, showJob, showAsset])

  return (
    <>
      <Button
        variant='tertiary'
        size='sm'
        isIconOnly
        aria-label='Delete this image'
        className={className}
        onPress={dialog.open}>
        <Bin size={15} strokeWidth={1.75} />
      </Button>

      <AlertDialog.Backdrop isOpen={dialog.isOpen} onOpenChange={dialog.setOpen}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className='max-w-[400px]'>
            <AlertDialog.Header>
              <AlertDialog.Icon status='danger' />
              <AlertDialog.Heading>Delete this image?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                {isLastResult
                  ? "It is the job's only result, so the job goes with it. "
                  : "Only this image goes, with its cutout if it has one; the job's other results stay. "}
                The file is deleted from disk. This can&apos;t be undone.
              </p>
            </AlertDialog.Body>
            <AlertDialog.Footer>
              <Button slot='close' variant='tertiary'>
                Cancel
              </Button>
              <Button variant='danger' isPending={isDeleting} onPress={handleDelete}>
                Delete
              </Button>
            </AlertDialog.Footer>
          </AlertDialog.Dialog>
        </AlertDialog.Container>
      </AlertDialog.Backdrop>
    </>
  )
}
