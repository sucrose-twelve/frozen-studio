import { format } from "date-fns"

import type { CharacterValidator } from "./validator.zod"

/**
 * A character from the editor as its row: the greetings that have text, the tags split off their commas.
 */
export function characterValues(input: CharacterValidator) {
  return {
    name: input.name,
    avatarAssetId: input.avatarAssetId,
    portraitAssetId: input.portraitAssetId,
    description: input.description,
    personality: input.personality,
    speakingStyle: input.speakingStyle,
    scenario: input.scenario,
    greetings: input.greetings.map((greeting) => greeting.text).filter(Boolean),
    exampleDialogues: input.exampleDialogues,
    systemPrompt: input.systemPrompt,
    tags: input.tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean)
  }
}

/**
 * A piece of a message as the thread shows it: the character's actions, written between asterisks, apart
 * from what is said.
 */
export type MessagePart = { isAction: boolean; text: string }

/**
 * Splits a message into its actions (`*adjusts her glasses*`) and the rest. An asterisk left open runs to
 * the end, which is how a reply being written looks mid-action.
 *
 * @example
 * messageParts("*waves* Hello!") // [{ isAction: true, text: "waves" }, { isAction: false, text: " Hello!" }]
 */
export function messageParts(text: string): MessagePart[] {
  const parts: MessagePart[] = []
  for (const [index, piece] of text.split("*").entries()) {
    if (piece) parts.push({ isAction: index % 2 === 1, text: piece })
  }
  return parts
}

/**
 * How a chat is named in the list: its title, or when it was last written in.
 */
export function chatLabel(chat: { title: string; lastMessageAt: number }) {
  return chat.title || format(chat.lastMessageAt, "d MMM, HH:mm")
}
