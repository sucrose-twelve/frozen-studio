import { and, eq } from "drizzle-orm"

import {
  CHAT_DEFAULT_PERSONA,
  CHAT_DRY,
  CHAT_SAVE_INTERVAL_MS,
  CHAT_STREAM_INTERVAL_MS,
  CHAT_SUMMARY
} from "@/constants"
import { CHAT } from "@/constants/env"
import { db, schema } from "@/drizzle"
import { fillNames, messagePath } from "@/libs/chat"
import {
  chatFormat,
  chatSystemText,
  cleanReply,
  formatPrompt,
  mergeTurns,
  stopSequences,
  summarySystemText,
  transcript,
  type ChatFormat,
  type PromptTurn
} from "@/libs/chat-prompt"
import { publishEvent } from "@/libs/queue"

import { CanceledError } from "./comfy-socket"
import { llama } from "./llama"
import type { RunControl } from "./process"
import { claimGpu } from "./service"

/**
 * Loads what a reply is written from: the chat, its character and persona, and the conversation up to the
 * message being answered.
 *
 * @throws {Error} When the chat or the reply's message was deleted while the job waited
 */
async function loadConversation(params: Media.ChatParams) {
  const [chat] = await db
    .select()
    .from(schema.chats)
    .where(eq(schema.chats.id, params.chatId))
    .limit(1)
  if (!chat) throw new Error("The chat was deleted")

  const [[character], [persona], messages] = await Promise.all([
    db
      .select()
      .from(schema.characters)
      .where(eq(schema.characters.id, chat.characterId))
      .limit(1),
    chat.personaId
      ? db
          .select()
          .from(schema.personas)
          .where(eq(schema.personas.id, chat.personaId))
          .limit(1)
      : db
          .select()
          .from(schema.personas)
          .where(eq(schema.personas.isDefault, true))
          .limit(1),
    db
      .select({
        id: schema.chatMessages.id,
        parentId: schema.chatMessages.parentId,
        role: schema.chatMessages.role,
        content: schema.chatMessages.content,
        summary: schema.chatMessages.summary,
        createdAt: schema.chatMessages.createdAt
      })
      .from(schema.chatMessages)
      .where(eq(schema.chatMessages.chatId, chat.id))
  ])
  if (!character) throw new Error("The chat's character was deleted")

  const reply = messages.find((message) => message.id === params.messageId)
  if (!reply) throw new Error("The message this reply was for was deleted")

  const user = persona ?? CHAT_DEFAULT_PERSONA
  const names = { char: character.name, user: user.name }
  const path = messagePath(messages, reply.parentId)
  // The newest summary on the branch stands in for everything up to its message
  const summarized = path.findLastIndex((message) => message.summary !== null)
  // A greeting from the card still has its placeholders; an empty message is a reply that failed
  const history = path
    .slice(summarized + 1)
    .filter((message) => message.content.trim())
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: fillNames(message.content, names)
    }))

  return {
    character,
    persona: user,
    names,
    story: path[summarized]?.summary ?? null,
    history
  }
}

type Conversation = Awaited<ReturnType<typeof loadConversation>>
type HistoryTurn = Conversation["history"][number]

/**
 * Writes a prompt in the model's format and counts its tokens with the loaded model.
 */
async function renderPrompt(format: ChatFormat, system: string, turns: PromptTurn[]) {
  const merged = mergeTurns(turns)
  const prompt =
    format === "template"
      ? await llama.applyTemplate([{ role: "system", content: system }, ...merged])
      : formatPrompt(format, system, merged)
  return { prompt, tokens: await llama.countTokens(prompt) }
}

/**
 * How many of the newest turns fit in `tokens`, at least two: the user's message and what it answers.
 */
async function recentTurnCount(turns: readonly HistoryTurn[], tokens: number) {
  let total = 0
  let count = 0
  for (const turn of turns.toReversed()) {
    total += await llama.countTokens(turn.content)
    if (total > tokens && count >= 2) break
    count += 1
  }
  return count
}

/**
 * Has the chat model fold some older turns into the chat's summary, and saves the new summary on the last
 * of those turns, so the replies after it read the summary instead.
 *
 * @throws {CanceledError} When the reply is stopped while the summary is written
 */
async function summarize(
  format: ChatFormat,
  conversation: Conversation,
  story: string | null,
  turns: readonly HistoryTurn[],
  signal: AbortSignal
) {
  const last = turns.at(-1)
  if (!last) return story

  const request = [
    story ? `# The summary so far\n${story}` : "",
    `# What happened next\n${transcript(turns, conversation.names)}`,
    "Write the new summary."
  ]
    .filter(Boolean)
    .join("\n\n")
  const { prompt } = await renderPrompt(format, summarySystemText(conversation.names), [
    { role: "user", content: request }
  ])

  let text = ""
  try {
    for await (const chunk of llama.complete(
      {
        prompt,
        n_predict: CHAT_SUMMARY.maxTokens,
        temperature: CHAT_SUMMARY.temperature,
        min_p: 0.05,
        top_p: 1,
        top_k: 0,
        repeat_penalty: 1,
        dry_multiplier: 0,
        stop: stopSequences(format, conversation.names.user),
        cache_prompt: false
      },
      signal
    )) {
      text += chunk.content
    }
  } catch (error) {
    if (signal.aborted) throw new CanceledError()
    throw error
  }

  const summary = text.trim()
  // A summary that came out empty leaves the turns to be dropped instead
  if (!summary) return story

  await db
    .update(schema.chatMessages)
    .set({ summary })
    .where(eq(schema.chatMessages.id, last.id))
  return summary
}

/**
 * Builds the prompt and makes it fit the context. Past `CHAT_SUMMARY.triggerShare` of it, the older turns are
 * summarized and only the newest stay word for word. Should it still not fit, the oldest turns go, never the
 * card and never the first turn left, until the prompt and the longest reply fit. Tokens are counted by the
 * loaded model.
 *
 * @param onSummarizing - Called before a summary is written, which takes a few seconds
 */
async function buildPrompt(
  model: string,
  conversation: Conversation,
  maxTokens: number,
  signal: AbortSignal,
  onSummarizing: () => void
) {
  const { character, persona } = conversation
  const format = chatFormat(model)
  const budget = CHAT.context - maxTokens
  const render = (story: string | null, turns: PromptTurn[]) =>
    renderPrompt(format, chatSystemText(character, persona, story), turns)

  let story = conversation.story
  let turns = conversation.history
  let { prompt, tokens } = await render(story, turns)

  const trigger = budget * CHAT_SUMMARY.triggerShare
  if (tokens > trigger && turns.length > 2) {
    // The card and the summary so far, which a new summary about the same length replaces
    const { tokens: card } = await render(story, [])
    const kept = await recentTurnCount(
      turns,
      Math.max(0, trigger - card) * CHAT_SUMMARY.keepShare
    )
    const older = turns.slice(0, turns.length - kept)
    if (older.length > 0) {
      onSummarizing()
      const summary = await summarize(format, conversation, story, older, signal)
      if (summary !== story) {
        story = summary
        turns = turns.slice(older.length)
        ;({ prompt, tokens } = await render(story, turns))
      }
    }
  }

  while (tokens > budget && turns.length > 2) {
    // Drop about as many turns as the excess needs at the average turn length, at least one
    const average = tokens / turns.length
    const count = Math.max(1, Math.ceil((tokens - budget) / average))
    const [opening, ...rest] = turns
    turns = opening ? [opening, ...rest.slice(Math.min(count, rest.length - 1))] : rest
    ;({ prompt, tokens } = await render(story, turns))
  }
  if (tokens > budget) {
    throw new Error(
      "The character card alone is too long for the context. Shorten it, or raise CHAT_CONTEXT."
    )
  }

  return { prompt, format }
}

/**
 * Runs a chat job: writes one reply of the character into the message the job was queued for.
 *
 * The text so far goes to the browsers every tenth of a second and into the message every second, so a page
 * that opens mid-reply, or a worker that stops, loses little. Stopping a reply keeps what was written, like
 * a reply cut short.
 *
 * @param job - A chat job already marked `running`
 * @param control - Gets a way to stop the reply; a cancel that arrived earlier is honoured
 * @throws {CanceledError} When the reply was stopped
 * @throws {Error} When the chat is gone, the engine doesn't start, or the model writes nothing
 */
export async function runChatJob(
  job: { id: string },
  params: Media.ChatParams,
  control: RunControl
) {
  const report = (label: string) =>
    void publishEvent({ type: "progress", id: job.id, label, value: 0, max: 0 }).catch(
      () => undefined
    )

  const conversation = await loadConversation(params)
  const { character, persona } = conversation
  if (control.isCanceled) throw new CanceledError()

  report("Starting the chat engine")
  await claimGpu(llama)
  await llama.start(params.model, () => report("Loading the chat model"))

  const abort = new AbortController()
  control.cancel = async () => abort.abort()
  if (control.isCanceled) throw new CanceledError()

  const { prompt, format } = await buildPrompt(
    params.model,
    conversation,
    params.sampling.maxTokens,
    abort.signal,
    () => report("Summarizing the story so far")
  )
  if (control.isCanceled) throw new CanceledError()
  report("Writing")

  let text = ""
  let tokens: number | null = null
  let sentAt = 0
  let savedAt = Date.now()

  const reply = () => cleanReply(text, character.name)
  const send = () =>
    void publishEvent({
      type: "chat",
      id: job.id,
      messageId: params.messageId,
      text: reply()
    }).catch(() => undefined)
  const save = () =>
    db
      .update(schema.chatMessages)
      .set({ content: reply(), tokens })
      .where(
        and(
          eq(schema.chatMessages.id, params.messageId),
          eq(schema.chatMessages.jobId, job.id)
        )
      )

  try {
    const chunks = llama.complete(
      {
        prompt,
        n_predict: params.sampling.maxTokens,
        temperature: params.sampling.temperature,
        min_p: params.sampling.minP,
        // Off, so min-p alone decides which tokens can come
        top_p: 1,
        top_k: 0,
        repeat_penalty: params.sampling.repeatPenalty,
        dry_multiplier: params.sampling.dryMultiplier,
        dry_penalty_last_n: CHAT_DRY.range,
        dry_allowed_length: CHAT_DRY.allowedLength,
        stop: stopSequences(format, persona.name),
        cache_prompt: true
      },
      abort.signal
    )

    for await (const chunk of chunks) {
      text += chunk.content
      if (chunk.stop) tokens = chunk.tokens_predicted ?? null

      const now = Date.now()
      if (now - sentAt >= CHAT_STREAM_INTERVAL_MS) {
        sentAt = now
        send()
      }
      if (now - savedAt >= CHAT_SAVE_INTERVAL_MS) {
        savedAt = now
        await save()
      }
    }
  } catch (error) {
    // Aborting the request is how a stop lands, and it surfaces here
    if (!control.isCanceled) {
      await save()
      throw error
    }
  }

  await save()
  send()

  if (control.isCanceled) throw new CanceledError()
  if (!reply()) throw new Error("The model stopped without writing anything")
}
