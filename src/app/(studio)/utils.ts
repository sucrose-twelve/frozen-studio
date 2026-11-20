import type {
  CaptionValidator,
  ImageValidator,
  VideoValidator,
  VoiceValidator
} from "@/actions/jobs/validator.zod"
import {
  IMAGE_DEFAULTS,
  IMAGE_FAMILIES,
  IMAGE_FAMILY_LABELS,
  IMAGE_FAMILY_SAMPLING,
  LORA_STRENGTH,
  VIDEO_SAMPLING,
  VOICE_PRESETS
} from "@/constants"

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

export const VIDEO_FORM_DEFAULTS: VideoValidator = {
  kind: "video",
  model: "",
  prompt: "",
  references: [],
  seconds: 5,
  resolution: 480,
  aspect: "16:9",
  isStaticCamera: false,
  isLoop: false,
  isFast: true,
  steps: VIDEO_SAMPLING.full.steps,
  negative: "",
  seed: null,
  shouldSaveFrames: false,
  shouldRemoveBackground: false
}

export const VOICE_FORM_DEFAULTS: VoiceValidator = {
  kind: "voice",
  model: "",
  prompt: "",
  voice: VOICE_PRESETS[0].id,
  description: VOICE_PRESETS[0].description,
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
 * The name of a voice: its preset's label, or "Custom" for a description written by hand.
 */
export function voiceLabel(voice: string) {
  return VOICE_PRESETS.find((preset) => preset.id === voice)?.label ?? "Custom"
}

/**
 * A readable name for a model file, e.g. `qwen-image-2.1-step90000-FP8-comfy.safetensors` becomes
 * "Qwen-Image 2.1 Omni · FP8" and `moss_image_sft_int8_convrot.safetensors` "MOSS-Image · sft_int8_convrot".
 * The `stepNNNNN` marker is how the Omni merge names its builds. A name that follows neither pattern is
 * shown as it is, without the extension.
 */
export function modelLabel(fileName: string) {
  const base = fileName.replace(/\.(safetensors|gguf)$/i, "")
  if (/^moss[-_]image[-_]/i.test(base)) {
    return `${IMAGE_FAMILY_LABELS.moss} · ${base.replace(/^moss[-_]image[-_]/i, "")}`
  }
  if (!/^qwen[-_]image[-_]2\.1/i.test(base)) return base

  const variant = base
    .replace(/^qwen[-_]image[-_]2\.1[-_]?/i, "")
    .replace(/step\d+[-_]?/i, "")
    .replace(/[-_]comfy$/i, "")
  const family = /step\d+/i.test(base) ? "Qwen-Image 2.1 Omni" : "Qwen-Image 2.1"

  return variant ? `${family} · ${variant}` : family
}

/**
 * A readable name for a LoRA file. It is listed under its model, so the model's name in front and the
 * "ComfyUI" some releases end with say nothing: `MOSS-Image-Anime-LoRA-ComfyUI.safetensors` becomes
 * "Anime-LoRA".
 */
export function loraLabel(fileName: string) {
  const base = fileName.replace(/\.(safetensors|gguf)$/i, "")
  const short = base
    .replace(/^(?:moss|qwen)[-_]image[-_](?:2\.1[-_])?/i, "")
    .replace(/[-_]comfyui$/i, "")

  return short || base
}

/**
 * The text field for a seed holds digits or nothing; nothing means "pick one at random".
 */
export function parseSeed(text: string) {
  const digits = text.replace(/\D/g, "")
  return digits ? Math.min(Number(digits), 2 ** 48) : null
}
