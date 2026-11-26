import { fillNames } from "./chat"

/**
 * How a model's conversation is written out as one prompt:
 *
 * - `chatml`: Qwen's `<|im_start|>` turns
 * - `tekken`: Mistral's `[INST]` turns, as Mistral Nemo and its fine-tunes read them
 * - `template`: whatever the GGUF file's own chat template says, rendered by llama-server
 */
export type ChatFormat = "chatml" | "tekken" | "template"

export type PromptCharacter = {
  name: string
  description: string
  personality: string
  speakingStyle: string
  scenario: string
  exampleDialogues: string
  systemPrompt: string
}

export type PromptPersona = {
  name: string
  description: string
}

export type PromptTurn = {
  role: Media.ChatRole
  content: string
}

/**
 * The two formats written by hand are the ones tested with a Thai card (Rocinante-X 12B, Qwen3-14B); any
 * other model gets its own template.
 */
export function chatFormat(model: string): ChatFormat {
  if (/qwen/i.test(model)) return "chatml"
  if (/nemo|rocinante|mag-?mell|(^|[^a-z])mn-/i.test(model)) return "tekken"
  return "template"
}

/**
 * Everything the model is told before the conversation: the card, section by section, who the user is, and
 * the summary of the turns that no longer fit. Empty sections are left out.
 *
 * @param story - The summary of the chat's older turns, when there is one
 */
export function chatSystemText(
  character: PromptCharacter,
  persona: PromptPersona,
  story: string | null = null
) {
  const sections = [
    character.systemPrompt.trim() ||
      "You are {{char}}. Stay in character and reply as {{char}} would.",
    section("Character description", character.description),
    section("Personality", character.personality),
    section("Speaking style", character.speakingStyle),
    section("Scenario", character.scenario),
    section(
      "Example dialogue (a reference for style, not part of this chat)",
      character.exampleDialogues
    ),
    section("About {{user}}", persona.description),
    section(
      "The story so far (what happened in this chat before the messages below)",
      story ?? ""
    ),
    "The user plays {{user}}. Write only {{char}}'s replies; never speak or act for {{user}}.",
    // Without it, Qwen3 settled into copying its previous reply and echoing the user's words back
    section(
      "How to reply",
      "Answer what {{user}} just said or did, and move the scene on. Don't repeat {{user}}'s words back, and don't reuse the opening, the actions or the closing line of your earlier replies: each reply is new."
    )
  ]

  return fillNames(sections.filter(Boolean).join("\n\n"), {
    char: character.name,
    user: persona.name
  })
}

function section(title: string, body: string) {
  const text = body.trim()
  return text ? `# ${title}\n${text}` : ""
}

/**
 * Joins turns by the same side that follow each other (two user messages after a deleted reply), since
 * the formats expect the two sides to alternate.
 */
export function mergeTurns(turns: readonly PromptTurn[]) {
  const merged: PromptTurn[] = []
  for (const turn of turns) {
    const last = merged.at(-1)
    if (last?.role === turn.role) last.content = `${last.content}\n\n${turn.content}`
    else merged.push({ ...turn })
  }
  return merged
}

/**
 * Writes the conversation out in one of the hand-written formats, ending where the model's reply begins.
 *
 * - Tekken has no system turn (Rocinante's card says not to use `[SYSTEM_PROMPT]`): the system text opens
 *   the first `[INST]`. A chat that opens on the character's greeting gets a short user turn before it,
 *   since a conversation must start with the user.
 * - ChatML ends on an empty `<think>` block, so Qwen3 answers at once instead of reasoning first.
 *
 * @param turns - Oldest first, already merged
 */
export function formatPrompt(
  format: Exclude<ChatFormat, "template">,
  system: string,
  turns: readonly PromptTurn[]
) {
  if (format === "chatml") {
    const lines = turns.map(
      (turn) => `<|im_start|>${turn.role}\n${turn.content}<|im_end|>\n`
    )
    return [
      `<|im_start|>system\n${system}<|im_end|>\n`,
      ...lines,
      "<|im_start|>assistant\n<think>\n\n</think>\n\n"
    ].join("")
  }

  const [first, ...rest] = turns
  const opening =
    first?.role === "user"
      ? `[INST]${system}\n\n${first.content}[/INST]`
      : `[INST]${system}\n\n[Begin the roleplay.][/INST]${first ? `${first.content}</s>` : ""}`
  const following = rest.map((turn) =>
    turn.role === "user" ? `[INST]${turn.content}[/INST]` : `${turn.content}</s>`
  )
  return ["<s>", opening, ...following].join("")
}

/**
 * Where a reply must end even if the model doesn't stop by itself: its format's turn markers, and the user's
 * name at the start of a line, which is the model starting to write the user's part.
 */
export function stopSequences(format: ChatFormat, userName: string) {
  const markers: Record<ChatFormat, string[]> = {
    chatml: ["<|im_end|>", "<|im_start|>"],
    tekken: ["</s>", "[INST]"],
    template: []
  }
  return [...markers[format], `\n${userName}:`]
}

/**
 * Tidies what the model wrote: the space around it, and the character's own name when the model starts with
 * it ("Sucrose: …"), which the thread already shows.
 */
export function cleanReply(text: string, characterName: string) {
  const trimmed = text.trim()
  const prefix = `${characterName}:`
  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length).trim() : trimmed
}

/**
 * What the chat model is told when it summarizes a chat's older turns: one summary that takes in the last
 * one and the turns after it, keeping what later replies must stay true to.
 */
export function summarySystemText(names: { char: string; user: string }) {
  const { char, user } = names
  return [
    `You keep the record of a roleplay chat between ${char} and ${user}. You get the summary so far, if there is one, and the part of the chat that came after it. Write one new summary that covers both.`,
    [
      "Keep:",
      "- what happened, in order, briefly",
      "- facts that must stay the same: names, places, titles, promises, plans, things given or said that matter",
      `- how ${char} and ${user} feel about each other, and where their relationship stands now`,
      "- where the scene is at the end, and what is going on"
    ].join("\n"),
    "Write it in the language the chat is written in, in the past tense and the third person, in under 400 words. Drop details that no longer matter. Answer with the summary only."
  ].join("\n\n")
}

/**
 * A stretch of the chat as a script, `Name: text` per turn, for the summary.
 */
export function transcript(
  turns: readonly PromptTurn[],
  names: { char: string; user: string }
) {
  return turns
    .map((turn) => `${turn.role === "user" ? names.user : names.char}: ${turn.content}`)
    .join("\n\n")
}

/**
 * What the chat model is told when it translates a character's lines for speaking: Japanese as the
 * character would say it, with nothing around it for the voice to read out.
 *
 * @param personality - The card's personality and speaking style, so the translation keeps the voice
 */
export function translationSystemText(characterName: string, personality: string) {
  return [
    `You translate what ${characterName}, a character in a roleplay, says aloud into natural spoken Japanese.`,
    `Keep how ${characterName} talks: politeness, hesitation, stammering (written the Japanese way, as in す、すみません) and excitement.`,
    personality.trim() ? `# How ${characterName} talks\n${personality.trim()}` : "",
    "Answer with the Japanese lines only: no notes, no romaji, no quotation marks, nothing in other languages."
  ]
    .filter(Boolean)
    .join("\n\n")
}
