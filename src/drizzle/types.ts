import type { InferInsertModel, InferSelectModel } from "drizzle-orm"

import type { assets, jobInputs, jobs } from "./schema/jobs.schema"

export type Job = InferSelectModel<typeof jobs>
export type JobInsertValues = InferInsertModel<typeof jobs>
export type JobUpdateValues = Partial<JobInsertValues>

export type Asset = InferSelectModel<typeof assets>
export type AssetInsertValues = InferInsertModel<typeof assets>
export type AssetUpdateValues = Partial<AssetInsertValues>

export type JobInput = InferSelectModel<typeof jobInputs>
export type JobInputInsertValues = InferInsertModel<typeof jobInputs>
