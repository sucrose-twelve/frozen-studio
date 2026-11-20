export const JOB_KINDS = [
  "image",
  "video",
  "cutout",
  "voice",
  "caption"
] as const satisfies readonly Media.JobKind[]

/**
 * The kinds on the studio page's mode switch, in its order. Caption is in the header instead.
 */
export const STUDIO_MODES = [
  "image",
  "video",
  "cutout",
  "voice"
] as const satisfies readonly Media.StudioMode[]

export const JOB_KIND_LABELS: Record<Media.JobKind, string> = {
  image: "Image",
  video: "Video",
  cutout: "Cutout",
  voice: "Voice",
  caption: "Caption"
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

export const IMAGE_SAMPLERS = [
  "euler_ancestral",
  "euler",
  "dpmpp_2m",
  "er_sde"
] as const satisfies readonly Media.ImageSampler[]

export const IMAGE_SAMPLER_LABELS: Record<Media.ImageSampler, string> = {
  euler_ancestral: "Euler a",
  euler: "Euler",
  dpmpp_2m: "DPM++ 2M",
  er_sde: "ER SDE"
}

/**
 * The sampler a job runs with when none is picked ("Auto").
 *
 * - A new image uses `er_sde`, which the Qwen-Image 2.1 model card recommends.
 * - An edit uses `euler`: `er_sde` gave burnt, over-sharpened results with reference images on this setup.
 */
export const IMAGE_DEFAULT_SAMPLERS = {
  create: "er_sde",
  edit: "euler"
} as const satisfies Record<string, Media.ImageSampler>

/**
 * How a Turbo build of Qwen-Image 2.1 is sampled. It was distilled to finish in exactly these 8 steps
 * without guidance, so none of it is adjustable:
 *
 * - `sigmas` are the noise levels of the model card (`sample_sigmas`), one more than there are steps. No
 *   scheduler ComfyUI has produces them, so the workflow passes them by hand.
 * - At CFG 1 the negative prompt is never read.
 */
export const IMAGE_TURBO = {
  steps: 8,
  cfg: 1,
  sampler: "euler",
  sigmas: [1.0, 0.978453, 0.95418, 0.926626, 0.89508, 0.845148, 0.704534, 0.414568, 0.0]
} as const satisfies {
  steps: number
  cfg: number
  sampler: Media.ImageSampler
  sigmas: readonly number[]
}

/**
 * In the order the Image form lists their models. The first family that is installed is the default: its
 * first model is what the form starts on, and what draws the first frame of a text-to-video job.
 * MOSS-Image leads because its pictures came out best of the three when the owner compared them.
 */
export const IMAGE_FAMILIES = [
  "moss",
  "qwen",
  "iris"
] as const satisfies readonly Media.ImageFamily[]

export const IMAGE_FAMILY_LABELS: Record<Media.ImageFamily, string> = {
  qwen: "Qwen-Image 2.1",
  moss: "MOSS-Image",
  iris: "Iris"
}

export const IMAGE_DEFAULTS = {
  steps: 35,
  cfg: 5,
  count: 1,
  tier: "standard"
} as const satisfies Partial<Media.ImageParams>

type ImageSampling = {
  steps: number
  cfg: number
  qualities: readonly { id: string; label: string; steps: number }[]
  samplers: { create: Media.ImageSampler; edit: Media.ImageSampler }
  canEdit: boolean
}

/**
 * How each family is sampled when the form is left alone, and what it can do.
 *
 * - Qwen-Image 2.1: the values above, from its model card and from testing.
 * - MOSS-Image: 25 steps at CFG 2.5 with `er_sde`, the settings of ComfyUI's own workflow for it; 50 steps
 *   is what the original pipeline runs. It edits only with a separate edit LoRA and its own text encoding,
 *   which this project doesn't set up, so it draws new images only.
 * - Iris: 30 steps at CFG 3 with `dpmpp_2m`, what the card of its GGUF release measured with (20 steps
 *   came out close to 30, 8 only as a rough preview). It is not distilled, and it has no editing.
 */
export const IMAGE_FAMILY_SAMPLING: Record<Media.ImageFamily, ImageSampling> = {
  qwen: {
    steps: IMAGE_DEFAULTS.steps,
    cfg: IMAGE_DEFAULTS.cfg,
    qualities: IMAGE_QUALITIES,
    samplers: IMAGE_DEFAULT_SAMPLERS,
    canEdit: true
  },
  moss: {
    steps: 25,
    cfg: 2.5,
    qualities: [
      { id: "draft", label: "Draft", steps: 16 },
      { id: "standard", label: "Standard", steps: 25 },
      { id: "fine", label: "Fine", steps: 50 }
    ],
    samplers: { create: "er_sde", edit: "er_sde" },
    canEdit: false
  },
  iris: {
    steps: 30,
    cfg: 3,
    qualities: [
      { id: "draft", label: "Draft", steps: 20 },
      { id: "standard", label: "Standard", steps: 30 },
      { id: "fine", label: "Fine", steps: 50 }
    ],
    samplers: { create: "dpmpp_2m", edit: "dpmpp_2m" },
    canEdit: false
  }
}

/**
 * How strongly a LoRA is applied: the range the form offers, and where it starts. Most LoRA cards suggest
 * 0.7 to 0.9; above 1 the LoRA's look takes over the image.
 */
export const LORA_STRENGTH = { min: 0, max: 2, step: 0.05, initial: 0.8 } as const

export const MAX_REFERENCES = { image: 4, video: 6, cutout: 12, caption: 8 } as const

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
 * The steps that can be asked for on the full schedule. The high-noise model takes the first half and the
 * low-noise model the rest, so there have to be a few for each. Fast mode is not adjustable: its LoRAs were
 * made for exactly 4 steps.
 */
export const VIDEO_STEPS = { min: 4, max: 50 } as const

/**
 * A voice job speaks one clip per line of its script.
 *
 * The model stops at about 30 seconds of audio, which is roughly 160 Japanese characters at a normal pace;
 * a longer line would be cut off mid-sentence.
 */
export const VOICE_MAX_LINES = 20
export const VOICE_MAX_LINE_LENGTH = 160

/**
 * Voices to start from. Japanese Parler-TTS is steered by an English description of the speaker: pitch,
 * pace, tone and how the recording sounds. "JSUT" names a speaker the model was trained on, which keeps
 * the voice steadier from line to line than a description alone.
 *
 * The model only has female voices: a description that asks for a man lowers the pitch a little and
 * nothing more, so there are no male presets.
 */
export const VOICE_PRESETS = [
  {
    id: "jsut",
    label: "JSUT · steady",
    description:
      "JSUT speaks with an expressive and animated tone in an excellent recording, with a very close-sounding proximity that suggests a private and intimate setting, and delivers her words at a moderate pace."
  },
  {
    id: "calm",
    label: "Calm",
    description:
      "A female speaker with a slightly low-pitched voice delivers her words slowly with a calm and gentle tone in a very clear, close-sounding recording."
  },
  {
    id: "bright",
    label: "Bright",
    description:
      "A female speaker with a high-pitched voice delivers her words quickly with a very expressive and cheerful tone in a very clear, close-sounding recording."
  },
  {
    id: "low",
    label: "Low",
    description:
      "A female speaker with a very low-pitched voice delivers her words at a moderate pace with a serious, slightly monotone tone in a very clear, close-sounding recording."
  }
] as const

/**
 * The `voice` of a job whose description was written or edited by hand.
 */
export const VOICE_CUSTOM = "custom"

export const CAPTION_MODES = [
  "prompts",
  "answer"
] as const satisfies readonly Media.CaptionMode[]

export const CAPTION_MODE_LABELS: Record<Media.CaptionMode, string> = {
  prompts: "Prompts",
  answer: "Answer"
}

export const CAPTION_STYLES = [
  "prose",
  "tags"
] as const satisfies readonly Media.CaptionStyle[]

export const CAPTION_STYLE_LABELS: Record<Media.CaptionStyle, string> = {
  prose: "Sentences",
  tags: "Tags"
}

export const CAPTION_MAX_PROMPT_LENGTH = 2_000

/**
 * Reference images are re-encoded in the browser before upload: PNG, at most this many pixels on a side.
 */
export const UPLOAD_MAX_SIDE = 2048
export const UPLOAD_MAX_BYTES = 24 * 1024 * 1024

export const GALLERY_PAGE_SIZE = 36

/**
 * The gallery's filters, the first being what it opens on.
 */
export const GALLERY_KINDS = [
  "image",
  "video",
  "audio",
  "cutout"
] as const satisfies readonly Media.GalleryKind[]

/**
 * How many jobs a recent strip holds: about two rows' worth, the rest is the gallery's.
 */
export const RECENT_JOBS = 12
