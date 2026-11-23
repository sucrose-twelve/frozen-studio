"use client"

import { ImageSparkles, Mic, Scissors, Star } from "@keyline-icons/react"
import { useQueryStates } from "nuqs"
import { useCallback, useMemo, useTransition } from "react"

import { JOB_KIND_LABELS } from "@/constants"

import { KindSwitch, type KindItem, type KindToggle } from "../../components/kind-switch"
import { galleryParsers } from "../validator.nuqs"

/**
 * The same names and icons as the studio's mode switch: a voice clip is the "audio" kind of asset.
 */
const KIND_ITEMS: KindItem<Media.GalleryKind>[] = [
  { id: "image", label: JOB_KIND_LABELS.image, Icon: ImageSparkles },
  { id: "audio", label: JOB_KIND_LABELS.voice, Icon: Mic }
]

const CUTOUT_ITEM: KindItem<Media.GalleryKind> = {
  id: "cutout",
  label: JOB_KIND_LABELS.cutout,
  Icon: Scissors
}

/**
 * The gallery's filters, kept in the URL and laid out like the studio's mode switch: which kind of result
 * to show, and beside Cutout, as an icon, whether to show favorites only. A change re-renders the page on
 * the server and starts the scrolled list over from its first page.
 */
export function GalleryFilters() {
  const [, startTransition] = useTransition()
  const [query, setQuery] = useQueryStates(galleryParsers, {
    shallow: false,
    startTransition
  })

  const handleKindChange = useCallback(
    (kind: Media.GalleryKind) => setQuery({ kind, page: null }),
    [setQuery]
  )
  const toggles = useMemo<KindToggle[]>(
    () => [
      {
        id: "favorites",
        label: "Favorites only",
        Icon: Star,
        isSelected: query.favorites,
        onChange: (isSelected) => setQuery({ favorites: isSelected || null, page: null })
      }
    ],
    [query.favorites, setQuery]
  )

  return (
    <KindSwitch
      label='Kind'
      className='w-96 max-w-full'
      items={KIND_ITEMS}
      tool={CUTOUT_ITEM}
      toggles={toggles}
      value={query.kind}
      onChange={handleKindChange}
    />
  )
}
