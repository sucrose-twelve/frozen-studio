import { VIDEO_AREAS, VIDEO_FAMILY_SETTINGS } from "@/constants"

import { roundToStep } from "./utils"

/**
 * One pass of a video.
 *
 * - `from`: the keyframe it starts on, or `null` to continue from the previous pass's last frame
 * - `end`: the keyframe it must land on, or `null` to end wherever the motion takes it
 */
export type VideoSegment = {
  frames: number
  from: number | null
  end: number | null
}

/**
 * A pass makes `k × frameStep + 1` frames (Wan `4k + 1`, LTX `8k + 1`), and a single step is the least that
 * is motion at all.
 */
function framesFor(seconds: number, family: Media.VideoFamily) {
  const { fps, frameStep } = VIDEO_FAMILY_SETTINGS[family]
  return Math.max(frameStep + 1, Math.floor((seconds * fps) / frameStep) * frameStep + 1)
}

/**
 * Splits a video into passes of at most the family's `passSeconds` at that resolution.
 *
 * - One keyframe: a chain of image-to-video passes, each starting on the last frame of the one before.
 * - Several: the length is shared equally between the gaps (`isLoop` adds one from the last keyframe back to
 *   the first). A gap longer than one pass is chained too, and its final pass is first-to-last-frame so it
 *   lands exactly on the next keyframe.
 *
 * Pure, so the form can show the plan before the job is queued and the worker builds the same one.
 *
 * @param seconds - Length of the whole video
 * @param keyframes - Number of keyframe images; 0 and 1 both mean a single starting frame
 */
export function planSegments(
  seconds: number,
  keyframes: number,
  isLoop: boolean,
  family: Media.VideoFamily,
  resolution: Media.VideoResolution
) {
  const passSeconds = VIDEO_FAMILY_SETTINGS[family].passSeconds[resolution]
  const segments: VideoSegment[] = []

  if (keyframes <= 1) {
    const passes = Math.ceil(seconds / passSeconds)
    const frames = framesFor(seconds / passes, family)
    for (let pass = 0; pass < passes; pass++) {
      segments.push({ frames, from: pass === 0 ? 0 : null, end: null })
    }

    return segments
  }

  const gaps = keyframes - 1 + (isLoop ? 1 : 0)
  const gapSeconds = seconds / gaps
  const passes = Math.ceil(gapSeconds / passSeconds)
  const frames = framesFor(gapSeconds / passes, family)

  for (let gap = 0; gap < gaps; gap++) {
    for (let pass = 0; pass < passes; pass++) {
      segments.push({
        frames,
        from: pass === 0 ? gap : null,
        end: pass === passes - 1 ? (gap + 1) % keyframes : null
      })
    }
  }

  return segments
}

/**
 * Frames in the joined video: every pass after the first drops its first frame, which repeats the last
 * frame of the pass before.
 */
export function countFrames(segments: VideoSegment[]) {
  return segments.reduce(
    (total, segment, index) => total + segment.frames - (index === 0 ? 0 : 1),
    0
  )
}

/**
 * The frame size for a resolution's pixel budget at a given shape, on the family's grid (Wan 16 px, LTX
 * 32 px).
 *
 * @param aspectRatio - Width divided by height
 */
export function videoSize(
  resolution: Media.VideoResolution,
  aspectRatio: number,
  family: Media.VideoFamily
) {
  const area = VIDEO_AREAS[resolution]
  const { sizeStep } = VIDEO_FAMILY_SETTINGS[family]

  return {
    width: roundToStep(Math.sqrt(area * aspectRatio), sizeStep),
    height: roundToStep(Math.sqrt(area / aspectRatio), sizeStep)
  }
}

/**
 * An aspect like `"16:9"` as a number, width divided by height.
 */
export function aspectRatioOf(aspect: Media.Aspect) {
  const [width, height] = aspect.split(":").map(Number)
  return width! / height!
}
