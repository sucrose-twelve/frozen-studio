import { ArrowUpRight, Snowflake } from "@keyline-icons/react"
import NextLink from "next/link"

import { APP_NAME } from "@/constants"
import { COMFY } from "@/constants/env"

import { EngineStatus } from "./engine-status"
import { HeaderNav } from "./header-nav"
import { MemoryStatus } from "./memory-status"

/**
 * The bar across the top of every page: brand, the sections, and the engine's status.
 *
 * It is exactly `h-16` with its border inside, since the studio pages fill the rest of the window with
 * `h-[calc(100svh-4rem)]`: a border on top of the height made them a pixel too tall, and the page scrolled.
 */
export function SiteHeader() {
  return (
    <header className='border-separator bg-background/85 sticky top-0 z-40 h-16 border-b backdrop-blur'>
      <div className='max-w-9xl mx-auto flex h-full items-center gap-6 px-5'>
        <NextLink href='/' className='flex items-center gap-3'>
          <span className='bg-accent text-accent-foreground grid size-9 place-items-center rounded-xl'>
            <Snowflake size={20} strokeWidth={1.75} />
          </span>
          <span className='leading-tight'>
            <span className='block text-base font-semibold tracking-tight'>
              {APP_NAME}
            </span>
            <span className='text-muted block text-[10px] font-medium tracking-[0.18em] uppercase'>
              Local AI · Media generator
            </span>
          </span>
        </NextLink>

        <HeaderNav />

        <div className='ml-auto flex items-center gap-3'>
          <MemoryStatus />
          <EngineStatus />
          <a
            href={COMFY.url}
            target='_blank'
            rel='noreferrer'
            className='text-muted hover:text-foreground inline-flex items-center gap-1 text-xs font-medium transition-colors'>
            ComfyUI
            <ArrowUpRight size={14} strokeWidth={1.75} />
          </a>
        </div>
      </div>
    </header>
  )
}
