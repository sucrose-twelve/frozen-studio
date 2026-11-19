"use client"

import { ToggleButton } from "@heroui/react"
import { Star } from "@keyline-icons/react"
import { useQueryStates } from "nuqs"
import { useCallback, useTransition } from "react"

import { OptionGroup, type Option } from "../../components/option-group"
import { galleryParsers } from "../validator.nuqs"

type KindChoice = Media.AssetKind | "all"

const KIND_OPTIONS: Option<KindChoice>[] = [
  { value: "all", label: "All" },
  { value: "image", label: "Images" },
  { value: "video", label: "Videos" }
]

/**
 * The gallery's filters, kept in the URL. A change re-renders the page on the server and goes back to the
 * first page, so a narrower filter never lands past the last one.
 */
export function GalleryFilters() {
  const [, startTransition] = useTransition()
  const [query, setQuery] = useQueryStates(galleryParsers, {
    shallow: false,
    startTransition
  })

  const handleKindChange = useCallback(
    (kind: KindChoice) => setQuery({ kind: kind === "all" ? null : kind, page: null }),
    [setQuery]
  )
  const handleFavoritesChange = useCallback(
    (isSelected: boolean) => setQuery({ favorites: isSelected || null, page: null }),
    [setQuery]
  )

  return (
    <div className='flex items-center gap-3'>
      <div className='w-64'>
        <OptionGroup
          label='Kind'
          value={query.kind ?? "all"}
          options={KIND_OPTIONS}
          onChange={handleKindChange}
        />
      </div>
      <ToggleButton
        size='sm'
        isSelected={query.favorites}
        onChange={handleFavoritesChange}>
        <Star size={15} strokeWidth={1.75} />
        Favorites
      </ToggleButton>
    </div>
  )
}
