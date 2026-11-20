import { VIDEO_FAMILIES } from "@/constants"

/**
 * Which family a video model belongs to. The name is all there is to go by: LTX files say "ltx", and
 * everything else the Video form lists is a pair of Wan 2.2 files.
 *
 * @param model - A job's `params.model`; jobs from before there was a choice have none and ran on Wan
 */
export function videoFamily(model: string | null | undefined): Media.VideoFamily {
  return model && /ltx/i.test(model) ? "ltx" : "wan"
}

/**
 * Every video model that can run, across families, in the order the Video form lists them.
 *
 * @param video - `Engine.Models.video`, or nothing while the engine hasn't reported
 */
export function listVideoModels(video: Engine.Models["video"] | undefined) {
  return VIDEO_FAMILIES.flatMap((family) =>
    family === "wan"
      ? (video?.wan?.models.map((pair) => pair.name) ?? [])
      : (video?.ltx?.models ?? [])
  )
}
