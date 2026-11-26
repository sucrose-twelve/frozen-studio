"use client"

import {
  GalleryThumbnails,
  MessageSquare,
  ScanText,
  Sparkles
} from "@keyline-icons/react"
import NextLink from "next/link"
import { usePathname } from "next/navigation"

import { cls } from "@/libs/utils"

const LINKS = [
  { href: "/", label: "Studio", Icon: Sparkles },
  { href: "/caption", label: "Caption", Icon: ScanText },
  { href: "/chat", label: "Chat", Icon: MessageSquare },
  { href: "/gallery", label: "Gallery", Icon: GalleryThumbnails }
] as const

/**
 * The header's section links, with the current one marked.
 */
export function HeaderNav() {
  const pathname = usePathname()

  return (
    <nav className='flex items-center gap-1'>
      {LINKS.map(({ href, label, Icon }) => {
        // The Chat page has the character editor under it
        const isActive = href === "/chat" ? pathname.startsWith(href) : pathname === href

        return (
          <NextLink
            key={href}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cls(
              "inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-default text-foreground"
                : "text-muted hover:bg-surface hover:text-foreground"
            )}>
            <Icon size={16} strokeWidth={1.75} />
            {label}
          </NextLink>
        )
      })}
    </nav>
  )
}
