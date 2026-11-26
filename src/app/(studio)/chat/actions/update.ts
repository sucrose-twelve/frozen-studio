"use server"

import { and, eq, inArray, isNotNull, ne } from "drizzle-orm"
import { z } from "zod"

import { db, schema } from "@/drizzle"
import { newestLeaf, subtreeIds } from "@/libs/chat"

import { characterValues } from "../utils"
import {
  characterValidator,
  chatSettingsValidator,
  editMessageValidator,
  idValidator,
  personaValidator,
  storyValidator
} from "../validator.zod"
import { deleteSpeech } from "./delete"
import { readActiveReply } from "./read"

/**
 * Saves the editor's changes to a character. Chats already started read the new card from their next reply.
 */
export async function updateCharacter(input: unknown) {
  const parsed = characterValidator.safeParse(input)
  if (!parsed.success || !parsed.data.id) {
    return {
      ok: false as const,
      message: "Check the character's fields",
      errors: parsed.success ? {} : z.flattenError(parsed.error).fieldErrors
    }
  }

  const [character] = await db
    .update(schema.characters)
    .set(characterValues(parsed.data))
    .where(eq(schema.characters.id, parsed.data.id))
    .returning({ id: schema.characters.id })
  if (!character) return { ok: false as const, message: "This character was deleted" }

  return { ok: true as const, id: character.id }
}

/**
 * Rewrites a message, the user's or the character's. What followed it stays; the next reply reads the new
 * text. A clip of the old text goes.
 */
export async function editMessage(input: unknown) {
  const parsed = editMessageValidator.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, message: z.prettifyError(parsed.error) }
  }

  const [message] = await db
    .select({ chatId: schema.chatMessages.chatId, jobId: schema.chatMessages.jobId })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.id, parsed.data.id))
    .limit(1)
  if (!message) return { ok: false as const, message: "That message was deleted" }

  const activeJobId = await readActiveReply(message.chatId)
  if (activeJobId && activeJobId === message.jobId) {
    return { ok: false as const, message: "Stop the reply before editing it" }
  }

  await db
    .update(schema.chatMessages)
    .set({ content: parsed.data.content })
    .where(eq(schema.chatMessages.id, parsed.data.id))
  // What was spoken no longer matches
  await deleteSpeech({ id: parsed.data.id })
  await clearSummariesFrom(message.chatId, parsed.data.id)
  return { ok: true as const }
}

/**
 * Drops the summaries that took in a message that changed: its own and those of every message under it.
 * The next reply summarizes again from the messages as they are now.
 */
async function clearSummariesFrom(chatId: string, messageId: string) {
  const messages = await db
    .select({
      id: schema.chatMessages.id,
      parentId: schema.chatMessages.parentId,
      createdAt: schema.chatMessages.createdAt
    })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.chatId, chatId))

  await db
    .update(schema.chatMessages)
    .set({ summary: null })
    .where(
      and(
        inArray(schema.chatMessages.id, subtreeIds(messages, messageId)),
        isNotNull(schema.chatMessages.summary)
      )
    )
}

/**
 * Rewrites a chat's summary by hand, to put right what the model got wrong or left out. Replies from the
 * next one on read it.
 *
 * @param input - `{ messageId, text }`: the message the summary is kept on, and the new text
 */
export async function updateStory(input: unknown) {
  const parsed = storyValidator.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, message: z.prettifyError(parsed.error) }
  }

  const updated = await db
    .update(schema.chatMessages)
    .set({ summary: parsed.data.text })
    .where(
      and(
        eq(schema.chatMessages.id, parsed.data.messageId),
        isNotNull(schema.chatMessages.summary)
      )
    )
    .returning({ id: schema.chatMessages.id })
  if (updated.length === 0) {
    return { ok: false as const, message: "That summary was replaced; reload the chat" }
  }
  return { ok: true as const }
}

/**
 * Shows another take of a turn: the chat's head moves to that message's branch, as it was last left.
 *
 * @param input - `{ id }` of the message to show
 */
export async function selectSwipe(input: unknown) {
  const parsed = idValidator.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: "Invalid message" }

  const [message] = await db
    .select({ chatId: schema.chatMessages.chatId })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.id, parsed.data.id))
    .limit(1)
  if (!message) return { ok: false as const, message: "That message was deleted" }
  if (await readActiveReply(message.chatId)) {
    return { ok: false as const, message: "Wait for the reply, or stop it, first" }
  }

  const messages = await db
    .select({
      id: schema.chatMessages.id,
      parentId: schema.chatMessages.parentId,
      createdAt: schema.chatMessages.createdAt
    })
    .from(schema.chatMessages)
    .where(eq(schema.chatMessages.chatId, message.chatId))

  await db
    .update(schema.chats)
    .set({ headMessageId: newestLeaf(messages, parsed.data.id) })
    .where(eq(schema.chats.id, message.chatId))
  return { ok: true as const }
}

/**
 * Changes the model and sampling of a chat. The next reply runs on them; one being written keeps its own.
 */
export async function updateChatSettings(input: unknown) {
  const parsed = chatSettingsValidator.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, message: z.prettifyError(parsed.error) }
  }

  const { chatId, ...settings } = parsed.data
  await db.update(schema.chats).set({ settings }).where(eq(schema.chats.id, chatId))
  return { ok: true as const }
}

/**
 * Saves who the user is in every chat: the one default persona, created the first time.
 */
export async function updatePersona(input: unknown) {
  const parsed = personaValidator.safeParse(input)
  if (!parsed.success) {
    return { ok: false as const, message: z.prettifyError(parsed.error) }
  }

  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(schema.personas)
      .set(parsed.data)
      .where(eq(schema.personas.isDefault, true))
      .returning({ id: schema.personas.id })

    if (updated) {
      // Only one default: a second one left by hand stops being it
      await tx
        .update(schema.personas)
        .set({ isDefault: false })
        .where(
          and(eq(schema.personas.isDefault, true), ne(schema.personas.id, updated.id))
        )
    } else {
      await tx.insert(schema.personas).values({ ...parsed.data, isDefault: true })
    }
  })
  return { ok: true as const }
}
