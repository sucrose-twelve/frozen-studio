export const JOB_KINDS = [
  "image",
  "cutout",
  "voice",
  "caption"
] as const satisfies readonly Media.JobKind[]

/**
 * The kinds on the studio page's mode switch, in its order. Caption is in the header instead.
 */
export const STUDIO_MODES = [
  "image",
  "cutout",
  "voice"
] as const satisfies readonly Media.StudioMode[]

export const JOB_KIND_LABELS: Record<Media.JobKind, string> = {
  image: "Image",
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
 * first model is what the form starts on.
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
  /**
   * How the family takes reference images: by itself, with its edit LoRA installed, or not at all.
   */
  editing: "built-in" | "lora" | "none"
  /**
   * The steps and guidance an edit starts from, when they differ from a new image's.
   */
  edit?: { steps: number; cfg: number }
}

/**
 * How each family is sampled when the form is left alone, and what it can do.
 *
 * - Qwen-Image 2.1: the values above, from its model card and from testing.
 * - MOSS-Image: 25 steps at CFG 2.5 with `er_sde`, the settings of ComfyUI's own workflow for it; 50 steps
 *   is what the original pipeline runs. It edits with a separate edit LoRA, whose author's settings are
 *   30 steps at CFG 4 with `euler`. That guidance is part of how the LoRA works: lower, and things that
 *   were not asked for start to appear in the picture.
 * - Iris: 30 steps at CFG 3 with `dpmpp_2m`, what the card of its GGUF release measured with (20 steps
 *   came out close to 30, 8 only as a rough preview). It is not distilled, and it has no editing.
 */
export const IMAGE_FAMILY_SAMPLING: Record<Media.ImageFamily, ImageSampling> = {
  qwen: {
    steps: IMAGE_DEFAULTS.steps,
    cfg: IMAGE_DEFAULTS.cfg,
    qualities: IMAGE_QUALITIES,
    samplers: IMAGE_DEFAULT_SAMPLERS,
    editing: "built-in"
  },
  moss: {
    steps: 25,
    cfg: 2.5,
    qualities: [
      { id: "draft", label: "Draft", steps: 16 },
      { id: "standard", label: "Standard", steps: 25 },
      { id: "fine", label: "Fine", steps: 50 }
    ],
    samplers: { create: "er_sde", edit: "euler" },
    editing: "lora",
    edit: { steps: 30, cfg: 4 }
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
    editing: "none"
  }
}

/**
 * What a MOSS-Image edit is told to keep out when the negative prompt is left empty. At the guidance an
 * edit runs with, the negative side is always read, so it must say something. This is the line the edit
 * LoRA's author ships, without its first word ("nsfw"): what subject matter to keep out is the user's to
 * write.
 */
export const MOSS_EDIT_NEGATIVE = "worst quality, bad anatomy, watermark, jpeg artifact"

/**
 * How strongly a LoRA is applied: the range the form offers, and where it starts. Most LoRA cards suggest
 * 0.7 to 0.9; above 1 the LoRA's look takes over the image.
 */
export const LORA_STRENGTH = { min: 0, max: 2, step: 0.05, initial: 0.8 } as const

export const MAX_REFERENCES = { image: 4, cutout: 12, caption: 8 } as const

/**
 * A voice job speaks one clip per line of its script.
 *
 * The model stops at about 30 seconds of audio, which is roughly 160 Japanese characters at a normal pace;
 * a longer line would be cut off mid-sentence.
 */
export const VOICE_MAX_LINES = 20
export const VOICE_MAX_LINE_LENGTH = 160

/**
 * The first is the default: its presets are what the Voice form shows before a model is picked, and its
 * model is the one `TTS_MODEL_DIR` names unless set otherwise. The model folders themselves are listed
 * by the worker.
 */
export const VOICE_FAMILIES = [
  "voxcpm",
  "qwen",
  "parler"
] as const satisfies readonly Media.VoiceFamily[]

type VoicePreset = { id: string; label: string; description: string }

/**
 * Voices to start from with Japanese Parler-TTS. Its description is read by a small text encoder that
 * only knows the words of its training captions: pitch, pace, tone and how the recording sounds. "JSUT"
 * names the speaker the model was trained on, which keeps the voice steadier from line to line.
 *
 * The model has that one female voice. Measured on one sentence, the whole range a description reaches
 * is about 246 Hz ("JSUT") to 300 Hz ("high-pitched"), and words outside that vocabulary ("a high school
 * girl", "youthful") change nothing, so there are no presets for other speakers.
 */
const PARLER_PRESETS: readonly VoicePreset[] = [
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
]

/**
 * Voices to start from with the models that make a voice up from a free description (Qwen3-TTS
 * VoiceDesign, VoxCPM2): who is speaking, in plain words. Their ids are their own, apart from the Parler
 * presets', so a job's `voice` names one preset whichever family it was made with.
 */
const DESIGN_PRESETS: readonly VoicePreset[] = [
  {
    id: "girl",
    label: "Girl · bright",
    description:
      "A high school girl with a bright, clear and fairly high-pitched voice. She speaks cheerfully, at a natural pace."
  },
  {
    id: "woman",
    label: "Woman · calm",
    description:
      "A woman in her thirties with a calm, warm, mid-pitched voice. She speaks gently and a little slowly."
  },
  {
    id: "boy",
    label: "Boy · lively",
    description:
      "A teenage boy with a light, energetic voice. He speaks quickly and with enthusiasm."
  },
  {
    id: "man",
    label: "Man · deep",
    description:
      "A man in his forties with a deep, steady voice. He speaks calmly and with authority."
  }
]

export const VOICE_PRESETS: Record<Media.VoiceFamily, readonly VoicePreset[]> = {
  parler: PARLER_PRESETS,
  qwen: DESIGN_PRESETS,
  voxcpm: DESIGN_PRESETS
}

/**
 * What the Voice form says about a family: which languages its script can be in, what to write as a
 * description, and what the description can and can't do.
 */
export const VOICE_FAMILY_NOTES: Record<
  Media.VoiceFamily,
  { languages: string; placeholder: string; hint: string }
> = {
  parler: {
    languages: "Japanese",
    placeholder:
      "In English: how high or low the voice is, how fast, in what tone, and how the recording sounds.",
    hint: "This model has one female voice, and reads only a few things from the description: pitch (very low-pitched to very high-pitched), pace (slowly to quickly), tone (monotone to expressive) and the recording. Other words, like an age, change nothing."
  },
  qwen: {
    languages: "Japanese",
    placeholder:
      "Who is speaking, in plain words: age, gender, how high or low the voice is, the mood, the pace.",
    hint: "The voice is made up from the description, so it can be anyone: a girl, an old man, a narrator. Every line is made up afresh, so the lines of one job can differ a little."
  },
  voxcpm: {
    languages: "Japanese, Thai and 28 more",
    placeholder:
      "Who is speaking, in plain words: age, gender, how high or low the voice is, the mood, the pace.",
    hint: "The voice is made up from the description, so it can be anyone. The first line sets the voice and the other lines copy it. The model works out the script's language by itself."
  }
}

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
  "audio",
  "cutout"
] as const satisfies readonly Media.GalleryKind[]

/**
 * How many jobs a recent strip holds: about two rows' worth, the rest is the gallery's.
 */
export const RECENT_JOBS = 12
