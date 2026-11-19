import { Compass } from "@keyline-icons/react"
import type { Metadata } from "next"
import NextLink from "next/link"

export const metadata: Metadata = { title: "Not found" }

/**
 * Shown for any address the app doesn't have.
 */
export default function NotFound() {
  return (
    <main className='mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center'>
      <Compass size={40} strokeWidth={1.5} className='text-muted' />
      <h1 className='text-2xl font-semibold tracking-tight'>Nothing at this address</h1>
      <p className='text-muted text-sm'>
        The link may be mistyped, or what it pointed to has been deleted.
      </p>
      <NextLink
        href='/'
        className='bg-accent text-accent-foreground hover:bg-accent-hover inline-flex h-9 items-center rounded-full px-4 text-sm font-medium transition-colors'>
        Back to the studio
      </NextLink>
    </main>
  )
}
