/**
 * Redis names shared by the app and the worker. Everything is prefixed, since the Redis server is shared
 * with other projects.
 */
export const REDIS_KEYS = {
  // List of job ids waiting for the worker (LPUSH by the app, BRPOP by the worker)
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
 * with that much gone, the video models no longer fit and jobs crawl.
 */
export const VRAM_USER_MIN_GB = 0.3
export const VRAM_WARNING_GB = 1

/**
 * The negative prompt Wan 2.2 ships with in ComfyUI's official workflow (overexposure, blur, extra fingers,
 * static frames, …). It only applies without the Lightning LoRAs, which run at CFG 1.
 */
export const WAN_NEGATIVE_PROMPT =
  "色调艳丽，过曝，静态，细节模糊不清，字幕，风格，作品，画作，画面，静止，整体发灰，最差质量，低质量，JPEG压缩残留，丑陋的，残缺的，多余的手指，画得不好的手部，画得不好的脸部，畸形的，毁容的，形态畸形的肢体，手指融合，静止不动的画面，杂乱的背景，三条腿，背景人很多，倒着走"

export const STATIC_CAMERA_PROMPT = "Static camera, the camera does not move."
