import { VOICE_FAMILIES, VOICE_PRESETS } from "@/constants"

/**
 * Which family a voice model belongs to. The folder's name is all there is to go by: Qwen3-TTS folders
 * say so, VoxCPM folders say so, and everything else the Voice form lists is Japanese Parler-TTS.
 */
export function voiceFamily(model: string): Media.VoiceFamily {
  if (/qwen3.?tts/i.test(model)) return "qwen"
  return /voxcpm/i.test(model) ? "voxcpm" : "parler"
}

/**
 * The name of a voice: its preset's label, or "Custom" for a description written by hand.
 */
export function voiceLabel(voice: string) {
  const presets = VOICE_FAMILIES.flatMap((family) => VOICE_PRESETS[family])
  return presets.find((preset) => preset.id === voice)?.label ?? "Custom"
}
