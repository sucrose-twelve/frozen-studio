import type { InferInsertModel, InferSelectModel } from "drizzle-orm"

import type { characters, chatMessages, chats, personas } from "./schema/chats.schema"
import type { assets, jobInputs, jobs } from "./schema/jobs.schema"

export type Job = InferSelectModel<typeof jobs>
export type JobInsertValues = InferInsertModel<typeof jobs>
export type JobUpdateValues = Partial<JobInsertValues>

export type Asset = InferSelectModel<typeof assets>
export type AssetInsertValues = InferInsertModel<typeof assets>
export type AssetUpdateValues = Partial<AssetInsertValues>

export type JobInput = InferSelectModel<typeof jobInputs>
export type JobInputInsertValues = InferInsertModel<typeof jobInputs>

export type Character = InferSelectModel<typeof characters>
export type CharacterInsertValues = InferInsertModel<typeof characters>

export type Persona = InferSelectModel<typeof personas>

export type Chat = InferSelectModel<typeof chats>
export type ChatInsertValues = InferInsertModel<typeof chats>

export type ChatMessage = InferSelectModel<typeof chatMessages>
export type ChatMessageInsertValues = InferInsertModel<typeof chatMessages>
