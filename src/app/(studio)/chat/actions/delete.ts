"use server"

import { and, eq, inArray, notInArray } from "drizzle-orm"

import { ACTIVE_JOB_STATUSES } from "@/constants"
import { db, schema } from "@/drizzle"
import { newestLeaf, siblingsOf } from "@/libs/chat"
import { removeJobFolder } from "@/libs/media"

import { idValidator } from "../validator.zod"
import { readActiveReply } from "./read"

/**
 * Whether any chat of a character has a reply on the way.
 */
async function hasActiveReply(characterId: string) {
  const [active] = await db
    .select({ id: schema.jobs.id })
    .from(schema.chats)
    .innerJoin(schema.chatMessages, eq(schema.chatMessages.chatId, schema.chats.id))
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.chatMessages.jobId))
    .where(
      and(
        eq(schema.chats.characterId, characterId),
        inArray(schema.jobs.status, [...ACTIVE_JOB_STATUSES])
      )
    )
    .limit(1)
  return !!active
}

/**
 * Deletes the jobs that spoke messages or made a voice sample, with their clips: nothing else plays them.
 * One still queued or running is left alone; it fails when it finds its message gone.
 */
async function removeSpeechJobs(jobIds: (string | null)[]) {
  const ids = jobIds.filter((id) => id !== null)
  if (ids.length === 0) return

  const removed = await db
    .delete(schema.jobs)
    .where(
      and(
        inArray(schema.jobs.id, ids),
        eq(schema.jobs.kind, "speech"),
        notInArray(schema.jobs.status, [...ACTIVE_JOB_STATUSES])
      )
    )
    .returning({ id: schema.jobs.id })
  await Promise.all(removed.map((job) => removeJobFolder(job.id)))
}

/**
 * The jobs that spoke the messages of some chats.
 */
async function readSpeechJobIds(chatIds: string[]) {
  if (chatIds.length === 0) return []

  const rows = await db
    .select({ jobId: schema.chatMessages.speechJobId })
    .from(schema.chatMessages)
    .where(inArray(schema.chatMessages.chatId, chatIds))
  return rows.map((row) => row.jobId)
}

/**
 * The job that made a character's voice sample, through the sample's asset.
 */
async function readSampleJobId(sampleAssetId: string | null | undefined) {
  if (!sampleAssetId) return null

  const [sample] = await db
    .select({ jobId: schema.assets.jobId })
    .from(schema.assets)
    .where(eq(schema.assets.id, sampleAssetId))
    .limit(1)
  return sample?.jobId ?? null
}

/**
 * Deletes a character with all its chats and the clips its messages were spoken into. Its avatar and
 * portrait stay as uploads. This can't be undone; the UI asks first.
 */
export async function deleteCharacter(input: unknown) {
  const parsed = idValidator.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: "Invalid character" }

  const { id } = parsed.data
  if (await hasActiveReply(id)) {
    return { ok: false as const, message: "Stop the reply being written first" }
  }

  const [[character], chats] = await Promise.all([
    db
      .select({ voice: schema.characters.voice })
      .from(schema.characters)
      .where(eq(schema.characters.id, id))
      .limit(1),
    db
      .select({ id: schema.chats.id })
      .from(schema.chats)
      .where(eq(schema.chats.characterId, id))
  ])
  const speechJobIds = [
    ...(await readSpeechJobIds(chats.map((chat) => chat.id))),
    await readSampleJobId(character?.voice?.sampleAssetId)
  ]

  await db.delete(schema.characters).where(eq(schema.characters.id, id))
  await removeSpeechJobs(speechJobIds)
  return { ok: true as const }
}

/**
 * Deletes a chat with every message in it, and the clips they were spoken into. This can't be undone; the
 * UI asks first. The jobs that wrote its replies stay in the job list as finished jobs, without a message
 * to point at.
 */
export async function deleteChat(input: unknown) {
  const parsed = idValidator.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: "Invalid chat" }

  if (await readActiveReply(parsed.data.id)) {
    return { ok: false as const, message: "Stop the reply being written first" }
  }

  const speechJobIds = await readSpeechJobIds([parsed.data.id])
  await db.delete(schema.chats).where(eq(schema.chats.id, parsed.data.id))
  await removeSpeechJobs(speechJobIds)
  return { ok: true as const }
}

/**
 * Deletes a message and everything that followed it, with the clips they were spoken into. The chat then
 * shows another take of that turn when there is one, or else ends at the message before.
 */
export async function deleteMessage(input: unknown) {
  const parsed = idValidator.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: "Invalid message" }

  const [message] = await db
    .select({ chatId: schema.chatMessages.chatId })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.id, parsed.data.id))
    .limit(1)
  if (!message) return { ok: true as const }
  if (await readActiveReply(message.chatId)) {
    return { ok: false as const, message: "Stop the reply being written first" }
  }

  const messages = await db
    .select({
      id: schema.chatMessages.id,
      parentId: schema.chatMessages.parentId,
      createdAt: schema.chatMessages.createdAt,
      speechJobId: schema.chatMessages.speechJobId
    })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.chatId, message.chatId))

  const deleted = messages.find((other) => other.id === parsed.data.id)
  if (!deleted) return { ok: true as const }

  // The message and everything under it, which the delete cascades to
  const gone = new Set([deleted.id])
  let isGrowing = true
  while (isGrowing) {
    isGrowing = false
    for (const other of messages) {
      if (other.parentId && gone.has(other.parentId) && !gone.has(other.id)) {
        gone.add(other.id)
        isGrowing = true
      }
    }
  }

  const siblings = siblingsOf(messages, deleted)
  const index = siblings.findIndex((sibling) => sibling.id === deleted.id)
  const sibling = siblings[index - 1] ?? siblings[index + 1]
  const remaining = messages.filter((other) => !gone.has(other.id))
  const head = sibling ? newestLeaf(remaining, sibling.id) : deleted.parentId

  await db.transaction(async (tx) => {
    await tx.delete(schema.chatMessages).where(eq(schema.chatMessages.id, deleted.id))
    await tx
      .update(schema.chats)
      .set({ headMessageId: head })
      .where(eq(schema.chats.id, message.chatId))
  })
  await removeSpeechJobs(
    messages.filter((other) => gone.has(other.id)).map((other) => other.speechJobId)
  )
  return { ok: true as const }
}

/**
 * Forgets how a message was spoken: its clip and the text that was said. Speaking it again makes a new
 * one, from the message as it is now.
 *
 * @param input - `{ id }` of the message
 */
export async function deleteSpeech(input: unknown) {
  const parsed = idValidator.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: "Invalid message" }

  const [message] = await db
    .select({ speechJobId: schema.chatMessages.speechJobId })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.id, parsed.data.id))
    .limit(1)
  if (!message?.speechJobId) return { ok: true as const }

  const [job] = await db
    .select({ status: schema.jobs.status })
    .from(schema.jobs)
    .where(eq(schema.jobs.id, message.speechJobId))
    .limit(1)
  if (job && ACTIVE_JOB_STATUSES.includes(job.status)) {
    return { ok: false as const, message: "Wait until the message has been spoken" }
  }

  await db
    .update(schema.chatMessages)
    .set({ speechJobId: null, speechText: null })
    .where(eq(schema.chatMessages.id, parsed.data.id))
  await removeSpeechJobs([message.speechJobId])
  return { ok: true as const }
}

/**
 * Takes a character's voice away: its messages can't be spoken any more. Clips already made stay with their
 * messages; the sample goes.
 *
 * @param input - `{ id }` of the character
 */
export async function deleteCharacterVoice(input: unknown) {
  const parsed = idValidator.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: "Invalid character" }

  const [character] = await db
    .select({ voice: schema.characters.voice })
    .from(schema.characters)
    .where(eq(schema.characters.id, parsed.data.id))
    .limit(1)
  if (!character?.voice) return { ok: true as const }

  const sampleJobId = await readSampleJobId(character.voice.sampleAssetId)
  await db
    .update(schema.characters)
    .set({ voice: null })
    .where(eq(schema.characters.id, parsed.data.id))
  await removeSpeechJobs([sampleJobId])
  return { ok: true as const }
}
