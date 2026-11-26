"use client"

import { useQueryStates } from "nuqs"
import { useCallback, useMemo, useTransition } from "react"

import { chatParsers } from "../validator.nuqs"

/**
 * The Chat page's URL state. Both changes load from the server, inside a transition (`isPending` while they
 * do).
 *
 * - `showChat` puts a conversation on screen
 * - `showCharacter` opens a character's chats in the list, with no conversation picked
 */
export function useChatQuery() {
  const [isPending, startTransition] = useTransition()
  const [query, setQuery] = useQueryStates(chatParsers, {
    shallow: false,
    startTransition
  })

  const showChat = useCallback(
    (chat: string | null) => setQuery({ chat, character: null }),
    [setQuery]
  )
  const showCharacter = useCallback(
    (character: string | null) => setQuery({ chat: null, character }),
    [setQuery]
  )

  return useMemo(
    () => ({ query, isPending, showChat, showCharacter }),
    [query, isPending, showChat, showCharacter]
  )
}
