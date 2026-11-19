"use client"

import { Button } from "@heroui/react"
import { CircleAlert, RefreshCw } from "@keyline-icons/react"
import NextLink from "next/link"

/**
 * What can be shown about an error: its message, and the digest that matches the server log when Next.js
 * replaced the message with a generic one (it does in production).
 */
function describe(error: unknown) {
  if (!(error instanceof Error)) return null

  const digest =
    "digest" in error && typeof error.digest === "string" ? error.digest : null
  return digest ? `${error.message}\nDigest: ${digest}` : error.message
}

/**
 * The fallback for an error no route caught. On this app that is nearly always a service that isn't
 * running, so it says which ones to check and offers another try.
 */
export default function RouteError({
  error,
  retry
}: Readonly<{
  error: unknown
  retry: () => void
}>) {
  const detail = describe(error)

  return (
    <main className='mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 p-6 text-center'>
      <CircleAlert size={40} strokeWidth={1.5} className='text-danger' />
      <h1 className='text-2xl font-semibold tracking-tight'>Something went wrong</h1>
      <p className='text-muted text-sm'>
        The page couldn&apos;t be loaded. Check that Postgres and Redis are running, then
        try again.
      </p>

      {detail ? (
        <pre className='bg-field text-muted max-h-48 w-full overflow-auto rounded-lg p-3 text-left text-xs whitespace-pre-wrap'>
          {detail}
        </pre>
      ) : null}

      <div className='flex items-center gap-2'>
        <Button variant='primary' onPress={retry}>
          <RefreshCw size={16} strokeWidth={1.75} />
          Try again
        </Button>
        <NextLink
          href='/'
          className='hover:bg-surface inline-flex h-9 items-center rounded-full px-4 text-sm font-medium transition-colors'>
          Back to the studio
        </NextLink>
      </div>
    </main>
  )
}
