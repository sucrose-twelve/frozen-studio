import type { Metadata } from "next"
import { z } from "zod"

import { readCharacters, readChatThread, readPersona } from "./actions/read"
import { ChatSettings } from "./components/chat-settings"
import { ChatSidebar } from "./components/chat-sidebar"
import { ChatThreadView } from "./components/chat-thread"
import { queryValidator } from "./validator.nuqs"

export const instant = false

export const metadata: Metadata = { title: "Chat" }

/**
 * The Chat page: characters and their chats on the left, the conversation in the middle, and on the right
 * the character's portrait with the chat's model, sampling and who the user is.
 *
 * Unlike the other pages it fills the window edge to edge, with no panel frames: the two side columns
 * are ruled off from the conversation, and the conversation keeps to a readable column in the middle.
 *
 * `?chat=` picks the conversation. Without it, `?character=` (or the first character) opens that
 * character's chats in the list.
 */
export default async function Chat({ searchParams }: NextSearchParams) {
  const query = queryValidator.parse(await searchParams)
  const chatId = z.uuid().safeParse(query.chat).success ? query.chat : null
  const characterId = z.uuid().safeParse(query.character).success ? query.character : null

  const [characters, thread, persona] = await Promise.all([
    readCharacters(),
    chatId ? readChatThread(chatId) : null,
    readPersona()
  ])
  const openCharacterId = thread?.character.id ?? characterId ?? characters[0]?.id ?? null

  return (
    <div className='grid h-[calc(100svh-4rem)] grid-cols-[380px_minmax(0,1fr)_380px]'>
      <ChatSidebar
        characters={characters}
        openCharacterId={openCharacterId}
        currentChatId={thread?.id ?? null}
      />
      {/* Keyed by the chat, so what was typed or picked for one chat doesn't carry over to the next */}
      <ChatThreadView key={`thread-${thread?.id}`} thread={thread} />
      <ChatSettings key={`settings-${thread?.id}`} thread={thread} persona={persona} />
    </div>
  )
}
