"use client"

import { AlertDialog, Button, toast, useOverlayState } from "@heroui/react"
import { Bin } from "@keyline-icons/react"
import { useRouter } from "next/navigation"
import { useCallback, useState } from "react"

import { deleteJob } from "@/actions/jobs/delete"

import { useStudioQuery } from "../hooks/use-studio-query"

/**
 * Deletes a job after asking, since its files go with it. The canvas then falls back to the newest job
 * that is left.
 *
 * @param isLabeled - Spell out "Delete" next to the icon, for the states where the button stands alone
 */
export function DeleteJobButton({
  jobId,
  isLabeled = false
}: Readonly<{
  jobId: string
  isLabeled?: boolean
}>) {
  const router = useRouter()
  const { showJob } = useStudioQuery()
  const dialog = useOverlayState()
  const [isDeleting, setIsDeleting] = useState(false)

  const handleDelete = useCallback(async () => {
    setIsDeleting(true)
    const result = await deleteJob({ id: jobId })
    setIsDeleting(false)

    if (!result.ok) {
      toast.danger(result.message)
      return
    }

    dialog.close()
    await showJob(null)
    router.refresh()
  }, [jobId, dialog, showJob, router])

  return (
    <>
      <Button
        variant='tertiary'
        size='sm'
        isIconOnly={!isLabeled}
        aria-label='Delete this job'
        onPress={dialog.open}>
        <Bin size={15} strokeWidth={1.75} />
        {isLabeled ? "Delete" : null}
      </Button>

      <AlertDialog.Backdrop isOpen={dialog.isOpen} onOpenChange={dialog.setOpen}>
        <AlertDialog.Container>
          <AlertDialog.Dialog className='sm:max-w-[400px]'>
            <AlertDialog.Header>
              <AlertDialog.Icon status='danger' />
              <AlertDialog.Heading>Delete this job?</AlertDialog.Heading>
            </AlertDialog.Header>
            <AlertDialog.Body>
              <p>
                The job and every file it produced are deleted from disk. This can&apos;t
                be undone. Reference images you uploaded are kept.
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
