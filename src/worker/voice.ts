import fs from "node:fs"
import path from "node:path"

import { MEDIA_FOLDER } from "@/constants"
import { COMFY, TTS } from "@/constants/env"
import { db, schema } from "@/drizzle"
import type { AssetInsertValues, Job } from "@/drizzle/types"
import { scriptLines } from "@/libs/job"
import { publishEvent } from "@/libs/queue"
import { voiceFamily } from "@/libs/voice-model"

import { CanceledError } from "./comfy-socket"
import type { RunControl } from "./process"
import { claimGpu, createPythonService, findModelFolders } from "./service"

/**
 * What a text-to-speech service streams back while it works on a request (see `tts/server.py`).
 */
type VoiceEvent =
  | { event: "loading" }
  | { event: "line"; index: number }
  | { event: "saved"; index: number; file: string; seconds: number; sampleRate: number }
  | { event: "done" }
  | { event: "error"; message: string }

const SERVER_SCRIPT = "tts/server.py"

/**
 * The service runs once per Python environment: the families need different versions of the same
 * libraries. Both copies see the same models folder and write to the same place.
 */
const serviceArgs = [
  "--models-root",
  path.dirname(path.resolve(TTS.modelDir)),
  "--output-root",
  path.resolve(COMFY.outputDir, MEDIA_FOLDER)
]
const ENVIRONMENTS = {
  parler: {
    python: TTS.python,
    service: createPythonService({
      name: "voice",
      python: TTS.python,
      script: SERVER_SCRIPT,
      port: TTS.port,
      args: serviceArgs
    })
  },
  design: {
    python: TTS.designPython,
    service: createPythonService({
      name: "voice design",
      python: TTS.designPython,
      script: SERVER_SCRIPT,
      port: TTS.designPort,
      args: serviceArgs
    })
  }
}

const FAMILY_ENVIRONMENT: Record<Media.VoiceFamily, keyof typeof ENVIRONMENTS> = {
  parler: "parler",
  qwen: "design",
  voxcpm: "design"
}

const has = (folder: string, name: string) => fs.existsSync(path.join(folder, name))

/**
 * Whether a folder holds a model of its family, judged by the files that family's loader reads.
 */
const IS_MODEL: Record<Media.VoiceFamily, (folder: string) => boolean> = {
  parler: (folder) =>
    (has(folder, "model.safetensors") || has(folder, "pytorch_model.bin")) &&
    has(folder, "prompt_tokenizer") &&
    has(folder, "description_tokenizer"),
  qwen: (folder) => has(folder, "model.safetensors") && has(folder, "speech_tokenizer"),
  voxcpm: (folder) => has(folder, "model.safetensors") && has(folder, "audiovae.pth")
}

/**
 * The voice models that can run, by folder name, the default one first. Empty when nothing is installed
 * (the service script, a Python environment, a model for it), which disables the Voice form.
 *
 * A folder counts when it holds a model of the family its name says, and that family's Python environment
 * is there to run it.
 */
export function findVoiceModels() {
  if (!fs.existsSync(path.resolve(SERVER_SCRIPT))) return []

  return findModelFolders(TTS.modelDir, (folder) => {
    const family = voiceFamily(path.basename(folder))
    const environment = ENVIRONMENTS[FAMILY_ENVIRONMENT[family]]

    return fs.existsSync(path.resolve(environment.python)) && IS_MODEL[family](folder)
  })
}

/**
 * Runs a voice job: speaks every line of its script into its own WAV file and saves them as assets.
 *
 * The other engines drop their models first. They share one GPU, and whichever works next gets the VRAM
 * the others were holding.
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

  // The model's family says which environment's service speaks it, and how
  const family = voiceFamily(params.model)
  const { service } = ENVIRONMENTS[FAMILY_ENVIRONMENT[family]]

  // Stopping the service is how a running voice job is canceled
  control.cancel = async () => service.stop()
  if (control.isCanceled) throw new CanceledError()

  report("Starting the voice engine")
  await claimGpu(service)
  await service.start()
  if (control.isCanceled) throw new CanceledError()

  const folder = path.resolve(COMFY.outputDir, MEDIA_FOLDER, job.id)
  const files = lines.map((_, index) => `voice_${String(index + 1).padStart(5, "0")}.wav`)
  const saved: AssetInsertValues[] = []

  try {
    const events = service.stream<VoiceEvent>("/generate", {
      model: params.model,
      engine: family,
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
