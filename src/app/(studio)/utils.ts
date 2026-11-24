import type { AssetView, JobDetail } from "@/actions/jobs/read"
import type {
  CaptionValidator,
  ImageValidator,
  VoiceValidator
} from "@/actions/jobs/validator.zod"
import {
  IMAGE_DEFAULTS,
  IMAGE_FAMILIES,
  IMAGE_FAMILY_SAMPLING,
  IMAGE_SAMPLER_LABELS,
  LORA_STRENGTH,
  VOICE_CUSTOM,
  VOICE_FAMILIES,
  VOICE_PRESETS
} from "@/constants"
import { imageEngine } from "@/libs/image-model"
import { formatElapsed } from "@/libs/utils"

/**
 * The Image form before a model is picked. Its sampling is the default family's; picking a model of
 * another family swaps in that family's.
 */
export const IMAGE_FORM_DEFAULTS: ImageValidator = {
  kind: "image",
  prompt: "",
  negative: "",
  references: [],
  model: "",
  textEncoder: "",
  aspect: "3:4",
  tier: IMAGE_DEFAULTS.tier,
  count: IMAGE_DEFAULTS.count,
  steps: IMAGE_FAMILY_SAMPLING[IMAGE_FAMILIES[0]].steps,
  cfg: IMAGE_FAMILY_SAMPLING[IMAGE_FAMILIES[0]].cfg,
  sampler: null,
  lora: null,
  loraStrength: LORA_STRENGTH.initial,
  seed: null,
  shouldRemoveBackground: false
}

/**
 * The preset a family's form starts on: its first.
 */
export function defaultVoicePreset(family: Media.VoiceFamily) {
  const [preset] = VOICE_PRESETS[family]
  return { voice: preset?.id ?? VOICE_CUSTOM, description: preset?.description ?? "" }
}

/**
 * The Voice form before a model is picked: the first family's first preset. Picking a model of another
 * family swaps in that family's.
 */
export const VOICE_FORM_DEFAULTS: VoiceValidator = {
  kind: "voice",
  model: "",
  prompt: "",
  ...defaultVoicePreset(VOICE_FAMILIES[0]),
  seed: null
}

export const CAPTION_FORM_DEFAULTS: CaptionValidator = {
  kind: "caption",
  model: "",
  prompt: "",
  references: [],
  mode: "prompts",
  style: "prose"
}

/**
 * The text field for a seed holds digits or nothing; nothing means "pick one at random".
 */
export function parseSeed(text: string) {
  const digits = text.replace(/\D/g, "")
  return digits ? Math.min(Number(digits), 2 ** 48) : null
}

/**
 * The facts worth a chip under a result: its size, the settings that shaped it, the seed and the run time.
 */
export function resultFacts(job: JobDetail, asset: AssetView) {
  const facts = [`${asset.width} × ${asset.height}`]
  const params = job.params

  if (params.kind === "image") {
    facts.push(`${params.steps} steps · CFG ${params.cfg}`)
    // Only a sampler that was picked by hand is worth a chip; "Auto" is the usual case
    if (params.sampler) facts.push(IMAGE_SAMPLER_LABELS[params.sampler])
    if (params.lora) facts.push(`LoRA ${params.lora.strength}`)
    if (imageEngine(params.textEncoder) === "sdcpp") facts.push("sd.cpp")
    facts.push(`seed ${params.seed}`)
  }
  if (job.startedAt && job.finishedAt) {
    facts.push(formatElapsed(job.finishedAt - job.startedAt))
  }

  return facts
}
