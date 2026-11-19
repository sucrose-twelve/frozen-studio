import type { NextRequest } from "next/server"

import { REDIS_KEYS } from "@/constants"
import { redisDedicated, type RedisClient } from "@/libs/redis"

/**
 * A comment line every so often, so nothing between the browser and the server closes a quiet stream.
 */
const HEARTBEAT_MS = 20_000

/**
 * Streams the worker's events (job status, progress, engine status) to the browser as Server-Sent Events,
 * by relaying the Redis channel the worker publishes on. Each open page gets its own Redis subscription,
 * closed when the page leaves.
 *
 * `no-transform` keeps compression from buffering the events.
 */
export async function GET(request: NextRequest) {
  const encoder = new TextEncoder()
  let subscriber: RedisClient | null = null
  let stop = () => {}

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let isStopped = false
      const write = (chunk: string) => {
        if (!isStopped) controller.enqueue(encoder.encode(chunk))
      }

      const heartbeat = setInterval(() => write(": ping\n\n"), HEARTBEAT_MS)
      stop = () => {
        if (isStopped) return
        isStopped = true
        clearInterval(heartbeat)
        subscriber?.destroy()
      }
      request.signal.addEventListener("abort", stop)

      try {
        subscriber = await redisDedicated()
        // The page may have left while the connection was opening
        if (isStopped) return subscriber.destroy()

        await subscriber.subscribe(REDIS_KEYS.events, (message) =>
          write(`data: ${message}\n\n`)
        )
        write(": connected\n\n")
      } catch {
        stop()
        controller.close()
      }
    },
    cancel() {
      stop()
    }
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive"
    }
  })
}
