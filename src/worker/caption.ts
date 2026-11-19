import fs from "node:fs"
import path from "node:path"

import { asc, eq } from "drizzle-orm"

import { MEDIA_FOLDER } from "@/constants"
import { CAPTION, COMFY } from "@/constants/env"
import { db, schema } from "@/drizzle"
import type { Job } from "@/drizzle/types"
import { assetFilePath } from "@/libs/media"
import { publishEvent } from "@/libs/queue"

import { CanceledError } from "./comfy-socket"
import type { RunControl } from "./process"
import { claimGpu, createPythonService, findModelFolders } from "./service"

/**
 * What the captioning service streams back while it works on a request (see `caption/server.py`).
 */
type CaptionEvent =
  | { event: "loading" }
  | { event: "reading" }
  | ({ event: "done" } & Media.Caption)
  | { event: "error"; message: string }

const SERVER_SCRIPT = "caption/server.py"

const service = createPythonService({
  name: "caption",
  python: CAPTION.python,
  script: SERVER_SCRIPT,
  port: CAPTION.port,
  args: [
    "--models-root",
    path.dirname(path.resolve(CAPTION.modelDir)),
    // Uploads and earlier results: everything a caption job can be pointed at
    "--image-root",
    path.resolve(COMFY.inputDir, MEDIA_FOLDER),
    "--image-root",
    path.resolve(COMFY.outputDir, MEDIA_FOLDER)
  ]
})

/**
 * The captioning models that can run, by folder name, the default one first. Empty when the engine isn't
 * installed (its Python environment, the service script, at least one model), which disables the Caption
 * form.
 *
 * A captioning model is a folder with a `config.json` and weights: whatever transformers can load.
 */
export function findCaptionModels() {
  const isInstalled =
    fs.existsSync(path.resolve(CAPTION.python)) &&
    fs.existsSync(path.resolve(SERVER_SCRIPT))
  if (!isInstalled) return []

  return findModelFolders(
    CAPTION.modelDir,
    (folder) =>
      fs.existsSync(path.join(folder, "config.json")) &&
      fs.readdirSync(folder).some((name) => name.endsWith(".safetensors"))
  )
}

/**
 * Runs a caption job: has the vision-language model describe the job's image, or answer the job's prompt
 * about it, and keeps what it wrote on the job itself (`jobs.result`), since the result is text and not a
 * file.
 *
 * The other engines drop their models first: an 8B model takes about 10 GB of the card. The service holds
 * one model at a time, and swaps it when a job names another.
 *
 * @param job - A caption job already marked `running`
 * @param control - Gets a way to stop the run; a cancel that arrived earlier is honoured
 * @throws {CanceledError} When the run was canceled
 * @throws {Error} When the image is gone, the engine doesn't start, or it fails to describe the image
 */
export async function runCaptionJob(
  job: Job,
  params: Media.CaptionParams,
  control: RunControl
) {
  const [input] = await db
    .select({ root: schema.assets.root, path: schema.assets.path })
    .from(schema.jobInputs)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.jobInputs.assetId))
    .where(eq(schema.jobInputs.jobId, job.id))
    .orderBy(asc(schema.jobInputs.position))
    .limit(1)
  const imagePath = input ? assetFilePath(input) : null
  if (!imagePath) throw new Error("A caption job needs an image")

  const report = (label: string) =>
    void publishEvent({ type: "progress", id: job.id, label, value: 0, max: 0 }).catch(
      () => undefined
    )

  // Stopping the service is how a running caption job is canceled
  control.cancel = async () => service.stop()
  if (control.isCanceled) throw new CanceledError()

  report("Starting the caption engine")
  await claimGpu(service)
  await service.start()
  if (control.isCanceled) throw new CanceledError()

  let caption: Media.Caption | null = null

  try {
    const events = service.stream<CaptionEvent>("/caption", {
      model: params.model,
      image: imagePath,
      mode: params.mode,
      style: params.style,
      prompt: job.prompt
    })

    for await (const event of events) {
      switch (event.event) {
        case "loading":
          report("Loading the caption model")
          break
        case "reading":
          report("Describing the image")
          break
        case "done":
          caption = {
            description: event.description,
            positive: event.positive,
            negative: event.negative
          }
          break
        case "error":
          throw new Error(event.message)
      }
    }
  } catch (error) {
    // Stopping the service is how a cancel lands, and it surfaces here as a dropped connection
    if (control.isCanceled) throw new CanceledError()
    throw error
  }

  if (control.isCanceled) throw new CanceledError()
  if (!caption?.description) {
    throw new Error("The caption engine stopped before it described the image")
  }

  await db.update(schema.jobs).set({ result: caption }).where(eq(schema.jobs.id, job.id))
}
