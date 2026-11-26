import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { freeComfyMemory, isComfyOnline } from "@/libs/comfy/client"
import { logger } from "@/libs/logger"

type ServiceOptions = {
  /**
   * What the engine is called in logs and errors, lower case: "voice", "caption".
   */
  name: string
  /**
   * What the header's status list calls it: "Caption · Ministral 3".
   */
  label: string
  /**
   * The Python interpreter of the service's environment and its script, relative to the project root.
   */
  python: string
  script: string
  port: number
  /**
   * The service's own arguments. `--port` and `--parent-pid` are added.
   */
  args: string[]
  /**
   * Whether its models run on the GPU, and so take part in `claimGpu`. False for one set to run on the CPU.
   * True when left out.
   */
  onGpu?: boolean
}

/**
 * Starting a service only starts Python; its model loads with the first request. Half a minute is far more
 * than that takes, and short enough to notice a broken install.
 */
const START_TIMEOUT_MS = 30_000

/**
 * ComfyUI and the services drop their models within moments of being asked. The pause gives the VRAM time to
 * actually come back before the next model asks for it.
 */
const VRAM_HANDOVER_MS = 1_500

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * A program the worker runs beside ComfyUI that keeps a model in VRAM between jobs: the Python services and
 * llama.cpp's server. `claimGpu` has the others let go before one of them works, and the worker stops them
 * all on exit.
 */
export type GpuService = {
  /**
   * Whether its models are in VRAM. One that runs on the CPU keeps them in RAM: `claimGpu` neither has it
   * let go nor clears the card for it.
   */
  onGpu: boolean
  stop: () => void
  /**
   * Has the model let go of its VRAM.
   *
   * @returns Whether there was a model to unload
   */
  unload: () => Promise<boolean>
  describe: () => Promise<Engine.Service>
}

/**
 * One of the Python services beside this project (`tts/server.py`, `caption/server.py`): a small HTTP
 * server that keeps a model in VRAM and answers a job's request with a stream of events.
 *
 * The worker owns the process. It starts it for the first job that needs it, reuses one that already
 * answers, and stops it on exit.
 */
export type PythonService = GpuService & {
  start: () => Promise<void>
  stream: <TEvent>(route: string, body: unknown) => AsyncGenerator<TEvent>
}

const services: GpuService[] = []

/**
 * Adds a service to the ones `claimGpu` clears and `stopServices` stops.
 */
export function registerService(service: GpuService) {
  services.push(service)
}

export function createPythonService(options: ServiceOptions): PythonService {
  const baseUrl = `http://127.0.0.1:${options.port}`
  let child: ChildProcess | null = null
  // The last lines the service printed, to explain a start that failed
  let recentOutput: string[] = []

  async function readHealth() {
    try {
      const response = await fetch(`${baseUrl}/health`, {
        signal: AbortSignal.timeout(1_500)
      })
      return response.ok ? ((await response.json()) as { loaded: boolean }) : null
    } catch {
      return null
    }
  }

  /**
   * Stops the service at once, mid-sentence if need be. This is also how a running job is canceled.
   *
   * On Windows the environment's `python.exe` is a small launcher that runs the real interpreter as its
   * child, so killing it alone would leave the interpreter behind with the model in VRAM. `taskkill /T`
   * takes the whole tree.
   */
  function stop() {
    if (!child) return

    if (process.platform === "win32" && child.pid) {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true
      })
    } else {
      child.kill()
    }
    child = null
  }

  /**
   * Makes sure the service is up, starting it when it isn't. One that is already answering (started by hand,
   * say) is used as it is.
   *
   * @throws {Error} When it doesn't come up, with what it printed
   */
  async function start() {
    if (await readHealth()) return

    recentOutput = []
    const started = spawn(
      path.resolve(options.python),
      [
        path.resolve(options.script),
        "--port",
        String(options.port),
        ...options.args,
        // The service watches this process and exits with it, so it can't outlive the worker
        "--parent-pid",
        String(process.pid)
      ],
      {
        // stdin stays closed: a service that reads it deadlocks on Windows while its model loads
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, PYTHONUTF8: "1", PYTHONUNBUFFERED: "1" },
        windowsHide: true
      }
    )
    child = started

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

    const deadline = Date.now() + START_TIMEOUT_MS
    while (Date.now() < deadline && child === started) {
      if (await readHealth()) {
        logger(`The ${options.name} engine started`)
        return
      }
      await delay(300)
    }

    stop()
    throw new Error(
      [`The ${options.name} engine didn't start.`, ...recentOutput]
        .join("\n")
        .slice(0, 2_000)
    )
  }

  /**
   * Has the model let go of its VRAM, if the service is up and holding it.
   *
   * @returns Whether there was a model to unload
   */
  async function unload() {
    const health = await readHealth()
    if (!health?.loaded) return false

    await fetch(`${baseUrl}/unload`, {
      method: "POST",
      signal: AbortSignal.timeout(30_000)
    }).catch(() => undefined)
    return true
  }

  /**
   * Sends a request to the service and yields its events as they arrive, one JSON object per line.
   *
   * @param route - The service's endpoint, e.g. `/generate`
   * @throws {Error} When the service refuses the request
   */
  async function* stream<TEvent>(route: string, body: unknown): AsyncGenerator<TEvent> {
    const response = await fetch(`${baseUrl}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    })
    if (!response.ok || !response.body) {
      const answer = (await response.json().catch(() => null)) as {
        message?: string
      } | null
      throw new Error(
        answer?.message ?? `The ${options.name} engine answered ${response.status}`
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
        if (line.trim()) yield JSON.parse(line) as TEvent
      }
    }
  }

  /**
   * The service as the header lists it. One that isn't answering is on standby, not offline: the worker
   * starts it when a job needs it.
   */
  async function describe(): Promise<Engine.Service> {
    const health = await readHealth()
    const state = !health ? "standby" : health.loaded ? "loaded" : "online"

    return { name: options.label, state, address: `127.0.0.1:${options.port}` }
  }

  const service: PythonService = {
    onGpu: options.onGpu ?? true,
    start,
    stop,
    unload,
    stream,
    describe
  }
  registerService(service)
  return service
}

/**
 * Every service, as the header lists them.
 */
export function describeServices() {
  return Promise.all(services.map((service) => service.describe()))
}

/**
 * The models a service can run, by name: the folders beside its default model (that one included) which
 * `isModel` accepts, the default first so a form starts on it.
 *
 * A service is started with that parent folder as its `--models-root`, and each request names the folder to
 * load.
 *
 * @param defaultDir - The default model's folder, from the environment
 * @param isModel - Whether a folder holds a model this service can load
 */
export function findModelFolders(
  defaultDir: string,
  isModel: (folder: string) => boolean
) {
  const root = path.dirname(path.resolve(defaultDir))
  const preferred = path.basename(path.resolve(defaultDir))
  if (!fs.existsSync(root)) return []

  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && isModel(path.join(root, entry.name)))
    .map((entry) => entry.name)
    .sort(
      (a, b) => Number(b === preferred) - Number(a === preferred) || a.localeCompare(b)
    )
}

/**
 * Clears the card for whoever works next. The engines share one GPU and their models don't fit side by side,
 * so before a job everything else gives its VRAM back: the other services' models, and ComfyUI's unless the
 * job runs on ComfyUI itself. Jobs of one kind in a row pay nothing. A service on the CPU is left out both
 * ways: it needs no VRAM, and its models in RAM don't stand in anyone's way.
 *
 * @param user - Who works next, and so keeps its models: a service, `"comfy"` for a ComfyUI job, or
 *   `null` for an engine that holds nothing between jobs (stable-diffusion.cpp)
 */
export async function claimGpu(user: GpuService | "comfy" | null) {
  if (user !== null && user !== "comfy" && !user.onGpu) return

  const others = services.filter((service) => service !== user && service.onGpu)
  const unloaded = await Promise.all(others.map((service) => service.unload()))
  let hasFreed = unloaded.some(Boolean)

  if (user !== "comfy" && (await isComfyOnline())) {
    await freeComfyMemory().catch(() => undefined)
    hasFreed = true
  }
  if (hasFreed) await delay(VRAM_HANDOVER_MS)
}

/**
 * Stops every service the worker started. Called when the worker exits.
 */
export function stopServices() {
  for (const service of services) service.stop()
}
