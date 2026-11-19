"use client"

import { Button, toast } from "@heroui/react"
import { Download, Star } from "@keyline-icons/react"
import { Star as StarFilled } from "@keyline-icons/react/fill"
import { useCallback, useState } from "react"

import { updateFavorite } from "@/actions/assets/update"
import type { AssetView } from "@/actions/jobs/read"

const ICON = { size: 15, strokeWidth: 1.75 } as const

/**
 * Saves one result to the user's downloads, under the file name the server gives it.
 *
 * @param isLabeled - Spell out "Download" next to the icon; without it the button is icon-only
 */
export function DownloadButton({
  asset,
  isLabeled = true
}: Readonly<{
  asset: AssetView
  isLabeled?: boolean
}>) {
  const handleDownload = useCallback(() => {
    const link = document.createElement("a")
    link.href = `${asset.url}?download`
    link.download = asset.name
    link.click()
  }, [asset.url, asset.name])

  return (
    <Button
      variant={isLabeled ? "secondary" : "tertiary"}
      size='sm'
      isIconOnly={!isLabeled}
      aria-label={isLabeled ? undefined : "Download"}
      onPress={handleDownload}>
      <Download {...ICON} />
      {isLabeled ? "Download" : null}
    </Button>
  )
}

/**
 * The star that keeps a result among the favorites. It flips at once and goes back if the server says no.
 * Give it a `key` when the asset it stands for can change.
 */
export function FavoriteButton({ asset }: Readonly<{ asset: AssetView }>) {
  const [isFavorite, setIsFavorite] = useState(asset.isFavorite)

  const handleFavorite = useCallback(async () => {
    const next = !isFavorite
    setIsFavorite(next)

    const result = await updateFavorite({ id: asset.id, isFavorite: next })
    if (!result.ok) {
      setIsFavorite(!next)
      toast.danger(result.message)
    }
  }, [asset.id, isFavorite])

  return (
    <Button
      variant='tertiary'
      size='sm'
      isIconOnly
      aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={isFavorite}
      onPress={handleFavorite}>
      {isFavorite ? (
        <StarFilled {...ICON} className='text-warning' />
      ) : (
        <Star {...ICON} />
      )}
    </Button>
  )
}
