import fs from "node:fs"
import path from "node:path"

import { MEDIA_FOLDER } from "@/constants"
import { COMFY, TTS } from "@/constants/env"
import { db, schema } from "@/drizzle"
import type { AssetInsertValues, Job } from "@/drizzle/types"
import { scriptLines } from "@/libs/job"
import { publishEvent } from "@/libs/queue"

import { CanceledError } from "./comfy-socket"
import type { RunControl } from "./process"
import { claimGpu, createPythonService, findModelFolders } from "./service"

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

const service = createPythonService({
  name: "voice",
  python: TTS.python,
  script: SERVER_SCRIPT,
  port: TTS.port,
  args: [
    "--models-root",
    path.dirname(path.resolve(TTS.modelDir)),
    "--output-root",
    path.resolve(COMFY.outputDir, MEDIA_FOLDER)
  ]
})

/**
 * The voice models that can run, by folder name, the default one first. Empty when the engine isn't
 * installed (its Python environment, the service script, at least one model), which disables the Voice
 * form.
 *
 * A voice model is a folder with weights and the two tokenizers the service loads, which is what the
 * Japanese Parler-TTS models ship with.
 */
export function findVoiceModels() {
  const isInstalled =
    fs.existsSync(path.resolve(TTS.python)) && fs.existsSync(path.resolve(SERVER_SCRIPT))
  if (!isInstalled) return []

  return findModelFolders(
    TTS.modelDir,
    (folder) =>
      ["model.safetensors", "pytorch_model.bin"].some((name) =>
        fs.existsSync(path.join(folder, name))
      ) &&
      fs.existsSync(path.join(folder, "prompt_tokenizer")) &&
      fs.existsSync(path.join(folder, "description_tokenizer"))
  )
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
