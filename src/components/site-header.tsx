import { ArrowUpRight, Snowflake } from "@keyline-icons/react"
import NextLink from "next/link"

import { APP_NAME } from "@/constants"
import { COMFY } from "@/constants/env"

import { EngineStatus } from "./engine-status"
import { HeaderNav } from "./header-nav"

/**
 * The bar across the top of every page: brand, the sections, and the engine's status.
 */
export function SiteHeader() {
  return (
    <header className='border-separator bg-background/85 sticky top-0 z-40 border-b backdrop-blur'>
      <div className='max-w-9xl mx-auto flex h-16 items-center gap-6 px-5'>
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
