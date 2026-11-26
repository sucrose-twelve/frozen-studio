import { z } from "zod"

import {
  CHAT_MAX_FIELD_LENGTH,
  CHAT_MAX_MESSAGE_LENGTH,
  CHAT_MAX_SUMMARY_LENGTH,
  CHAT_SAMPLING_LIMITS,
  SPEECH_LANGUAGES
} from "@/constants"

const field = z.string().trim().max(CHAT_MAX_FIELD_LENGTH)

export const idValidator = z.object({ id: z.uuid() })

/**
 * A character card as the editor sends it. `greetings` keeps only the openings that have text, and `tags`
 * comes as one comma-separated line.
 */
export const characterValidator = z.object({
  id: z.uuid().nullable(),
  name: z.string().trim().min(1, { error: "Give the character a name" }).max(100),
  avatarAssetId: z.uuid().nullable(),
  portraitAssetId: z.uuid().nullable(),
  description: field,
  personality: field,
  speakingStyle: field,
  scenario: field,
  greetings: z.array(z.object({ text: field })).max(20),
  exampleDialogues: field,
  systemPrompt: field,
  tags: z.string().trim().max(500)
})

export type CharacterValidator = z.infer<typeof characterValidator>

export const newChatValidator = z.object({
  characterId: z.uuid(),
  model: z.string().min(1, { error: "Install a chat model first" })
})

export const messageValidator = z.object({
  chatId: z.uuid(),
  text: z
    .string()
    .trim()
    .min(1, { error: "Write something first" })
    .max(CHAT_MAX_MESSAGE_LENGTH)
})

export const replyValidator = z.object({
  chatId: z.uuid(),
  // The message to answer: a user message, or the regenerated reply's parent
  parentId: z.uuid()
})

export const editMessageValidator = z.object({
  id: z.uuid(),
  content: z
    .string()
    .trim()
    .min(1, { error: "A message can't be empty" })
    .max(CHAT_MAX_FIELD_LENGTH)
})

export const storyValidator = z.object({
  messageId: z.uuid(),
  text: z
    .string()
    .trim()
    .min(1, { error: "The summary can't be empty" })
    .max(CHAT_MAX_SUMMARY_LENGTH)
})

const limited = (limits: { min: number; max: number }) =>
  z.number().min(limits.min).max(limits.max)

export const chatSettingsValidator = z.object({
  chatId: z.uuid(),
  model: z.string().min(1),
  sampling: z.object({
    temperature: limited(CHAT_SAMPLING_LIMITS.temperature),
    minP: limited(CHAT_SAMPLING_LIMITS.minP),
    repeatPenalty: limited(CHAT_SAMPLING_LIMITS.repeatPenalty),
    dryMultiplier: limited(CHAT_SAMPLING_LIMITS.dryMultiplier),
    maxTokens: limited(CHAT_SAMPLING_LIMITS.maxTokens).int()
  })
})

export const personaValidator = z.object({
  name: z.string().trim().min(1, { error: "Give yourself a name" }).max(100),
  description: field
})

export const voiceValidator = z.object({
  characterId: z.uuid(),
  model: z.string().min(1, { error: "Pick a voice model" }),
  description: z.string().trim().min(1, { error: "Describe the voice" }).max(600),
  language: z.enum(SPEECH_LANGUAGES)
})

export type VoiceValidator = z.infer<typeof voiceValidator>
