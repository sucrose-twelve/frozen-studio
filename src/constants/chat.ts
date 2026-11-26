/**
 * How a new chat samples its replies. Found by testing Rocinante-X 12B and Qwen3-14B on a Thai card:
 *
 * - min-p 0.05 keeps both in character without drifting off topic
 * - at temperature 0.7, Qwen3 began copying its previous reply from the fifth turn on (the same opening, the
 *   user's words echoed back, the same closing line); 0.85, with the reply rule in the prompt and DRY over
 *   `CHAT_DRY` below, kept every reply new
 * - 450 tokens is a long reply; most ran 150–400
 */
export const CHAT_SAMPLING: Media.ChatSampling = {
  temperature: 0.85,
  minP: 0.05,
  repeatPenalty: 1.05,
  dryMultiplier: 0.8,
  maxTokens: 450
}

/**
 * How far back DRY looks for a repeat, and how long a repeat may run before it is penalized.
 *
 * llama-server looks back 64 tokens by default: less than a paragraph of Thai, so the previous reply was out
 * of sight and the model could copy it whole. 2048 tokens covers the last few replies. Over the whole context
 * it broke Thai spelling and changed names the character had to recall (a manga title came back wrong); a
 * Thai word is several tokens, so runs shorter than 4 stay free.
 */
export const CHAT_DRY = { range: 2_048, allowedLength: 4 }

/**
 * When a chat's older turns are summarized, as shares of the tokens a prompt may use (the context less the
 * longest reply):
 *
 * - `triggerShare`: a prompt past this share has its older turns summarized, before it is full, so the
 *   summary is written while the model still reads them
 * - `keepShare`: of the room the card and the summary leave under the trigger, the share the newest turns
 *   keep word for word; the rest go into the summary. Half leaves the other half for the chat to grow into
 *   before the next summary. (A share of the whole budget would not do: Sucrose's card alone is 4.5k tokens,
 *   so in a small context the turns kept would be past the trigger again, and every reply would summarize.)
 * - `maxTokens` and `temperature`: the summary is short and sticks to what happened
 */
export const CHAT_SUMMARY = {
  triggerShare: 0.8,
  keepShare: 0.5,
  maxTokens: 800,
  temperature: 0.3
}

/**
 * Longest summary the chat panel takes when it is edited by hand.
 */
export const CHAT_MAX_SUMMARY_LENGTH = 8_000

/**
 * The range each sampling setting accepts, used by the validator and the settings fields.
 */
export const CHAT_SAMPLING_LIMITS: Record<
  keyof Media.ChatSampling,
  { min: number; max: number; step: number }
> = {
  temperature: { min: 0, max: 2, step: 0.05 },
  minP: { min: 0, max: 0.5, step: 0.01 },
  repeatPenalty: { min: 1, max: 1.5, step: 0.01 },
  dryMultiplier: { min: 0, max: 2, step: 0.1 },
  maxTokens: { min: 32, max: 2_048, step: 32 }
}

/**
 * Who the user is in a chat when no persona says otherwise: `{{user}}` in a card becomes this name.
 */
export const CHAT_DEFAULT_PERSONA = { name: "Traveler", description: "" }

/**
 * Longest text the forms take. A card's fields can run long (a description, example dialogues); a message
 * is one turn of a conversation.
 */
export const CHAT_MAX_MESSAGE_LENGTH = 4_000
export const CHAT_MAX_FIELD_LENGTH = 12_000

/**
 * How often the worker sends a reply's text so far while it is written. 70 tokens a second arrive as a few
 * words at a time; a tenth of a second keeps the text flowing without an event per token.
 */
export const CHAT_STREAM_INTERVAL_MS = 100

/**
 * How often the worker also saves the text so far, so a reply cut off by a worker restart keeps what was
 * written.
 */
export const CHAT_SAVE_INTERVAL_MS = 1_000

/**
 * The jobs that belong to the Chat page: a reply, and a reply spoken aloud. They show there, as they happen,
 * and not as toasts.
 */
export const CHAT_JOB_KINDS = [
  "chat",
  "speech"
] as const satisfies readonly Media.JobKind[]

export const SPEECH_LANGUAGES = [
  "ja",
  "original"
] as const satisfies readonly Media.SpeechLanguage[]

export const SPEECH_LANGUAGE_LABELS: Record<Media.SpeechLanguage, string> = {
  ja: "Japanese",
  original: "As written"
}

/**
 * What a character's voice sample says, in the language it will speak: a few plain sentences, so the clip
 * has enough voice in it to clone.
 */
export const SPEECH_SAMPLE_TEXT: Record<Media.SpeechLanguage, string> = {
  ja: "こんにちは。今日はいい天気ですね。少しお話ししてもいいですか？",
  original: "สวัสดีค่ะ วันนี้อากาศดีจังเลยนะคะ คุยกันสักหน่อยได้ไหมคะ"
}

/**
 * A spoken message is cut into lines at sentence ends, each at most this long: the voice models were made
 * for a sentence or two at a time.
 */
export const SPEECH_MAX_LINE_LENGTH = 150
