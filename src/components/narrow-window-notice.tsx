import { Monitor } from "@keyline-icons/react"

/**
 * What a window narrower than 1280px (`xl`) shows instead of the app, which is laid out for a desktop
 * screen only. A rule in `custom.css` hides every other child of `body` at that width, dialogs and toasts
 * included; this one is marked with `data-narrow-notice` so it stays.
 */
export function NarrowWindowNotice() {
  return (
    <div
      data-narrow-notice
      className='hidden min-h-svh place-items-center p-6 text-center max-xl:grid'>
      <div className='flex max-w-sm flex-col items-center gap-3'>
        <Monitor size={40} strokeWidth={1.25} className='text-muted' />
        <h1 className='text-lg font-semibold'>Frozen needs a wider window</h1>
        <p className='text-muted text-sm'>
          It is made for a desktop screen. Make this window at least 1280 px wide, or
          maximize it.
        </p>
      </div>
    </div>
  )
}
