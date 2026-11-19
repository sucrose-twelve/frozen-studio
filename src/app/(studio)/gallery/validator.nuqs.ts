import {
  createSearchParamsCache,
  parseAsBoolean,
  parseAsInteger,
  parseAsStringLiteral
} from "nuqs/server"

const ASSET_KINDS = [
  "image",
  "video",
  "audio"
] as const satisfies readonly Media.AssetKind[]

/**
 * Search param parsers, shared by the server cache below and the client filters (`GalleryFilters`).
 */
export const galleryParsers = {
  page: parseAsInteger.withDefault(1),
  kind: parseAsStringLiteral(ASSET_KINDS),
  favorites: parseAsBoolean.withDefault(false)
}

export const queryValidator = createSearchParamsCache(galleryParsers)

export type QueryValidator = Awaited<ReturnType<typeof queryValidator.parse>>
