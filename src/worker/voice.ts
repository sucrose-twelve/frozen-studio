import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { MEDIA_FOLDER } from "@/constants"
import { COMFY, TTS } from "@/constants/env"
import { db, schema } from "@/drizzle"
import type { AssetInsertValues, Job } from "@/drizzle/types"
import { freeComfyMemory, isComfyOnline } from "@/libs/comfy/client"
import { scriptLines } from "@/libs/job"
import { logger } from "@/libs/logger"
import { publishEvent } from "@/libs/queue"

import { CanceledError } from "./comfy-socket"
import type { RunControl } from "./process"

/**
 * What the text-to-speech service streams back while it works on a request (see `tts/server.py`).
 */
type VoiceEvent =
  | { event: "loading" }
  | { event: "line"; index: number }
  | { event: "saved"; index: number; file: string; seconds: number; sampleRate: number }
  | { event: "done" }
  | { event: "error"; message: string }

const SERVER_SCRIPT = "tts/server.py"
const BASE_URL = `http://127.0.0.1:${TTS.port}`

/**
 * Starting the service only starts Python; the model loads with the first request. Half a minute is far
 * more than that takes, and short enough to notice a broken install.
 */
const START_TIMEOUT_MS = 30_000

/**
 * ComfyUI drops its models within moments of being asked. The pause gives the VRAM time to actually come
 * back before the voice model asks for it.
 */
const VRAM_HANDOVER_MS = 1_500

let service: ChildProcess | null = null
// The last lines the service printed, to explain a start that failed
let recentOutput: string[] = []

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * The voice model's name when the engine is installed: its Python environment, the service script and the
 * model's weights are all in place. `null` otherwise, which disables the Voice form.
 */
export function findVoiceModel() {
  const modelDir = path.resolve(TTS.modelDir)
  const hasWeights = ["model.safetensors", "pytorch_model.bin"].some((name) =>
    fs.existsSync(path.join(modelDir, name))
  )
  const isInstalled =
    hasWeights &&
    fs.existsSync(path.resolve(TTS.python)) &&
    fs.existsSync(path.resolve(SERVER_SCRIPT))

  return isInstalled ? path.basename(modelDir) : null
}

async function readHealth() {
  try {
    const response = await fetch(`${BASE_URL}/health`, {
      signal: AbortSignal.timeout(1_500)
    })
    return response.ok ? ((await response.json()) as { loaded: boolean }) : null
  } catch {
    return null
  }
}

/**
 * Stops the service at once, mid-sentence if need be. This is also how a running voice job is canceled.
 *
 * On Windows the environment's `python.exe` is a small launcher that runs the real interpreter as its
 * child, so killing it alone would leave the interpreter behind with the model in VRAM. `taskkill /T`
 * takes the whole tree.
 */
export function stopVoiceEngine() {
  if (!service) return

  if (process.platform === "win32" && service.pid) {
    spawnSync("taskkill", ["/PID", String(service.pid), "/T", "/F"], {
      windowsHide: true
    })
  } else {
    service.kill()
  }
  service = null
}

/**
 * Makes sure the service is up, starting it when it isn't. One that is already answering (started by hand,
 * say) is used as it is.
 *
 * @throws {Error} When it doesn't come up, with what it printed
 */
async function startVoiceEngine() {
  if (await readHealth()) return

  recentOutput = []
  const started = spawn(
    path.resolve(TTS.python),
    [
      path.resolve(SERVER_SCRIPT),
      "--port",
      String(TTS.port),
      "--model-dir",
      path.resolve(TTS.modelDir),
      "--output-root",
      path.resolve(COMFY.outputDir, MEDIA_FOLDER),
      // The service watches this process and exits with it, so it can't outlive the worker
      "--parent-pid",
      String(process.pid)
    ],
    {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PYTHONUTF8: "1", PYTHONUNBUFFERED: "1" },
      windowsHide: true
    }
  )
  service = started

  const remember = (chunk: Buffer) => {
    const lines = chunk.toString("utf8").split(/\r?\n/).filter(Boolean)
    recentOutput = [...recentOutput, ...lines].slice(-20)
  }
  started.stdout?.on("data", remember)
  started.stderr?.on("data", remember)
  started.on("error", (error) => remember(Buffer.from(error.message)))
  started.on("exit", () => {
    if (service === started) service = null
  })

  const deadline = Date.now() + START_TIMEOUT_MS
  while (Date.now() < deadline && service === started) {
    if (await readHealth()) {
      logger("Voice engine started")
      return
    }
    await delay(300)
  }

  stopVoiceEngine()
  throw new Error(
    ["The voice engine didn't start.", ...recentOutput].join("\n").slice(0, 2_000)
  )
}

/**
 * Has the voice model let go of its VRAM, if the service is up and holding it. Called before a ComfyUI job:
 * the image and video models need the whole card.
 */
export async function unloadVoiceModel() {
  const health = await readHealth()
  if (!health?.loaded) return

  await fetch(`${BASE_URL}/unload`, {
    method: "POST",
    signal: AbortSignal.timeout(30_000)
  }).catch(() => undefined)
}

/**
 * Sends a request to the service and yields its events as they arrive, one JSON object per line.
 */
async function* speak(body: unknown): AsyncGenerator<VoiceEvent> {
  const response = await fetch(`${BASE_URL}/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  })
  if (!response.ok || !response.body) {
    const answer = (await response.json().catch(() => null)) as {
      message?: string
    } | null
    throw new Error(answer?.message ?? `The voice engine answered ${response.status}`)
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
      if (line.trim()) yield JSON.parse(line) as VoiceEvent
    }
  }
}

/**
 * Runs a voice job: speaks every line of its script into its own WAV file and saves them as assets.
 *
 * ComfyUI is asked to drop its models first. The two engines share one GPU, and whichever works next
 * gets the VRAM the other was holding.
 *
 * @param job - A voice job already marked `running`
 * @param control - Gets a way to stop the run; a cancel that arrived earlier is honoured
 * @throws {CanceledError} When the run was canceled
 * @throws {Error} When the engine doesn't start, or fails to speak a line
 */
export async function runVoiceJob(
  job: Job,
  params: Media.VoiceParams,
  control: RunControl
) {
  const lines = scriptLines(job.prompt)
  if (lines.length === 0) throw new Error("The script has no lines to speak")

  const report = (label: string, value = 0, max = 0) =>
    void publishEvent({ type: "progress", id: job.id, label, value, max }).catch(
      () => undefined
    )

  control.cancel = async () => stopVoiceEngine()
  if (control.isCanceled) throw new CanceledError()

  report("Starting the voice engine")
  if (await isComfyOnline()) {
    await freeComfyMemory().catch(() => undefined)
    await delay(VRAM_HANDOVER_MS)
  }
  await startVoiceEngine()
  if (control.isCanceled) throw new CanceledError()

  const folder = path.resolve(COMFY.outputDir, MEDIA_FOLDER, job.id)
  const files = lines.map((_, index) => `voice_${String(index + 1).padStart(5, "0")}.wav`)
  const saved: AssetInsertValues[] = []

  try {
    const events = speak({
      lines: lines.map((text, index) => ({
        text,
        file: path.join(folder, files[index])
      })),
      description: params.description,
      seed: params.seed
    })

    for await (const event of events) {
      switch (event.event) {
        case "loading":
          report("Loading the voice model")
          break
        case "line":
          report("Speaking", event.index + 1, lines.length)
          break
        case "saved": {
          const stats = await fs.promises.stat(event.file)
          saved.push({
            jobId: job.id,
            kind: "audio",
            role: "output",
            root: "output",
            path: `${MEDIA_FOLDER}/${job.id}/${files[event.index]}`,
            mime: "audio/wav",
            // Sound has no size in pixels
            width: 0,
            height: 0,
            size: stats.size,
            position: event.index
          })
          break
        }
        case "error":
          throw new Error(event.message)
        case "done":
          break
      }
    }
  } catch (error) {
    // Stopping the service is how a cancel lands, and it surfaces here as a dropped connection
    if (control.isCanceled) throw new CanceledError()
    throw error
  }

  if (control.isCanceled) throw new CanceledError()
  if (saved.length < lines.length) {
    throw new Error("The voice engine stopped before every line was spoken")
  }

  await db.insert(schema.assets).values(saved)
}
