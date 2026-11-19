/**
 * Queues an image job from the command line, to exercise the queue and the worker without the UI:
 *
 *   bun tests/job.spec.ts "A blue ceramic mug on a wooden table"
 *
 * The worker (`bun run worker`) must be running to pick it up.
 */
import { createJob } from "@/actions/jobs/create"
import { IMAGE_DEFAULTS } from "@/constants"
import { db } from "@/drizzle"
import { readEngineStatus } from "@/libs/queue"
import { redis } from "@/libs/redis"

const prompt = process.argv.slice(2).join(" ").trim()
if (!prompt) {
  console.error('Usage: bun tests/job.spec.ts "<prompt>"')
  process.exit(1)
}

const engine = await readEngineStatus()
const model = engine?.models.image?.models[0]

if (!model) {
  console.error("No image model reported. Is the worker running and ComfyUI online?")
} else {
  const result = await createJob({
    kind: "image",
    prompt,
    negative: "",
    references: [],
    model,
    aspect: "1:1",
    tier: IMAGE_DEFAULTS.tier,
    count: 1,
    steps: IMAGE_DEFAULTS.steps,
    cfg: IMAGE_DEFAULTS.cfg,
    sampler: null,
    seed: null,
    shouldRemoveBackground: false
  })
  console.log(result.ok ? `Queued job ${result.ids[0]}` : result.message)
}

await db.$client.end()
;(await redis()).destroy()
