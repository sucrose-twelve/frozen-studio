/**
 * The least a message needs for walking a chat's tree.
 */
export type MessageLink = {
  id: string
  parentId: string | null
  createdAt: Date | number
}

const timeOf = (message: MessageLink) =>
  typeof message.createdAt === "number" ? message.createdAt : message.createdAt.getTime()

/**
 * The conversation that ends at `headId`: the messages from the first one down to it, oldest first. Empty
 * when `headId` is `null` or isn't one of `messages`.
 *
 * @param messages - Every message of the chat, in any order
 *
 * @example
 * messagePath(messages, chat.headMessageId).map((message) => message.content)
 */
export function messagePath<T extends MessageLink>(
  messages: readonly T[],
  headId: string | null
): T[] {
  const byId = new Map(messages.map((message) => [message.id, message]))
  const path: T[] = []
  let current = headId ? byId.get(headId) : undefined

  // A parent always exists before its child, so the walk ends; the size check guards against a bad row
  while (current && path.length <= messages.length) {
    path.push(current)
    current = current.parentId ? byId.get(current.parentId) : undefined
  }
  return path.reverse()
}

/**
 * The messages that answer the same message as `message` does, itself included, oldest first: a reply and
 * its regenerations, or the greetings a chat can open on. These are the "swipes" of one turn.
 */
export function siblingsOf<T extends MessageLink>(
  messages: readonly T[],
  message: T
): T[] {
  return messages
    .filter((other) => other.parentId === message.parentId)
    .sort((a, b) => timeOf(a) - timeOf(b))
}

/**
 * Where a branch ends: from `id`, follow the newest child down until a message has none. Picking a swipe
 * shows its branch as it was last left.
 */
export function newestLeaf<T extends MessageLink>(messages: readonly T[], id: string) {
  let currentId = id
  for (let depth = 0; depth <= messages.length; depth++) {
    const children = messages.filter((message) => message.parentId === currentId)
    const newest = children.sort((a, b) => timeOf(b) - timeOf(a))[0]
    if (!newest) break
    currentId = newest.id
  }
  return currentId
}

/**
 * A message and every message under it, in any order: what an edit of that message makes out of date.
 */
export function subtreeIds<T extends MessageLink>(messages: readonly T[], id: string) {
  const ids = [id]
  for (let index = 0; index < ids.length; index++) {
    for (const message of messages) {
      if (message.parentId === ids[index]) ids.push(message.id)
    }
  }
  return ids
}

/**
 * A model's name as the Chat page shows it: its file name without `.gguf`.
 */
export function chatModelLabel(model: string) {
  return model.replace(/\.gguf$/i, "")
}

/**
 * Puts the names into a card's text: `{{char}}` is the character, `{{user}}` the persona. Case and spaces
 * inside the braces don't matter, as in the cards other apps write.
 */
export function fillNames(text: string, names: { char: string; user: string }) {
  return text
    .replace(/\{\{\s*char\s*\}\}/gi, names.char)
    .replace(/\{\{\s*user\s*\}\}/gi, names.user)
}

/**
 * What a character says aloud in a message: the parts in quotes ("…", “…”, 「…」), one after another. A
 * message with no quotes at all is all speech, less its actions between asterisks. Empty when there is
 * nothing to say.
 *
 * @example
 * dialogueOf('*waves* "Hello!" *smiles* "Nice to see you."') // "Hello! Nice to see you."
 */
export function dialogueOf(text: string) {
  const quoted = [...text.matchAll(/"([^"]+)"|“([^”]+)”|「([^」]+)」/g)].map((match) =>
    (match[1] ?? match[2] ?? match[3] ?? "").trim()
  )
  const spoken = quoted.length > 0 ? quoted : [text.replace(/\*[^*]*\*?/g, " ")]

  return spoken.join(" ").replace(/\s+/g, " ").trim()
}

/**
 * Whether a text is already Japanese: it has kana. Kanji alone could be Chinese.
 */
export function isJapanese(text: string) {
  return /[぀-ヿ]/.test(text)
}

/**
 * Cuts speech into lines at the ends of sentences, joining short sentences up to `maxLength` characters. A
 * sentence longer than that is cut at the last space or comma before the limit, or at the limit.
 */
export function speechLines(text: string, maxLength: number) {
  const sentences = text.match(/[^.!?。！？…]+[.!?。！？…]*["」”]?\s*/g) ?? []
  const lines: string[] = []
  let current = ""

  const push = (line: string) => {
    if (line.trim()) lines.push(line.trim())
  }
  for (const sentence of sentences) {
    if ((current + sentence).length <= maxLength) {
      current += sentence
      continue
    }
    push(current)
    current = ""

    let rest = sentence
    while (rest.length > maxLength) {
      const window = rest.slice(0, maxLength)
      const cut = Math.max(
        window.lastIndexOf(" "),
        window.lastIndexOf("、"),
        window.lastIndexOf(",")
      )
      const at = cut > maxLength / 2 ? cut + 1 : maxLength
      push(rest.slice(0, at))
      rest = rest.slice(at)
    }
    current = rest
  }
  push(current)
  return lines
}
