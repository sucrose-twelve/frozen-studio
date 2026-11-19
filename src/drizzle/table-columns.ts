import { getColumns } from "drizzle-orm"

import { assets, jobInputs, jobs } from "./schema/jobs.schema"

export const jobColumns = getColumns(jobs)
export const assetColumns = getColumns(assets)
export const jobInputColumns = getColumns(jobInputs)
