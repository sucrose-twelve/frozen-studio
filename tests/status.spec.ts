/**
 * Prints the state of the queue for debugging: the worker's status, the Redis list and the newest jobs.
 *
 *   bun tests/status.spec.ts
 */
import { desc } from "drizzle-orm"

import { REDIS_KEYS } from "@/constants"
import { db, schema } from "@/drizzle"
import { readEngineStatus } from "@/libs/queue"
import { redis } from "@/libs/redis"

const client = await redis()
const engine = await readEngineStatus()
console.log(
  "engine:",
  engine
    ? JSON.stringify({
        ...engine,
        models: Object.fromEntries(
          Object.entries(engine.models).map(([kind, value]) => [kind, !!value])
        )
      })
    : "worker offline"
)
console.log("queue:", await client.lRange(REDIS_KEYS.queue, 0, -1))

const jobs = await db
  .select({
    id: schema.jobs.id,
    kind: schema.jobs.kind,
    status: schema.jobs.status,
    error: schema.jobs.error,
    createdAt: schema.jobs.createdAt
  })
  .from(schema.jobs)
  .orderBy(desc(schema.jobs.createdAt))
  .limit(8)
for (const job of jobs)
  console.log(
    job.id.slice(0, 8),
    job.kind.padEnd(6),
    job.status.padEnd(9),
    job.error ?? ""
  )

await db.$client.end()
client.destroy()
