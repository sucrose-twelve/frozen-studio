/**
 * Creates a character from a card written in Markdown, one `## section` per field:
 *
 *   bun tests/import-character.spec.ts D:/Downloads/sucrose_character_profile.md
 *
 * The sections it reads: `name`, `description`, `personality`, `speaking style`, `scenario`,
 * `first_message`, `example dialogues` (the inside of a code fence when there is one) and
 * `tags & system prompt` (the backticked tags after `Tags:` and the fenced system prompt). Others, such as
 * `voice`, are skipped. A name is cut at its first bracket: "Sucrose (ซูโครส)" is Sucrose.
 *
 * Pictures aren't imported: set the avatar and the portrait in the character editor, which converts any
 * image to the PNG uploads need.
 */
import fs from "node:fs"

import { db, schema } from "@/drizzle"

const file = process.argv[2]
if (!file || !fs.existsSync(file)) {
  console.error("Usage: bun tests/import-character.spec.ts <card.md>")
  process.exit(1)
}

const markdown = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n")
const sections = new Map<string, string>()
for (const match of markdown.matchAll(/^## (.+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)) {
  sections.set((match[1] ?? "").trim().toLowerCase(), (match[2] ?? "").trim())
}

const fenced = (text: string) =>
  /```[a-z]*\n([\s\S]*?)```/.exec(text)?.[1]?.trim() ?? null
const read = (name: string) => sections.get(name) ?? ""

const name = (read("name").split(/[(（]/)[0] ?? "").trim()
if (!name) {
  console.error("The card has no `## name` section")
  process.exit(1)
}

const extras = read("tags & system prompt")
const tagLine = /Tags:\**\s*\n?(.*)/.exec(extras)?.[1] ?? ""
const tags = [...tagLine.matchAll(/`([^`]+)`/g)].map((tag) => (tag[1] ?? "").trim())
const examples = read("example dialogues")
const greeting = read("first_message")

const [character] = await db
  .insert(schema.characters)
  .values({
    name,
    description: read("description"),
    personality: read("personality"),
    speakingStyle: read("speaking style"),
    scenario: read("scenario"),
    greetings: greeting ? [greeting] : [],
    exampleDialogues: fenced(examples) ?? examples,
    systemPrompt: fenced(extras) ?? "",
    tags
  })
  .returning({ id: schema.characters.id })

console.log(`Created ${name}: http://localhost:8190/chat?character=${character?.id}`)
console.log(`Sections read: ${[...sections.keys()].join(", ")}`)
await db.$client.end()
