export const JOB_KINDS = [
  "image",
  "video",
  "cutout"
] as const satisfies readonly Media.JobKind[]

export const JOB_KIND_LABELS: Record<Media.JobKind, string> = {
  image: "Image",
  video: "Video",
  cutout: "Cutout"
}

export const JOB_STATUSES = [
  "queued",
  "running",
  "succeeded",
  "failed",
  "canceled"
] as const satisfies readonly Media.JobStatus[]

export const JOB_STATUS_LABELS: Record<Media.JobStatus, string> = {
  queued: "Queued",
  running: "Running",
  succeeded: "Done",
  failed: "Failed",
  canceled: "Canceled"
}

/**
 * Jobs the worker still has to finish.
 */
export const ACTIVE_JOB_STATUSES: readonly Media.JobStatus[] = ["queued", "running"]

export const ASPECTS = [
  "1:1",
  "3:4",
  "2:3",
  "9:16",
  "4:3",
  "3:2",
  "16:9"
] as const satisfies readonly Media.Aspect[]

export const IMAGE_TIERS = [
  "standard",
  "large",
  "extra"
] as const satisfies readonly Media.ImageTier[]

export const IMAGE_TIER_LABELS: Record<Media.ImageTier, string> = {
  standard: "Standard",
  large: "Large",
  extra: "Extra"
}

/**
 * Output size per aspect and tier, as `[width, height]`. Every side is a multiple of 32, the grid
 * Qwen-Image 2.1 works on. Standard is about 1 megapixel, the size the model is most reliable at.
 */
export const IMAGE_SIZES: Record<
  Media.Aspect,
  Record<Media.ImageTier, readonly [number, number]>
> = {
  "1:1": { standard: [1024, 1024], large: [1344, 1344], extra: [1408, 1408] },
  "3:4": { standard: [864, 1152], large: [1120, 1472], extra: [1216, 1600] },
  "2:3": { standard: [832, 1248], large: [1056, 1568], extra: [1120, 1696] },
  "9:16": { standard: [736, 1280], large: [928, 1664], extra: [1024, 1792] },
  "4:3": { standard: [1152, 864], large: [1472, 1120], extra: [1600, 1216] },
  "3:2": { standard: [1248, 832], large: [1568, 1056], extra: [1696, 1120] },
  "16:9": { standard: [1280, 736], large: [1664, 928], extra: [1792, 1024] }
}

export const IMAGE_COUNTS = [1, 2, 4] as const

/**
 * Sampling steps behind the Quality control. 35 is what the Qwen-Image 2.1 model card recommends.
 */
export const IMAGE_QUALITIES = [
  { id: "draft", label: "Draft", steps: 20 },
  { id: "standard", label: "Standard", steps: 35 },
  { id: "fine", label: "Fine", steps: 50 }
] as const

export const IMAGE_DEFAULTS = {
  steps: 35,
  cfg: 5,
  count: 1,
  tier: "standard"
} as const satisfies Partial<Media.ImageParams>

export const MAX_REFERENCES = { image: 4, video: 6, cutout: 12 } as const

export const VIDEO_SECONDS = [1, 2, 3, 5, 10, 15, 20] as const

export const VIDEO_RESOLUTIONS = [
  480, 720
] as const satisfies readonly Media.VideoResolution[]

/**
 * Pixel budget per resolution: the width and height are solved from it and the aspect ratio.
 */
export const VIDEO_AREAS: Record<Media.VideoResolution, number> = {
  480: 832 * 480,
  720: 1280 * 720
}

export const VIDEO_FPS = 16

/**
 * Wan 2.2 holds together for about 5 seconds (81 frames) per pass; longer videos are chained from passes of
 * at most this length.
 */
export const VIDEO_SEGMENT_SECONDS = 5

/**
 * Sampling settings for Wan 2.2: the 4-step Lightning LoRAs when `isFast`, the stock schedule otherwise.
 */
export const VIDEO_SAMPLING = {
  fast: { steps: 4, cfg: 1 },
  full: { steps: 20, cfg: 3.5 }
} as const

/**
 * Reference images are re-encoded in the browser before upload: PNG, at most this many pixels on a side.
 */
export const UPLOAD_MAX_SIDE = 2048
export const UPLOAD_MAX_BYTES = 24 * 1024 * 1024

export const GALLERY_PAGE_SIZE = 36
export const RECENT_JOBS = 18
