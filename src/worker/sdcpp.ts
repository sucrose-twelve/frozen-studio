import { spawn, spawnSync, type ChildProcess } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

import { IMAGE_FAMILY_SAMPLING, IMAGE_TURBO, MEDIA_FOLDER } from "@/constants"
import { COMFY, SDCPP } from "@/constants/env"
import { db, schema } from "@/drizzle"
import type { AssetInsertValues, Job } from "@/drizzle/types"
import { IMAGE_VAE, isImageTextEncoder } from "@/libs/comfy/discover"
import { imageFamily, isGgufFile, isTurboImageModel } from "@/libs/image-model"
import { readPngFileSize } from "@/libs/media"
import { publishEvent } from "@/libs/queue"

import { CanceledError } from "./comfy-socket"
import type { RunControl } from "./process"
import { claimGpu } from "./service"

/**
 * Model folders change rarely (a download, a delete), and walking them is disk work: the list is kept for
 * this long, as the worker keeps ComfyUI's.
 */
const SCAN_TTL_MS = 30_000

/**
 * How far below a model folder files are looked for. ComfyUI's models folder keeps its files one or two
 * levels down (`text_encoders/…`, sometimes a subfolder more).
 */
const SCAN_DEPTH = 3

const MODEL_FILE = /\.(gguf|safetensors)$/i

/**
 * The escape codes the program ends its progress lines with.
 */
const ANSI_CODES = /\u001b\[[0-9;]*[A-Za-z]/g

/**
 * A sampling or decoding progress bar: `|=====>     | 3/8 - 1.98it/s`. The bars drawn with `#` are files
 * being read and say nothing about the image.
 */
const PROGRESS_BAR = /^\s*\|[=>\s]*\|\s*(\d+)\/(\d+)/

/**
 * The form's samplers by the names this program gives them.
 */
const SAMPLER_NAMES: Record<Media.ImageSampler, string> = {
  euler_ancestral: "euler_a",
  euler: "euler",
  dpmpp_2m: "dpm++2m",
  er_sde: "er_sde"
}

/**
 * What a line of the program's log says about where the job is, as a progress label. `null` for the many
 * lines that say nothing of the kind.
 */
function stageLabel(line: string) {
  if (/loading diffusion model/.test(line)) return "Loading the models"
  if (/sampling using/.test(line)) return "Reading the prompt"
  if (/decoding \d+ latents/.test(line)) return "Decoding the image"
  if (/save result image/.test(line)) return "Saving"

  const image = /generating image: (\d+)\/(\d+)/.exec(line)
  if (!image) return null
  return Number(image[2]) > 1 ? `Painting · ${image[1]} / ${image[2]}` : "Painting"
}

let scan: { at: number; files: Map<string, string> } | null = null
let child: ChildProcess | null = null

/**
 * Every model file in the folders stable-diffusion.cpp may read (`SDCPP_MODEL_DIRS`), by file name. A name
 * found twice keeps the first place it was found.
 */
function modelFiles() {
  if (scan && Date.now() - scan.at < SCAN_TTL_MS) return scan.files

  const files = new Map<string, string>()
  const walk = (folder: string, depth: number) => {
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(folder, { withFileTypes: true })
    } catch {
      return
    }

    for (const entry of entries) {
      const entryPath = path.join(folder, entry.name)
      if (entry.isDirectory()) {
        if (depth < SCAN_DEPTH) walk(entryPath, depth + 1)
      } else if (MODEL_FILE.test(entry.name) && !files.has(entry.name)) {
        files.set(entry.name, entryPath)
      }
    }
  }
  for (const folder of SDCPP.modelDirs) walk(path.resolve(folder), 1)

  scan = { at: Date.now(), files }
  return files
}

/**
 * The GGUF files in the program's folders, by name. Empty when the program isn't installed.
 */
function ggufFiles() {
  if (!fs.existsSync(path.resolve(SDCPP.cli))) return []

  return [...modelFiles().keys()].filter(isGgufFile).sort((a, b) => a.localeCompare(b))
}

/**
 * Adds what stable-diffusion.cpp can run to the image models ComfyUI reported:
 *
 * - For Qwen-Image 2.1, the text encoders only it can read (Qwen3-VL 8B as a GGUF), after ComfyUI's own
 *   so the default stays the same, and only when the VAE is in its folders too. Which models they go
 *   with is `textEncodersFor`'s to say.
 * - The Iris family, which runs nowhere else: its models, and Qwen3-VL in the 4B size as its text
 *   encoder. It has no VAE and no LoRAs.
 */
export function withSdCppModels(image: Engine.Models["image"]): Engine.Models["image"] {
  const files = ggufFiles()
  if (files.length === 0) return image

  const isTextEncoder = (name: string) => /qwen3.?vl/i.test(name) && !/mmproj/i.test(name)
  const hasVae = [...modelFiles().keys()].some((name) => IMAGE_VAE.test(name))
  const qwenTextEncoders = hasVae ? files.filter(isImageTextEncoder) : []
  const irisModels = files.filter(
    (name) => imageFamily(name) === "iris" && !isTextEncoder(name)
  )
  const irisTextEncoders = files.filter(
    (name) => isTextEncoder(name) && /(?:^|\D)4b/i.test(name)
  )

  const result: NonNullable<Engine.Models["image"]> = { ...image }
  if (result.qwen && qwenTextEncoders.length > 0) {
    result.qwen = {
      ...result.qwen,
      textEncoders: [...result.qwen.textEncoders, ...qwenTextEncoders]
    }
  }
  if (irisModels.length > 0 && irisTextEncoders.length > 0) {
    result.iris = {
      models: irisModels,
      textEncoders: irisTextEncoders,
      vae: null,
      loras: [],
      editLora: null
    }
  }

  return Object.keys(result).length > 0 ? result : null
}

/**
 * Stops the program at once, which is also how a running job is canceled. `taskkill /T` takes anything it
 * started along with it.
 */
export function stopSdCpp() {
  if (!child) return

  if (process.platform === "win32" && child.pid) {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true })
  } else {
    child.kill()
  }
  child = null
}

/**
 * Runs an image job on stable-diffusion.cpp: one run of `sd-cli`, which loads the models, draws every image
 * of the job and exits, so nothing of it stays in VRAM afterwards.
 *
 * Two kinds of model are set up, the two that were tried:
 *
 * - Turbo builds of Qwen-Image 2.1, on the fixed schedule of `IMAGE_TURBO`, which is what the GGUF text
 *   encoders are published for. The job's own steps, CFG and sampler are not used.
 * - Iris, with the job's steps, CFG, sampler and negative prompt. It draws pixels directly, so there is
 *   no VAE to pass.
 *
 * And for both:
 *
 * - The images are decoded in one piece. With `--vae-tiling` the same decode took 16 seconds instead of 2
 *   on a 16 GB card, and the largest size the form offers fits without it.
 * - A batch gets consecutive seeds, starting from the job's.
 *
 * @param job - An image job already marked `running`
 * @param control - Gets a way to stop the run; a cancel that arrived earlier is honoured
 * @throws {CanceledError} When the run was canceled
 * @throws {Error} When a file is missing, the program fails, or it wrote fewer images than asked for
 */
export async function runSdCppJob(
  job: Job,
  params: Media.ImageParams,
  control: RunControl
) {
  const family = imageFamily(params.model)
  const isTurbo = isTurboImageModel(params.model)
  if (
    (family !== "iris" && !isTurbo) ||
    params.width === null ||
    params.height === null
  ) {
    throw new Error(
      "stable-diffusion.cpp is only set up for new images, on Iris and on Turbo models of Qwen-Image 2.1"
    )
  }

  const files = modelFiles()
  const locate = (name: string | undefined, what: string) => {
    const found = name ? files.get(name) : undefined
    if (!found) {
      throw new Error(
        `stable-diffusion.cpp can't find the ${what}${name ? ` (${name})` : ""} in its model folders (SDCPP_MODEL_DIRS)`
      )
    }
    return found
  }
  const model = locate(params.model, "image model")
  const textEncoder = locate(params.textEncoder, "text encoder")
  const negative = params.negative.trim()
  const sampling = isTurbo
    ? [
        "--vae",
        locate(
          [...files.keys()].find((name) => IMAGE_VAE.test(name)),
          "Qwen-Image 2.1 VAE"
        ),
        "--sigmas",
        IMAGE_TURBO.sigmas.join(","),
        "--steps",
        String(IMAGE_TURBO.steps),
        "--cfg-scale",
        String(IMAGE_TURBO.cfg),
        "--sampling-method",
        SAMPLER_NAMES[IMAGE_TURBO.sampler]
      ]
    : [
        "--steps",
        String(params.steps),
        "--cfg-scale",
        String(params.cfg),
        "--sampling-method",
        SAMPLER_NAMES[params.sampler ?? IMAGE_FAMILY_SAMPLING[family].samplers.create],
        ...(negative ? ["-n", negative] : [])
      ]

  let label = "Starting stable-diffusion.cpp"
  const report = (value = 0, max = 0) =>
    void publishEvent({ type: "progress", id: job.id, label, value, max }).catch(
      () => undefined
    )

  control.cancel = async () => stopSdCpp()
  if (control.isCanceled) throw new CanceledError()

  report()
  // It loads its own copies of the models, so everything else gives the card back first
  await claimGpu(null)
  if (control.isCanceled) throw new CanceledError()

  const folder = path.resolve(COMFY.outputDir, MEDIA_FOLDER, job.id)
  await fs.promises.mkdir(folder, { recursive: true })
  // The same names ComfyUI's SaveImage gives: image_00001_.png, image_00002_.png
  const fileName = (index: number) => `image_${String(index + 1).padStart(5, "0")}_.png`

  const cli = path.resolve(SDCPP.cli)
  const started = spawn(
    cli,
    [
      "--diffusion-model",
      model,
      "--llm",
      textEncoder,
      ...sampling,
      "-W",
      String(params.width),
      "-H",
      String(params.height),
      "-b",
      String(params.count),
      "-s",
      String(params.seed),
      "-p",
      job.prompt,
      "-o",
      path.join(folder, "image_%05d_.png"),
      "--output-begin-idx",
      "1"
    ],
    // Its libraries sit beside it
    { cwd: path.dirname(cli), stdio: ["ignore", "pipe", "pipe"], windowsHide: true }
  )
  child = started

  // What it said last, to explain a run that failed
  let recentLines: string[] = []
  let buffered = ""
  const read = (chunk: Buffer) => {
    // Progress bars redraw themselves with a carriage return, so that ends a line too
    const lines = (buffered + chunk.toString("utf8")).split(/[\r\n]/)
    buffered = lines.pop() ?? ""

    for (const raw of lines) {
      const line = raw.replace(ANSI_CODES, "").trimEnd()
      if (!line.trim()) continue

      const bar = PROGRESS_BAR.exec(line)
      if (bar) {
        report(Number(bar[1]), Number(bar[2]))
        continue
      }
      if (/^\s*\|/.test(line)) continue

      recentLines = [...recentLines, line].slice(-12)
      const next = stageLabel(line)
      if (next) {
        label = next
        report()
      }
    }
  }
  started.stdout?.on("data", read)
  started.stderr?.on("data", read)

  const exitCode = await new Promise<number | null>((resolve) => {
    started.on("error", (error) => {
      recentLines = [...recentLines, error.message]
      resolve(null)
    })
    started.on("close", (code) => resolve(code))
  })
  if (child === started) child = null

  if (control.isCanceled) throw new CanceledError()
  if (exitCode !== 0) {
    const errors = recentLines.filter((line) => /\[E\]|error/i.test(line))
    throw new Error(
      ["stable-diffusion.cpp failed.", ...(errors.length > 0 ? errors : recentLines)]
        .join("\n")
        .slice(0, 2_000)
    )
  }

  const assets: AssetInsertValues[] = []
  for (let index = 0; index < params.count; index++) {
    const filePath = path.join(folder, fileName(index))
    const stats = await fs.promises.stat(filePath).catch(() => null)
    if (!stats) continue

    const size = await readPngFileSize(filePath)
    assets.push({
      jobId: job.id,
      kind: "image",
      role: "output",
      root: "output",
      path: `${MEDIA_FOLDER}/${job.id}/${fileName(index)}`,
      mime: "image/png",
      width: size?.width ?? params.width,
      height: size?.height ?? params.height,
      size: stats.size,
      position: index
    })
  }
  if (assets.length < params.count) {
    throw new Error("stable-diffusion.cpp finished without writing every image")
  }

  await db.insert(schema.assets).values(assets)
}
