import {
  createSearchParamsCache,
  parseAsBoolean,
  parseAsInteger,
  parseAsString,
  parseAsStringLiteral
} from "nuqs/server"

import { GALLERY_KINDS } from "@/constants"

/**
 * Search param parsers, shared by the server cache below and the client filters (`GalleryFilters`).
 *
 * The gallery always shows one kind; without the param it is the first, images. `page` is how many pages
 * the scrolled list has loaded, so a reload comes back to the same length. `asset` is the result open in
 * the viewer, if any.
 */
export const galleryParsers = {
  page: parseAsInteger.withDefault(1),
  kind: parseAsStringLiteral(GALLERY_KINDS).withDefault(GALLERY_KINDS[0]),
  favorites: parseAsBoolean.withDefault(false),
  asset: parseAsString
}

export const queryValidator = createSearchParamsCache(galleryParsers)

export type QueryValidator = Awaited<ReturnType<typeof queryValidator.parse>>
