import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
  type AnyPgColumn
} from "drizzle-orm/pg-core"

import { sharedTimestampColumns } from "../utils"
import { assets, jobs } from "./jobs.schema"

/**
 * A character the user chats with: the card the model plays from. `{{char}}` and `{{user}}` in its text
 * stand for the character's name and the persona's.
 *
 * `greetings` are the openings a new chat can start on; each becomes a first message of its own, so the user
 * can swipe between them.
 */
export const characters = pgTable.withRLS(
  "characters",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    avatarAssetId: uuid("avatar_asset_id").references(() => assets.id, {
      onDelete: "set null"
    }),
    portraitAssetId: uuid("portrait_asset_id").references(() => assets.id, {
      onDelete: "set null"
    }),
    description: text("description").notNull().default(""),
    personality: text("personality").notNull().default(""),
    speakingStyle: text("speaking_style").notNull().default(""),
    scenario: text("scenario").notNull().default(""),
    greetings: jsonb("greetings").notNull().default([]).$type<string[]>(),
    exampleDialogues: text("example_dialogues").notNull().default(""),
    systemPrompt: text("system_prompt").notNull().default(""),
    tags: jsonb("tags").notNull().default([]).$type<string[]>(),
    // How the character sounds when a message is spoken; `null` until a voice is set up
    voice: jsonb("voice").$type<Media.CharacterVoice>(),
    ...sharedTimestampColumns
  },
  (self) => [index("characters_name_index").on(self.name)]
)

/**
 * Who the user plays in a chat. `{{user}}` becomes its name, and its description tells the model about the
 * user. One persona is the default, which new chats get.
 */
export const personas = pgTable.withRLS("personas", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  description: text("description").notNull().default(""),
  isDefault: boolean("is_default").notNull().default(false),
  ...sharedTimestampColumns
})

/**
 * One conversation with a character.
 *
 * Its messages form a tree (`chat_messages.parent_id`): a regenerated reply or an edited branch is a sibling
 * of the message it replaces. `head_message_id` is the newest message of the branch on screen, and the
 * conversation is the path from the first message down to it. It has no foreign key, since the message
 * table points back here; the actions keep it on a message of this chat.
 */
export const chats = pgTable.withRLS(
  "chats",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    characterId: uuid("character_id")
      .notNull()
      .references(() => characters.id, { onDelete: "cascade" }),
    personaId: uuid("persona_id").references(() => personas.id, {
      onDelete: "set null"
    }),
    title: varchar("title", { length: 200 }).notNull().default(""),
    headMessageId: uuid("head_message_id"),
    settings: jsonb("settings").notNull().$type<Media.ChatSettings>(),
    // When the last message was sent: the order of the chat list
    lastMessageAt: timestamp("last_message_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    ...sharedTimestampColumns
  },
  (self) => [
    index("chats_character_last_message_at_index").on(
      self.characterId,
      self.lastMessageAt.desc()
    )
  ]
)

/**
 * One message of a chat. An assistant message written by the model has the job that wrote it; while that
 * job runs, `content` is what has been written so far.
 *
 * Deleting a message deletes everything that followed it (`parent_id` cascades).
 */
export const chatMessages = pgTable.withRLS(
  "chat_messages",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    chatId: uuid("chat_id")
      .notNull()
      .references(() => chats.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => chatMessages.id, {
      onDelete: "cascade"
    }),
    role: varchar("role", { length: 20 }).notNull().$type<Media.ChatRole>(),
    content: text("content").notNull().default(""),
    jobId: uuid("job_id").references(() => jobs.id, { onDelete: "set null" }),
    // How many tokens the model wrote, for a reply that is finished
    tokens: integer("tokens"),
    // The message spoken aloud: the job that spoke it (its clip is that job's asset), and what it said,
    // which is the dialogue translated into the character's spoken language
    speechJobId: uuid("speech_job_id").references(() => jobs.id, {
      onDelete: "set null"
    }),
    speechText: text("speech_text"),
    // The story from the first message down to this one, summarized by the chat model when older turns had
    // to leave the context. A reply further down this branch reads it in place of those turns.
    summary: text("summary"),
    ...sharedTimestampColumns
  },
  (self) => [
    index("chat_messages_chat_created_at_index").on(self.chatId, self.createdAt),
    index("chat_messages_parent_index").on(self.parentId),
    index("chat_messages_job_index").on(self.jobId)
  ]
)
