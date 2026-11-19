import { createSearchParamsCache, parseAsString, parseAsStringLiteral } from "nuqs/server"

import { JOB_KINDS } from "@/constants"

/**
 * Search param parsers, shared by the server cache below and the client hook (`useStudioQuery`) so both ends
 * read the URL the same way.
 *
 * - `mode`: which form is showing
 * - `job`: the job on the canvas; without it the newest job is shown
 * - `asset`: which of that job's results to open on, for a link from the gallery
 */
export const studioParsers = {
  mode: parseAsStringLiteral(JOB_KINDS).withDefault("image"),
  job: parseAsString,
  asset: parseAsString
}

export const queryValidator = createSearchParamsCache(studioParsers)

export type QueryValidator = Awaited<ReturnType<typeof queryValidator.parse>>
