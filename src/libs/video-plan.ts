import { VIDEO_AREAS, VIDEO_FPS, VIDEO_SEGMENT_SECONDS } from "@/constants"

import { roundToStep } from "./utils"

/**
 * One Wan pass of a video.
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
 * Wan generates `4k + 1` frames, and fewer than 5 is no motion at all.
 */
function framesFor(seconds: number) {
  return Math.max(5, Math.floor((seconds * VIDEO_FPS) / 4) * 4 + 1)
}

/**
 * Splits a video into Wan passes of at most `VIDEO_SEGMENT_SECONDS`.
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
export function planSegments(seconds: number, keyframes: number, isLoop: boolean) {
  const segments: VideoSegment[] = []

  if (keyframes <= 1) {
    const passes = Math.ceil(seconds / VIDEO_SEGMENT_SECONDS)
    const frames = framesFor(seconds / passes)
    for (let pass = 0; pass < passes; pass++) {
      segments.push({ frames, from: pass === 0 ? 0 : null, end: null })
    }

    return segments
  }

  const gaps = keyframes - 1 + (isLoop ? 1 : 0)
  const gapSeconds = seconds / gaps
  const passes = Math.ceil(gapSeconds / VIDEO_SEGMENT_SECONDS)
  const frames = framesFor(gapSeconds / passes)

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
 * The frame size for a resolution's pixel budget at a given shape, on Wan's 16 px grid.
 *
 * @param aspectRatio - Width divided by height
 */
export function videoSize(resolution: Media.VideoResolution, aspectRatio: number) {
  const area = VIDEO_AREAS[resolution]

  return {
    width: roundToStep(Math.sqrt(area * aspectRatio), 16),
    height: roundToStep(Math.sqrt(area / aspectRatio), 16)
  }
}

/**
 * An aspect like `"16:9"` as a number, width divided by height.
 */
export function aspectRatioOf(aspect: Media.Aspect) {
  const [width, height] = aspect.split(":").map(Number)
  return width! / height!
}
