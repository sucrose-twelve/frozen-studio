import Image from "next/image"

import type { AssetView } from "@/actions/jobs/read"
import { cls } from "@/libs/utils"

/**
 * A character's (or the user's) round picture, or the first letter of the name when there is none.
 *
 * @param size - The side in pixels
 */
export function CharacterAvatar({
  name,
  avatar,
  size,
  className
}: Readonly<{
  name: string
  avatar: AssetView | null
  size: number
  className?: string
}>) {
  return (
    <span
      style={{ width: size, height: size }}
      className={cls(
        "bg-surface-secondary text-muted grid shrink-0 place-items-center overflow-hidden rounded-full text-sm font-semibold",
        className
      )}>
      {avatar ? (
        <Image
          src={avatar.url}
          alt=''
          width={avatar.width}
          height={avatar.height}
          sizes={`${size * 2}px`}
          quality={75}
          className='size-full object-cover'
        />
      ) : (
        name.slice(0, 1).toUpperCase()
      )}
    </span>
  )
}
