import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { CHAT } from "@/constants/env"
import { logger } from "@/libs/logger"

import { registerService } from "./service"

/**
 * A 10 GB model reads from disk in a few seconds once Windows has it cached, and in well under a minute the
 * first time. Three minutes is room for a slow disk, and short enough to notice a broken install.
 */
const LOAD_TIMEOUT_MS = 180_000

/**
 * The server's process id, kept beside the program. A worker that was killed outright can't stop the server
 * it started, and the next worker finds it here and stops it before starting its own.
 */
const PID_FILE = path.join(path.dirname(path.resolve(CHAT.server)), "llama-server.pid")

/**
 * The options of llama-server's `/completion` this project sends.
 */
export type CompletionRequest = {
  prompt: string
  n_predict: number
  temperature: number
  min_p: number
  top_p: number
  top_k: number
  repeat_penalty: number
  dry_multiplier: number
  /** How many tokens back DRY looks; llama-server's default is 64 */
  dry_penalty_last_n?: number
  /** How long a repeat may run before DRY penalizes it; the default is 2 */
  dry_allowed_length?: number
  stop: string[]
  cache_prompt: boolean
}

/**
 * One piece of a streamed completion. The last one has `stop` set and the totals.
 */
export type CompletionChunk = {
  content: string
  stop: boolean
  tokens_predicted?: number
}

type Health = "ok" | "loading" | null

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const baseUrl = `http://127.0.0.1:${CHAT.port}`

let child: ChildProcess | null = null
// The last lines the server printed, to explain a start that failed
let recentOutput: string[] = []

/**
 * The chat models that can run, by file name. Empty when llama-server isn't installed, which disables the
 * Chat page's form. Vision projectors (`mmproj…`) sit beside some models and are not models themselves.
 */
export function findChatModels() {
  const folder = path.resolve(CHAT.modelDir)
  if (!fs.existsSync(path.resolve(CHAT.server)) || !fs.existsSync(folder)) return []

  return fs
    .readdirSync(folder)
    .filter((name) => /\.gguf$/i.test(name) && !/^mmproj/i.test(name))
    .sort((a, b) => a.localeCompare(b))
}

async function readHealth(): Promise<Health> {
  try {
    const response = await fetch(`${baseUrl}/health`, {
      signal: AbortSignal.timeout(1_500)
    })
    if (response.ok) return "ok"
    // 503 while the model is still loading
    return response.status === 503 ? "loading" : null
  } catch {
    return null
  }
}

/**
 * The file name of the model the running server holds.
 */
async function readLoadedModel() {
  try {
    const response = await fetch(`${baseUrl}/props`, {
      signal: AbortSignal.timeout(1_500)
    })
    const props = (await response.json()) as { model_path?: string }
    return props.model_path ? path.basename(props.model_path) : null
  } catch {
    return null
  }
}

function killTree(pid: number) {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { windowsHide: true })
  } else {
    try {
      process.kill(pid)
    } catch {
      // Already gone
    }
  }
}

/**
 * Whether `pid` is still a llama-server. The server can end without the worker hearing of it (its process
 * tree killed with the worker's), and Windows hands its pid to another program later: that one must not be
 * killed in its place.
 */
function isLlamaServer(pid: number) {
  if (process.platform !== "win32") {
    const name = spawnSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8" })
    return name.stdout.includes(path.parse(CHAT.server).name)
  }

  const listed = spawnSync("tasklist", ["/FI", `PID eq ${pid}`, "/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true
  })
  return listed.stdout.toLowerCase().includes(path.basename(CHAT.server).toLowerCase())
}

/**
 * Stops the server, the one this worker started or one a killed worker left behind. Its model leaves VRAM
 * with it; starting again reads it back from disk.
 */
function stop() {
  if (child?.pid) killTree(child.pid)
  child = null

  if (fs.existsSync(PID_FILE)) {
    const pid = Number(fs.readFileSync(PID_FILE, "utf8"))
    if (Number.isInteger(pid) && pid > 0 && isLlamaServer(pid)) killTree(pid)
    fs.rmSync(PID_FILE, { force: true })
  }
}

/**
 * Makes sure the server is up with `model`. One already holding that model is used as it is; otherwise the
 * server is (re)started with it, since one process holds one model.
 *
 * @param onLoading - Called once when the model has to be loaded, to say why the reply is waiting
 * @throws {Error} When the server doesn't come up, with what it printed
 */
async function start(model: string, onLoading: () => void) {
  if ((await readHealth()) === "ok" && (await readLoadedModel()) === model) return

  stop()
  onLoading()

  const modelPath = path.resolve(CHAT.modelDir, model)
  if (!fs.existsSync(modelPath))
    throw new Error(`The chat model ${model} isn't installed`)

  recentOutput = []
  const started = spawn(
    path.resolve(CHAT.server),
    [
      "--model",
      modelPath,
      // Every layer on the GPU: the models picked for this fit a 16 GB card with their context
      "--n-gpu-layers",
      "99",
      "--ctx-size",
      String(CHAT.context),
      "--flash-attn",
      "on",
      // One conversation at a time, so it gets the whole context
      "--parallel",
      "1",
      "--no-webui",
      "--host",
      "127.0.0.1",
      "--port",
      String(CHAT.port)
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
  )
  child = started
  if (started.pid) fs.writeFileSync(PID_FILE, String(started.pid))

  const remember = (chunk: Buffer) => {
    const lines = chunk.toString("utf8").split(/\r?\n/).filter(Boolean)
    recentOutput = [...recentOutput, ...lines].slice(-20)
  }
  started.stdout?.on("data", remember)
  started.stderr?.on("data", remember)
  started.on("error", (error) => remember(Buffer.from(error.message)))
  started.on("exit", () => {
    if (child === started) child = null
  })

  const deadline = Date.now() + LOAD_TIMEOUT_MS
  while (Date.now() < deadline && child === started) {
    if ((await readHealth()) === "ok") {
      logger(`The chat engine started with ${model}`)
      return
    }
    await delay(500)
  }

  stop()
  throw new Error(
    [`The chat engine didn't start with ${model}.`, ...recentOutput]
      .join("\n")
      .slice(0, 2_000)
  )
}

async function unload() {
  const isUp = child !== null || (await readHealth()) !== null
  stop()
  return isUp
}

async function describe(): Promise<Engine.Service> {
  const health = await readHealth()
  const state = health === "ok" ? "loaded" : health === "loading" ? "online" : "standby"

  return { name: "Chat · llama.cpp", state, address: `127.0.0.1:${CHAT.port}` }
}

/**
 * How many tokens `content` is for the loaded model.
 */
async function countTokens(content: string) {
  const response = await fetch(`${baseUrl}/tokenize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content })
  })
  const answer = (await response.json()) as { tokens: unknown[] }
  return answer.tokens.length
}

/**
 * Writes a conversation out with the loaded model's own chat template, ready for its reply.
 */
async function applyTemplate(messages: { role: string; content: string }[]) {
  const response = await fetch(`${baseUrl}/apply-template`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages })
  })
  if (!response.ok) throw new Error(`The chat engine answered ${response.status}`)
  return ((await response.json()) as { prompt: string }).prompt
}

/**
 * Has the model continue `request.prompt`, yielding the text as it is written. The server sends Server-Sent
 * Events, one `data:` line per piece.
 *
 * @param signal - Aborting it stops the reply at once; the server stays up with its model
 */
async function* complete(
  request: CompletionRequest,
  signal: AbortSignal
): AsyncGenerator<CompletionChunk> {
  const response = await fetch(`${baseUrl}/completion`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...request, stream: true }),
    signal
  })
  if (!response.ok || !response.body) {
    const answer = (await response.json().catch(() => null)) as {
      error?: { message?: string }
    } | null
    throw new Error(
      answer?.error?.message ?? `The chat engine answered ${response.status}`
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ""

  while (true) {
    const { value, done } = await reader.read()
    if (done) break

    buffered += decoder.decode(value, { stream: true })
    const lines = buffered.split("\n")
    buffered = lines.pop() ?? ""
    for (const line of lines) {
      if (line.startsWith("data: ")) yield JSON.parse(line.slice(6)) as CompletionChunk
    }
  }
}

/**
 * llama.cpp's server, run by the worker for chat replies. Unlike the Python services it can't watch the
 * worker's process, so a worker that is killed outright leaves it running; the next start finds it by its
 * pid file.
 */
export const llama = {
  onGpu: true,
  start,
  stop,
  unload,
  describe,
  countTokens,
  applyTemplate,
  complete
}

registerService(llama)
