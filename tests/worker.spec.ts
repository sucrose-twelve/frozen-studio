/**
 * The queue worker: `bun run worker`. It runs beside the Next.js app (`bun run dev` starts both) and is the
 * only process that talks to ComfyUI.
 */
import { startWorker } from "@/worker"

await startWorker()
