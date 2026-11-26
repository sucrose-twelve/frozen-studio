import { VOICE_PRESETS } from "@/constants"

/**
 * Which family a voice model belongs to. The folder's name is all there is to go by: Qwen3-TTS folders
 * say so, and everything else is read as VoxCPM (whose files `findVoiceModels` then checks for).
 */
export function voiceFamily(model: string): Media.VoiceFamily {
  return /qwen3.?tts/i.test(model) ? "qwen" : "voxcpm"
}

/**
 * The name of a voice: its preset's label, or "Custom" for a description written by hand.
 */
export function voiceLabel(voice: string) {
  return VOICE_PRESETS.find((preset) => preset.id === voice)?.label ?? "Custom"
}
