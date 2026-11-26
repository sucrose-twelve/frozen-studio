import { defineRelations } from "drizzle-orm"

import * as chats from "./schema/chats.schema"
import * as jobs from "./schema/jobs.schema"

export const schema = Object.freeze({ ...jobs, ...chats })

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
  },
  characters: {
    chats: r.many.chats()
  },
  chats: {
    character: r.one.characters({
      from: r.chats.characterId,
      to: r.characters.id,
      optional: false
    }),
    persona: r.one.personas({ from: r.chats.personaId, to: r.personas.id }),
    messages: r.many.chatMessages()
  },
  chatMessages: {
    chat: r.one.chats({ from: r.chatMessages.chatId, to: r.chats.id, optional: false })
  }
}))
