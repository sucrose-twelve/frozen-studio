import { defineRelations } from "drizzle-orm"

import * as jobs from "./schema/jobs.schema"

export const schema = Object.freeze({ ...jobs })

export const relations = defineRelations(schema, (r) => ({
  jobs: {
    assets: r.many.assets(),
    inputs: r.many.jobInputs()
  },
  assets: {
    job: r.one.jobs({ from: r.assets.jobId, to: r.jobs.id })
  },
  jobInputs: {
    job: r.one.jobs({ from: r.jobInputs.jobId, to: r.jobs.id, optional: false }),
    asset: r.one.assets({ from: r.jobInputs.assetId, to: r.assets.id, optional: false })
  }
}))
