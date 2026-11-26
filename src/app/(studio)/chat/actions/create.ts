"use server"

import { randomUUID } from "node:crypto"

import { and, eq, inArray, sql } from "drizzle-orm"
import { z } from "zod"

import { ACTIVE_JOB_STATUSES, CHAT_SAMPLING } from "@/constants"
import { db, schema } from "@/drizzle"
import { jobDetails, randomSeed } from "@/libs/job"
import { enqueueJobs, readEngineStatus } from "@/libs/queue"

import { characterValues } from "../utils"
import {
  characterValidator,
  idValidator,
  messageValidator,
  newChatValidator,
  replyValidator,
  voiceValidator
} from "../validator.zod"
import { deleteSpeech } from "./delete"
import { readActiveReply } from "./read"

type Chat = typeof schema.chats.$inferSelect

/**
 * Whether a chat's model can run: the worker reports it installed. Without the worker there is no knowing,
 * and the job waits in the queue like any other.
 */
async function checkModel(model: string) {
  const engine = await readEngineStatus()
  if (engine && !engine.models.chat?.models.includes(model)) {
    return `The chat model ${model} isn't installed. Pick another one in the chat's settings.`
  }
  return null
}

/**
 * Saves an empty reply under `parentId`, the chat job that writes it, and points the chat's head at it, then
 * puts the job at the front of the queue: someone is waiting for it.
 */
async function queueReply(chat: Chat, parentId: string) {
  const messageId = randomUUID()
  const params: Media.ChatParams = {
    kind: "chat",
    model: chat.settings.model,
    chatId: chat.id,
    messageId,
    sampling: chat.settings.sampling
  }

  const jobId = await db.transaction(async (tx) => {
    const [job] = await tx
      .insert(schema.jobs)
      .values({ kind: "chat", prompt: "", params })
      .returning({ id: schema.jobs.id })
    if (!job) throw new Error("The reply couldn't be queued")

    await tx.insert(schema.chatMessages).values({
      id: messageId,
      chatId: chat.id,
      parentId,
      role: "assistant",
      jobId: job.id
    })
    await tx
      .update(schema.chats)
      .set({ headMessageId: messageId, lastMessageAt: new Date() })
      .where(eq(schema.chats.id, chat.id))
    return job.id
  })

  await enqueueJobs([{ id: jobId, kind: "chat", details: jobDetails("", params) }], {
    isUrgent: true
  })
  return jobId
}

/**
 * Reads a chat a message is for, and refuses when the chat is gone or already has a reply on the way: one
 * reply at a time, so the next one is written knowing the last.
 */
async function readChatFor(chatId: string) {
  const [chat] = await db
    .select()
    .from(schema.chats)
    .where(eq(schema.chats.id, chatId))
    .limit(1)
  if (!chat) return { ok: false as const, message: "This chat was deleted" }
  if (await readActiveReply(chat.id)) {
    return { ok: false as const, message: "Wait for the reply, or stop it, first" }
  }

  const problem = await checkModel(chat.settings.model)
  if (problem) return { ok: false as const, message: problem }

  return { ok: true as const, chat }
}

/**
 * Creates a character from the editor.
 *
 * @returns The new character's id
 */
export async function createCharacter(input: unknown) {
  const parsed = characterValidator.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false as const,
      message: "Check the character's fields",
      errors: z.flattenError(parsed.error).fieldErrors
    }
  }

  const [character] = await db
    .insert(schema.characters)
    .values(characterValues(parsed.data))
    .returning({ id: schema.characters.id })
  if (!character)
    return { ok: false as const, message: "The character couldn't be saved" }

  return { ok: true as const, id: character.id }
}

/**
 * Starts a chat with a character, on the model the page has picked and the default sampling. Each of the
 * character's greetings becomes an opening message, the first one on screen and the rest a swipe away.
 *
 * @returns The new chat's id
 */
export async function createChat(input: unknown) {
  const parsed = newChatValidator.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, message: z.prettifyError(parsed.error) }
  }

  const { characterId, model } = parsed.data
  const [character] = await db
    .select({ greetings: schema.characters.greetings })
    .from(schema.characters)
    .where(eq(schema.characters.id, characterId))
    .limit(1)
  if (!character) return { ok: false as const, message: "This character was deleted" }

  const chatId = await db.transaction(async (tx) => {
    const [chat] = await tx
      .insert(schema.chats)
      .values({ characterId, settings: { model, sampling: CHAT_SAMPLING } })
      .returning({ id: schema.chats.id })
    if (!chat) throw new Error("The chat couldn't be created")

    // One millisecond apart, so the swipes keep the card's order
    const start = Date.now()
    const greetings = await tx
      .insert(schema.chatMessages)
      .values(
        character.greetings.map((content, index) => ({
          chatId: chat.id,
          role: "assistant" as const,
          content,
          createdAt: new Date(start + index)
        }))
      )
      .returning({ id: schema.chatMessages.id })

    const first = greetings[0]
    if (first) {
      await tx
        .update(schema.chats)
        .set({ headMessageId: first.id })
        .where(eq(schema.chats.id, chat.id))
    }
    return chat.id
  })

  return { ok: true as const, id: chatId }
}

/**
 * Sends the user's message and queues the character's reply to it.
 *
 * @returns The reply's job id
 */
export async function sendMessage(input: unknown) {
  const parsed = messageValidator.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, message: z.prettifyError(parsed.error) }
  }

  const found = await readChatFor(parsed.data.chatId)
  if (!found.ok) return found
  const { chat } = found

  const [message] = await db
    .insert(schema.chatMessages)
    .values({
      chatId: chat.id,
      parentId: chat.headMessageId,
      role: "user",
      content: parsed.data.text
    })
    .returning({ id: schema.chatMessages.id })
  if (!message) return { ok: false as const, message: "The message couldn't be saved" }

  return { ok: true as const, jobId: await queueReply(chat, message.id) }
}

/**
 * Queues a reply to a message that is already there: another take on a reply (a new swipe beside it), or
 * an answer to a user message left without one.
 *
 * @returns The reply's job id
 */
export async function requestReply(input: unknown) {
  const parsed = replyValidator.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: "Invalid message" }

  const found = await readChatFor(parsed.data.chatId)
  if (!found.ok) return found

  const [parent] = await db
    .select({ id: schema.chatMessages.id })
    .from(schema.chatMessages)
    .where(
      and(
        eq(schema.chatMessages.id, parsed.data.parentId),
        eq(schema.chatMessages.chatId, found.chat.id)
      )
    )
    .limit(1)
  if (!parent) return { ok: false as const, message: "That message was deleted" }

  return { ok: true as const, jobId: await queueReply(found.chat, parent.id) }
}

/**
 * Whether a voice model can run, as the worker reports it.
 */
async function checkVoiceModel(model: string) {
  const engine = await readEngineStatus()
  if (engine && !engine.models.voice?.models.includes(model)) {
    return `The voice model ${model} isn't installed. Pick another one in the character's voice.`
  }
  return null
}

/**
 * Saves a job that speaks, and puts it at the front of the queue.
 */
async function queueSpeech(params: Media.SpeechParams) {
  const [job] = await db
    .insert(schema.jobs)
    .values({ kind: "speech", prompt: "", params })
    .returning({ id: schema.jobs.id })
  if (!job) throw new Error("The speech couldn't be queued")

  return job.id
}

/**
 * Says a message aloud in its character's voice. A message spoken before is spoken again, from what it says
 * now: its old clip goes.
 *
 * @param input - `{ id }` of the message
 * @returns The speech job's id
 */
export async function speakMessage(input: unknown) {
  const parsed = idValidator.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: "Invalid message" }

  const [row] = await db
    .select({
      speechJobId: schema.chatMessages.speechJobId,
      settings: schema.chats.settings,
      characterId: schema.characters.id,
      name: schema.characters.name,
      voice: schema.characters.voice
    })
    .from(schema.chatMessages)
    .innerJoin(schema.chats, eq(schema.chats.id, schema.chatMessages.chatId))
    .innerJoin(schema.characters, eq(schema.characters.id, schema.chats.characterId))
    .where(eq(schema.chatMessages.id, parsed.data.id))
    .limit(1)
  if (!row) return { ok: false as const, message: "That message was deleted" }
  if (!row.voice) {
    return {
      ok: false as const,
      message: `Give ${row.name} a voice first, in the editor`
    }
  }

  const problem = await checkVoiceModel(row.voice.model)
  if (problem) return { ok: false as const, message: problem }

  if (row.speechJobId) {
    const removed = await deleteSpeech({ id: parsed.data.id })
    if (!removed.ok) return removed
  }

  const params: Media.SpeechParams = {
    kind: "speech",
    model: row.voice.model,
    characterId: row.characterId,
    messageId: parsed.data.id,
    description: row.voice.description,
    language: row.voice.language,
    seed: row.voice.seed,
    chatModel: row.settings.model
  }
  const jobId = await queueSpeech(params)
  await db
    .update(schema.chatMessages)
    .set({ speechJobId: jobId, speechText: null })
    .where(eq(schema.chatMessages.id, parsed.data.id))
  await enqueueJobs([{ id: jobId, kind: "speech", details: jobDetails("", params) }], {
    isUrgent: true
  })

  return { ok: true as const, jobId }
}

/**
 * Gives a character a voice: saves the voice settings and makes a sample clip from the description, which
 * every message after it clones. Each sample is a new voice (a new seed); it replaces the last one when it is
 * done.
 *
 * @returns The sample's job id
 */
export async function createVoiceSample(input: unknown) {
  const parsed = voiceValidator.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, message: z.prettifyError(parsed.error) }
  }

  const { characterId, ...settings } = parsed.data
  const problem = await checkVoiceModel(settings.model)
  if (problem) return { ok: false as const, message: problem }

  const [character] = await db
    .select({ voice: schema.characters.voice })
    .from(schema.characters)
    .where(eq(schema.characters.id, characterId))
    .limit(1)
  if (!character) return { ok: false as const, message: "This character was deleted" }

  const [pending] = await db
    .select({ id: schema.jobs.id })
    .from(schema.jobs)
    .where(
      and(
        eq(schema.jobs.kind, "speech"),
        inArray(schema.jobs.status, [...ACTIVE_JOB_STATUSES]),
        sql`${schema.jobs.params}->>'characterId' = ${characterId}`,
        sql`${schema.jobs.params}->>'messageId' is null`
      )
    )
    .limit(1)
  if (pending) return { ok: false as const, message: "A sample is already being made" }

  const seed = randomSeed()
  await db
    .update(schema.characters)
    .set({
      voice: { ...settings, seed, sampleAssetId: character.voice?.sampleAssetId ?? null }
    })
    .where(eq(schema.characters.id, characterId))

  const params: Media.SpeechParams = {
    kind: "speech",
    characterId,
    messageId: null,
    ...settings,
    seed,
    chatModel: null
  }
  const jobId = await queueSpeech(params)
  await enqueueJobs([{ id: jobId, kind: "speech", details: jobDetails("", params) }], {
    isUrgent: true
  })

  return { ok: true as const, jobId }
}
