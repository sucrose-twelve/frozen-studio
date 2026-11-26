import { createSearchParamsCache, parseAsString } from "nuqs/server"

/**
 * The Chat page's URL state, shared by the server cache below and the client hook (`useChatQuery`).
 *
 * - `chat`: the conversation on screen
 * - `character`: whose chats the list opens, when no chat is picked (after creating a character)
 */
export const chatParsers = {
  chat: parseAsString,
  character: parseAsString
}

export const queryValidator = createSearchParamsCache(chatParsers)

export type QueryValidator = Awaited<ReturnType<typeof queryValidator.parse>>
