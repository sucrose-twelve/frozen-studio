import fs from "node:fs"

import { asc, eq } from "drizzle-orm"
import { pick } from "es-toolkit"

import { db, schema } from "@/drizzle"
import { assetColumns } from "@/drizzle/table-columns"
import type { AssetInsertValues, Job } from "@/drizzle/types"
import {
  cancelPrompt,
  queuePrompt,
  type ComfyFile,
  type ComfyHistory
} from "@/libs/comfy/client"
import type { BuiltGraph, GraphOutput } from "@/libs/comfy/graphs/builder"
import { buildCutoutGraph } from "@/libs/comfy/graphs/cutout"
import { buildImageGraph } from "@/libs/comfy/graphs/image"
import { buildVideoGraph } from "@/libs/comfy/graphs/video"
import { imageEngine } from "@/libs/image-model"
import { assetFilePath, comfyImageName, mimeTypeOf, readPngFileSize } from "@/libs/media"
import { publishEvent } from "@/libs/queue"
import { videoFamily } from "@/libs/video-model"
import { aspectRatioOf, videoSize } from "@/libs/video-plan"

import { runCaptionJob } from "./caption"
import { clientId, watchPrompt } from "./comfy-socket"
import { currentModels } from "./engine"
import { runSdCppJob } from "./sdcpp"
import { claimGpu } from "./service"
import { runVoiceJob } from "./voice"

/**
 * The job being run, shared with the control listener so a cancel request can reach whatever runs it.
 */
export type RunControl = {
  jobId: string
  /**
   * Stops the run. Set by the engine once there is something to stop; until then `isCanceled` is the
   * only signal, and the engine checks it before it starts.
   */
  cancel: (() => Promise<void>) | null
  isCanceled: boolean
}

type Size = {
  width: number
  height: number
}

/**
 * Whether a job runs on ComfyUI, and so has to wait for it to be up. Voice and caption jobs have services
 * of their own, and an image job with a GGUF text encoder runs on stable-diffusion.cpp.
 */
export function runsOnComfy(params: Media.JobParams) {
  if (params.kind === "voice" || params.kind === "caption") return false
  return params.kind !== "image" || imageEngine(params.textEncoder) === "comfy"
}

/**
 * The files a save node reported. `SaveImage` lists them under `images`; the video nodes use the same shape
 * under their own key, so any list of `{ filename }` counts.
 */
function filesOf(nodeOutput: Record<string, unknown> | undefined) {
  if (!nodeOutput) return []

  const list = Object.values(nodeOutput).find(
    (value): value is ComfyFile[] =>
      Array.isArray(value) &&
      value.length > 0 &&
      typeof (value[0] as ComfyFile | null)?.filename === "string"
  )
  return list ?? []
}

/**
 * Turns the files ComfyUI wrote into asset rows, in the order the save nodes listed them.
 *
 * @param videoSize - The frame size of the job's video; images are measured from their PNG header
 */
async function collectAssets(
  jobId: string,
  outputs: GraphOutput[],
  history: ComfyHistory,
  videoSize: Size | null
) {
  const rows: AssetInsertValues[] = []

  for (const output of outputs) {
    const files = filesOf(history.outputs?.[output.nodeId])

    for (const [position, file] of files.entries()) {
      const relativePath = [file.subfolder.replaceAll("\\", "/"), file.filename]
        .filter(Boolean)
        .join("/")
      const filePath = assetFilePath({ root: "output", path: relativePath })
      if (!filePath) continue

      const stats = await fs.promises.stat(filePath)
      const size = output.kind === "image" ? await readPngFileSize(filePath) : videoSize

      rows.push({
        jobId,
        kind: output.kind,
        role: output.role,
        root: "output",
        path: relativePath,
        mime: mimeTypeOf(relativePath) ?? "application/octet-stream",
        width: size?.width ?? 0,
        height: size?.height ?? 0,
        size: stats.size,
        position
      })
    }
  }

  return rows
}

/**
 * Runs one job and saves what it produced: voice jobs on the text-to-speech service, caption jobs on the
 * captioning service, image jobs with a GGUF text encoder on stable-diffusion.cpp, everything else on
 * ComfyUI. Status changes are the caller's.
 *
 * @param job - A job already marked `running`
 * @param control - Receives the way to stop the run; a cancel that arrived earlier is honoured
 * @throws {CanceledError} When the run was canceled
 * @throws {Error} When a model is missing, the engine rejects or fails the job, or nothing was written
 */
export async function processJob(job: Job, control: RunControl) {
  if (job.params.kind === "voice") return runVoiceJob(job, job.params, control)
  if (job.params.kind === "caption") return runCaptionJob(job, job.params, control)
  if (job.params.kind === "image" && imageEngine(job.params.textEncoder) === "sdcpp") {
    return runSdCppJob(job, job.params, control)
  }

  // ComfyUI's models need the whole card, so the services' models give their VRAM back first
  await claimGpu("comfy")

  const inputs = await db
    .select(pick(assetColumns, ["id", "root", "path", "width", "height"]))
    .from(schema.jobInputs)
    .innerJoin(schema.assets, eq(schema.assets.id, schema.jobInputs.assetId))
    .where(eq(schema.jobInputs.jobId, job.id))
    .orderBy(asc(schema.jobInputs.position))
  const references = inputs.map((input) => ({ imageName: comfyImageName(input) }))
  const models = await currentModels()

  let built: BuiltGraph
  let frameSize: Size | null = null

  switch (job.params.kind) {
    case "image":
      built = buildImageGraph({
        jobId: job.id,
        prompt: job.prompt,
        params: job.params,
        references,
        models
      })
      break
    case "video": {
      const first = inputs[0]
      const aspectRatio = first
        ? first.width / first.height
        : aspectRatioOf(job.params.aspect)

      frameSize = videoSize(
        job.params.resolution,
        aspectRatio,
        videoFamily(job.params.model)
      )
      built = buildVideoGraph({
        jobId: job.id,
        prompt: job.prompt,
        params: job.params,
        references,
        aspectRatio,
        models
      })
      break
    }
    case "cutout": {
      const [reference] = references
      if (!reference) throw new Error("A cutout job needs an image")

      built = buildCutoutGraph({ jobId: job.id, reference, models })
      break
    }
  }

  const promptId = await queuePrompt(built.graph, clientId)
  control.cancel = () => cancelPrompt(promptId)
  if (control.isCanceled) await cancelPrompt(promptId)

  let label = "Starting"
  const report = (value: number, max: number) =>
    void publishEvent({ type: "progress", id: job.id, label, value, max }).catch(
      () => undefined
    )

  const history = await watchPrompt(
    promptId,
    (nodeId) => {
      label = built.labels[nodeId] ?? label
      report(0, 0)
    },
    (nodeId, value, max) => {
      if (nodeId) label = built.labels[nodeId] ?? label
      report(value, max)
    }
  )

  const assets = await collectAssets(job.id, built.outputs, history, frameSize)
  if (assets.length === 0) throw new Error("ComfyUI finished without writing any files")

  await db.insert(schema.assets).values(assets)
}
