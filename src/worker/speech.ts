import fs from "node:fs"
import path from "node:path"

import { eq } from "drizzle-orm"

import {
  CHAT_DEFAULT_PERSONA,
  MEDIA_FOLDER,
  SPEECH_MAX_LINE_LENGTH,
  SPEECH_SAMPLE_TEXT
} from "@/constants"
import { COMFY } from "@/constants/env"
import { db, schema } from "@/drizzle"
import { dialogueOf, fillNames, isJapanese, speechLines } from "@/libs/chat"
import { chatFormat, formatPrompt, translationSystemText } from "@/libs/chat-prompt"
import { assetFilePath, removeJobFolder } from "@/libs/media"
import { publishEvent } from "@/libs/queue"

import { CanceledError } from "./comfy-socket"
import { llama } from "./llama"
import type { RunControl } from "./process"
import { claimGpu } from "./service"
import { speakToFile } from "./voice"

/**
 * The longest a translation can run. Japanese takes about as many tokens as the Thai it comes from, and a
 * reply is at most a few hundred.
 */
const TRANSLATION_MAX_TOKENS = 600

/**
 * Has the chat model put a character's lines into Japanese, at a low temperature: a translation, not a new
 * line. The model is usually still loaded from the reply just written, so this takes a second or two.
 */
async function translate(
  chatModel: string,
  character: { name: string; personality: string; speakingStyle: string },
  dialogue: string,
  control: RunControl,
  report: (label: string) => void
) {
  report("Translating into Japanese")
  await claimGpu(llama)
  await llama.start(chatModel, () => report("Loading the chat model"))

  const format = chatFormat(chatModel)
  const system = translationSystemText(
    character.name,
    [character.personality, character.speakingStyle].filter(Boolean).join("\n\n")
  )
  const turns = [{ role: "user" as const, content: dialogue }]
  const prompt =
    format === "template"
      ? await llama.applyTemplate([{ role: "system", content: system }, ...turns])
      : formatPrompt(format, system, turns)

  const abort = new AbortController()
  control.cancel = async () => abort.abort()
  if (control.isCanceled) throw new CanceledError()

  let text = ""
  try {
    const chunks = llama.complete(
      {
        prompt,
        n_predict: TRANSLATION_MAX_TOKENS,
        temperature: 0.2,
        min_p: 0.05,
        top_p: 1,
        top_k: 0,
        repeat_penalty: 1,
        dry_multiplier: 0,
        stop: format === "chatml" ? ["<|im_end|>"] : ["</s>", "[INST]"],
        cache_prompt: false
      },
      abort.signal
    )
    for await (const chunk of chunks) text += chunk.content
  } catch (error) {
    if (control.isCanceled) throw new CanceledError()
    throw error
  }

  // Quotation marks the model kept anyway would be read out as pauses at best
  return text.replace(/["“”「」]/g, "").trim()
}

/**
 * Deletes the job that made a sample now replaced, with its clip: nothing plays it any more.
 */
async function removeOldSample(sampleAssetId: string | null) {
  if (!sampleAssetId) return

  const [sample] = await db
    .select({ jobId: schema.assets.jobId })
    .from(schema.assets)
    .where(eq(schema.assets.id, sampleAssetId))
    .limit(1)
  if (!sample?.jobId) return

  await db.delete(schema.jobs).where(eq(schema.jobs.id, sample.jobId))
  await removeJobFolder(sample.jobId)
}

/**
 * Runs a speech job: says a chat message aloud in its character's voice, or makes the character's voice
 * sample.
 *
 * A message is cut down to what is said aloud (`dialogueOf`), translated into Japanese when the character
 * speaks it and the text isn't Japanese already, and kept on the message as `speech_text`. It is then spoken
 * by cloning the character's sample, so it keeps one voice. A sample is the fixed sentences of
 * `SPEECH_SAMPLE_TEXT`, with the voice made up from the description, and becomes the character's sample.
 *
 * The chat model and the voice model don't fit on the card together: translating needs the first, speaking
 * the second, and `claimGpu` swaps them.
 *
 * @throws {CanceledError} When the job was canceled
 * @throws {Error} When the character or message is gone, there is nothing to say, or an engine fails
 */
export async function runSpeechJob(
  job: { id: string },
  params: Media.SpeechParams,
  control: RunControl
) {
  const report = (label: string, value = 0, max = 0) =>
    void publishEvent({ type: "progress", id: job.id, label, value, max }).catch(
      () => undefined
    )

  const [[character], [persona]] = await Promise.all([
    db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, params.characterId))
      .limit(1),
    db
      .select({ name: schema.personas.name })
      .from(schema.personas)
      .where(eq(schema.personas.isDefault, true))
      .limit(1)
  ])
  if (!character) throw new Error("The character was deleted")

  let text = SPEECH_SAMPLE_TEXT[params.language]
  if (params.messageId) {
    const [message] = await db
      .select({ content: schema.chatMessages.content })
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.id, params.messageId))
      .limit(1)
    if (!message) throw new Error("The message was deleted")

    const names = { char: character.name, user: (persona ?? CHAT_DEFAULT_PERSONA).name }
    const dialogue = dialogueOf(fillNames(message.content, names))
    if (!dialogue) throw new Error("Nothing in this message is said aloud")

    if (params.language === "ja" && !isJapanese(dialogue)) {
      if (!params.chatModel) throw new Error("There is no chat model to translate with")
      text = await translate(params.chatModel, character, dialogue, control, report)
      if (!text) throw new Error("The chat model wrote no translation")
    } else {
      text = dialogue
    }

    await db
      .update(schema.chatMessages)
      .set({ speechText: text })
      .where(eq(schema.chatMessages.id, params.messageId))
  }

  // A message clones the sample; a sample is made up from the description
  const [sample] =
    params.messageId && character.voice?.sampleAssetId
      ? await db
          .select({ root: schema.assets.root, path: schema.assets.path })
          .from(schema.assets)
          .where(eq(schema.assets.id, character.voice.sampleAssetId))
          .limit(1)
      : []
  const reference = sample ? assetFilePath(sample) : null

  const relativePath = `${MEDIA_FOLDER}/${job.id}/speech.wav`
  const file = path.resolve(COMFY.outputDir, relativePath)
  await speakToFile({
    model: params.model,
    lines: speechLines(text, SPEECH_MAX_LINE_LENGTH),
    description: params.description,
    seed: params.seed,
    reference: reference && fs.existsSync(reference) ? reference : null,
    file,
    control,
    report
  })

  const stats = await fs.promises.stat(file)
  const [asset] = await db
    .insert(schema.assets)
    .values({
      jobId: job.id,
      kind: "audio",
      role: "output",
      root: "output",
      path: relativePath,
      mime: "audio/wav",
      // Sound has no size in pixels
      width: 0,
      height: 0,
      size: stats.size
    })
    .returning({ id: schema.assets.id })

  if (!params.messageId && asset) {
    // Read again: the voice settings may have changed while the sample was made
    const [current] = await db
      .select({ voice: schema.characters.voice })
      .from(schema.characters)
      .where(eq(schema.characters.id, character.id))
      .limit(1)
    if (current?.voice) {
      await db
        .update(schema.characters)
        .set({ voice: { ...current.voice, sampleAssetId: asset.id } })
        .where(eq(schema.characters.id, character.id))
      await removeOldSample(current.voice.sampleAssetId)
    }
  }
}
