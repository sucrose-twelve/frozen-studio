import { and, asc, desc, eq, inArray } from "drizzle-orm"
import { omit, pick } from "es-toolkit"

import { assetViewColumns, toAssetView, type AssetView } from "@/actions/jobs/read"
import { ACTIVE_JOB_STATUSES, CHAT_DEFAULT_PERSONA } from "@/constants"
import { db, schema } from "@/drizzle"
import {
  characterColumns,
  chatColumns,
  chatMessageColumns
} from "@/drizzle/table-columns"
import { fillNames, messagePath, siblingsOf } from "@/libs/chat"

export type ChatSummary = {
  id: string
  title: string
  lastMessageAt: number
}

export type CharacterSummary = {
  id: string
  name: string
  avatar: AssetView | null
  chats: ChatSummary[]
}

/**
 * One message on screen, with where it sits among its alternatives: the regenerated replies of one turn, or
 * the greetings a chat can open on.
 */
export type ThreadMessage = {
  id: string
  parentId: string | null
  role: Media.ChatRole
  content: string
  createdAt: number
  /**
   * The job that wrote it, for a reply; `null` for a user message, a greeting, or once the job was deleted.
   */
  job: { id: string; status: Media.JobStatus; error: string | null } | null
  swipe: {
    index: number
    count: number
    previousId: string | null
    nextId: string | null
  }
  /**
   * The message spoken aloud: the job that speaks it, what it says (the dialogue, translated when the
   * character speaks Japanese) and the clip, once there is one. `null` until someone asks for it.
   */
  speech: {
    jobId: string
    status: Media.JobStatus
    error: string | null
    text: string | null
    audio: AssetView | null
  } | null
}

export type ChatThread = {
  id: string
  title: string
  settings: Media.ChatSettings
  character: {
    id: string
    name: string
    avatar: AssetView | null
    portrait: AssetView | null
    /**
     * Whether the character has a voice, so its messages can be spoken.
     */
    hasVoice: boolean
  }
  persona: { name: string; description: string }
  messages: ThreadMessage[]
  /**
   * The newest summary on the branch on screen: the chat model's account of the story up to `messageId`,
   * which replies read in place of the messages it covers. `null` until the chat outgrows the context.
   */
  story: { messageId: string; text: string; covers: number } | null
  /**
   * The reply being written in this chat, if one is queued or running. Only one at a time.
   */
  activeJobId: string | null
}

export type CharacterDetail = Omit<
  typeof schema.characters.$inferSelect,
  "avatarAssetId" | "portraitAssetId" | "createdAt" | "updatedAt"
> & {
  avatar: AssetView | null
  portrait: AssetView | null
  /**
   * The clip the character's voice is cloned from, once one was made.
   */
  voiceSample: AssetView | null
}

/**
 * The assets of the given ids, by id. Avatars and portraits are uploads.
 */
async function readAssets(ids: (string | null)[]) {
  const wanted = ids.filter((id): id is string => !!id)
  if (wanted.length === 0) return new Map<string, AssetView>()

  const rows = await db
    .select(assetViewColumns)
    .from(schema.assets)
    .where(inArray(schema.assets.id, wanted))
  return new Map(rows.map((row) => [row.id, toAssetView(row)]))
}

/**
 * Every character by name, each with its chats, the latest first: the Chat page's list.
 */
export async function readCharacters(): Promise<CharacterSummary[]> {
  const [characters, chats] = await Promise.all([
    db
      .select(pick(characterColumns, ["id", "name", "avatarAssetId"]))
      .from(schema.characters)
      .orderBy(asc(schema.characters.name)),
    db
      .select(pick(chatColumns, ["id", "characterId", "title", "lastMessageAt"]))
      .from(schema.chats)
      .orderBy(desc(schema.chats.lastMessageAt))
  ])
  const avatars = await readAssets(characters.map((character) => character.avatarAssetId))

  return characters.map((character) => ({
    id: character.id,
    name: character.name,
    avatar: character.avatarAssetId
      ? (avatars.get(character.avatarAssetId) ?? null)
      : null,
    chats: chats
      .filter((chat) => chat.characterId === character.id)
      .map((chat) => ({
        id: chat.id,
        title: chat.title,
        lastMessageAt: chat.lastMessageAt.getTime()
      }))
  }))
}

/**
 * One character with its whole card, for the editor.
 */
export async function readCharacter(id: string): Promise<CharacterDetail | null> {
  const [character] = await db
    .select()
    .from(schema.characters)
    .where(eq(schema.characters.id, id))
    .limit(1)
  if (!character) return null

  const { avatarAssetId, portraitAssetId } = character
  const sampleAssetId = character.voice?.sampleAssetId ?? null
  const assets = await readAssets([avatarAssetId, portraitAssetId, sampleAssetId])

  return {
    ...omit(character, ["avatarAssetId", "portraitAssetId", "createdAt", "updatedAt"]),
    avatar: avatarAssetId ? (assets.get(avatarAssetId) ?? null) : null,
    portrait: portraitAssetId ? (assets.get(portraitAssetId) ?? null) : null,
    voiceSample: sampleAssetId ? (assets.get(sampleAssetId) ?? null) : null
  }
}

/**
 * Who the user is in every chat: the default persona, or the stand-in until one is saved.
 */
export async function readPersona() {
  const [persona] = await db
    .select({ name: schema.personas.name, description: schema.personas.description })
    .from(schema.personas)
    .where(eq(schema.personas.isDefault, true))
    .limit(1)

  return persona ?? CHAT_DEFAULT_PERSONA
}

/**
 * A chat as it is on screen: the branch from the first message to its head, each message with its swipes
 * and the job that wrote it.
 */
export async function readChatThread(id: string): Promise<ChatThread | null> {
  const [chat] = await db
    .select()
    .from(schema.chats)
    .where(eq(schema.chats.id, id))
    .limit(1)
  if (!chat) return null

  const [[character], persona, messages] = await Promise.all([
    db
      .select(
        pick(characterColumns, [
          "id",
          "name",
          "avatarAssetId",
          "portraitAssetId",
          "voice"
        ])
      )
      .from(schema.characters)
      .where(eq(schema.characters.id, chat.characterId))
      .limit(1),
    readPersona(),
    db
      .select(
        pick(chatMessageColumns, [
          "id",
          "parentId",
          "role",
          "content",
          "jobId",
          "speechJobId",
          "speechText",
          "summary",
          "createdAt"
        ])
      )
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.chatId, chat.id))
      .orderBy(asc(schema.chatMessages.createdAt))
  ])
  if (!character) return null

  const path = messagePath(messages, chat.headMessageId)
  const summarized = path.findLastIndex((message) => message.summary !== null)
  const summaryMessage = path[summarized]
  const jobIds = messages
    .map((message) => message.jobId)
    .filter((jobId) => jobId !== null)
  const speechJobIds = path
    .map((message) => message.speechJobId)
    .filter((jobId) => jobId !== null)
  const readJobs = (ids: string[]) =>
    ids.length > 0
      ? db
          .select({
            id: schema.jobs.id,
            status: schema.jobs.status,
            error: schema.jobs.error
          })
          .from(schema.jobs)
          .where(inArray(schema.jobs.id, ids))
      : []

  const [assets, jobs, speechJobs, clips] = await Promise.all([
    readAssets([character.avatarAssetId, character.portraitAssetId]),
    readJobs(jobIds),
    readJobs(speechJobIds),
    speechJobIds.length > 0
      ? db
          .select(assetViewColumns)
          .from(schema.assets)
          .where(inArray(schema.assets.jobId, speechJobIds))
      : []
  ])
  const jobsById = new Map(jobs.map((job) => [job.id, job]))
  const speechJobsById = new Map(speechJobs.map((job) => [job.id, job]))
  const clipsByJob = new Map(clips.map((clip) => [clip.jobId, toAssetView(clip)]))
  const names = { char: character.name, user: persona.name }
  const activeJob = jobs.find((job) => ACTIVE_JOB_STATUSES.includes(job.status))

  return {
    id: chat.id,
    title: chat.title,
    settings: chat.settings,
    character: {
      id: character.id,
      name: character.name,
      avatar: character.avatarAssetId
        ? (assets.get(character.avatarAssetId) ?? null)
        : null,
      portrait: character.portraitAssetId
        ? (assets.get(character.portraitAssetId) ?? null)
        : null,
      hasVoice: !!character.voice
    },
    persona,
    activeJobId: activeJob?.id ?? null,
    story: summaryMessage?.summary
      ? {
          messageId: summaryMessage.id,
          text: summaryMessage.summary,
          covers: summarized + 1
        }
      : null,
    messages: path.map((message) => {
      const siblings = siblingsOf(messages, message)
      const index = siblings.findIndex((sibling) => sibling.id === message.id)
      const speechJob = message.speechJobId
        ? speechJobsById.get(message.speechJobId)
        : undefined

      return {
        id: message.id,
        parentId: message.parentId,
        role: message.role,
        // A greeting from the card still has its placeholders
        content: fillNames(message.content, names),
        createdAt: message.createdAt.getTime(),
        job: message.jobId ? (jobsById.get(message.jobId) ?? null) : null,
        swipe: {
          index,
          count: siblings.length,
          previousId: siblings[index - 1]?.id ?? null,
          nextId: siblings[index + 1]?.id ?? null
        },
        speech: speechJob
          ? {
              jobId: speechJob.id,
              status: speechJob.status,
              error: speechJob.error,
              text: message.speechText,
              audio: clipsByJob.get(speechJob.id) ?? null
            }
          : null
      }
    })
  }
}

/**
 * The reply being written in a chat, if any: the id of its queued or running job.
 */
export async function readActiveReply(chatId: string) {
  const [active] = await db
    .select({ jobId: schema.jobs.id })
    .from(schema.chatMessages)
    .innerJoin(schema.jobs, eq(schema.jobs.id, schema.chatMessages.jobId))
    .where(
      and(
        eq(schema.chatMessages.chatId, chatId),
        inArray(schema.jobs.status, [...ACTIVE_JOB_STATUSES])
      )
    )
    .limit(1)

  return active?.jobId ?? null
}
