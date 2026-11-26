import { getColumns } from "drizzle-orm"

import { characters, chatMessages, chats, personas } from "./schema/chats.schema"
import { assets, jobInputs, jobs } from "./schema/jobs.schema"

export const jobColumns = getColumns(jobs)
export const assetColumns = getColumns(assets)
export const jobInputColumns = getColumns(jobInputs)
export const characterColumns = getColumns(characters)
export const personaColumns = getColumns(personas)
export const chatColumns = getColumns(chats)
export const chatMessageColumns = getColumns(chatMessages)
