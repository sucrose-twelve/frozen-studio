/**
 * Which family a voice model belongs to. The folder's name is all there is to go by: Qwen3-TTS folders
 * say so, VoxCPM folders say so, and everything else the Voice form lists is Japanese Parler-TTS.
 */
export function voiceFamily(model: string): Media.VoiceFamily {
  if (/qwen3.?tts/i.test(model)) return "qwen"
  return /voxcpm/i.test(model) ? "voxcpm" : "parler"
}
