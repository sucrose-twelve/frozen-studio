"use client"

import { Button, Kbd } from "@heroui/react"

/**
 * The foot of a studio form: a line about what will run, any reason it can't, and the button that queues it.
 *
 * @param blocker - Why the form can't be submitted right now; disables the button
 */
export function SubmitBar({
  summary,
  blocker,
  label,
  icon,
  isPending
}: Readonly<{
  summary: string
  blocker: string | null
  label: string
  icon: React.ReactNode
  isPending: boolean
}>) {
  return (
    <div className='border-separator bg-surface sticky bottom-0 -mx-4 mt-auto flex flex-col gap-2 border-t px-4 pt-3 pb-4'>
      <p className={blocker ? "text-warning text-xs" : "text-muted text-xs"}>
        {blocker ?? summary}
      </p>
      <Button
        type='submit'
        variant='primary'
        size='lg'
        fullWidth
        isPending={isPending}
        isDisabled={!!blocker}>
        {icon}
        {label}
        <Kbd className='bg-night/15 text-night ml-1 hidden sm:inline-flex'>
          <Kbd.Abbr keyValue='ctrl' />
          <Kbd.Content>↵</Kbd.Content>
        </Kbd>
      </Button>
    </div>
  )
}
