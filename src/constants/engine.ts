/**
 * Redis names shared by the app and the worker. Everything is prefixed, since the Redis server is shared
 * with other projects.
 */
export const REDIS_KEYS = {
  // List of job ids waiting for the worker (LPUSH by the app, RPUSH for a chat reply, BRPOP by the worker)
  queue: "frozen:queue",
  // JSON `Engine.Status`, rewritten by the worker with a short TTL
  engine: "frozen:engine",
  // Pub/sub channel of `Engine.Event`, relayed to browsers by `/api/events`
  events: "frozen:events",
  // Pub/sub channel of `Engine.Control`, from the app to the worker
  control: "frozen:control"
} as const

/**
 * How often the worker rewrites its status, and how long the key lives. The app treats a missing key as
 * "worker offline", so the TTL covers a few missed beats.
 */
export const ENGINE_HEARTBEAT_MS = 4_000
export const ENGINE_STATUS_TTL_SECONDS = 15

/**
 * Subfolder of ComfyUI's input and output directories that holds everything Frozen writes.
 */
export const MEDIA_FOLDER = "frozen"

/**
 * Other programs are reported once they hold this much VRAM, and the UI warns from `VRAM_WARNING_GB` up:
 * with that much gone, the large models no longer fit and jobs crawl.
 */
export const VRAM_USER_MIN_GB = 0.3
export const VRAM_WARNING_GB = 1
