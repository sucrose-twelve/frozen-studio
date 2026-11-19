import { createSearchParamsCache, parseAsString, parseAsStringLiteral } from "nuqs/server"

import { STUDIO_MODES } from "@/constants"

/**
 * Search param parsers, shared by the server cache below and the client hook (`useStudioQuery`) so both ends
 * read the URL the same way.
 *
 * - `mode`: which of the studio's forms is showing. The Caption page reads the other two and ignores it
 * - `job`: the job on the canvas; without it the newest job is shown
 * - `asset`: which of that job's results to open on, for a link from the gallery
 */
export const studioParsers = {
  mode: parseAsStringLiteral(STUDIO_MODES).withDefault("image"),
  job: parseAsString,
  asset: parseAsString
}

export const queryValidator = createSearchParamsCache(studioParsers)

export type QueryValidator = Awaited<ReturnType<typeof queryValidator.parse>>
