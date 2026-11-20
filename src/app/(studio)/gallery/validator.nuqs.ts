import {
  createSearchParamsCache,
  parseAsBoolean,
  parseAsInteger,
  parseAsStringLiteral
} from "nuqs/server"

import { GALLERY_KINDS } from "@/constants"

/**
 * Search param parsers, shared by the server cache below and the client filters (`GalleryFilters`).
 *
 * The gallery always shows one kind; without the param it is the first, images.
 */
export const galleryParsers = {
  page: parseAsInteger.withDefault(1),
  kind: parseAsStringLiteral(GALLERY_KINDS).withDefault(GALLERY_KINDS[0]),
  favorites: parseAsBoolean.withDefault(false)
}

export const queryValidator = createSearchParamsCache(galleryParsers)

export type QueryValidator = Awaited<ReturnType<typeof queryValidator.parse>>
