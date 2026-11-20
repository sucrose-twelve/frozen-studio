import {
  IMAGE_FAMILY_SAMPLING,
  IMAGE_SIZES,
  STATIC_CAMERA_PROMPT,
  VIDEO_FAMILY_SETTINGS,
  WAN_NEGATIVE_PROMPT
} from "@/constants"
import { imageFamily, isGgufFile } from "@/libs/image-model"
import { videoFamily } from "@/libs/video-model"
import { planSegments, videoSize } from "@/libs/video-plan"

import {
  GraphBuilder,
  output,
  type BuiltGraph,
  type GraphReference,
  type NodeRef
} from "./builder"
import { addImage } from "./image"
import { loadReference, outputPrefix, removeBackground } from "./shared"

type VideoInput = {
  jobId: string
  prompt: string
  params: Media.VideoParams
  references: GraphReference[]
  aspectRatio: number
  models: Engine.Models
}

/**
 * The progress text of one pass: "Part 2/3: drawing the motion", or just "Drawing the motion" for a single
 * pass.
 */
function passLabel(index: number, passes: number, text: string) {
  return passes > 1
    ? `Part ${index + 1}/${passes}: ${text}`
    : text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The prompt as the model gets it: with the request for a camera that stays put when that is switched on.
 */
function videoPrompt(prompt: string, params: Media.VideoParams) {
  return params.isStaticCamera ? `${prompt} ${STATIC_CAMERA_PROMPT}` : prompt
}

/**
 * Joins the passes of a video into one batch of frames. Every pass after the first starts on the last
 * frame of the one before, so that repeated frame is dropped.
 */
function joinPasses(builder: GraphBuilder, passes: NodeRef[]) {
  if (passes.length === 1) return passes[0]

  const parts = passes.map((frames, index) =>
    index === 0
      ? frames
      : builder.add("ImageFromBatch", { image: frames, batch_index: 1, length: 4096 })
  )

  return builder.add(
    "BatchImagesNode",
    Object.fromEntries(parts.map((part, index) => [`images.image${index}`, part])),
    "Joining the parts"
  )
}

/**
 * The frames of a video on Wan 2.2 image-to-video (two models: high noise draws the motion, low noise
 * refines the detail).
 *
 * With references, they are the keyframes. Without, the image model draws the first frame from the prompt
 * and the video starts there; that image is saved too (`still`).
 *
 * @returns The decoded frames of the whole video
 * @throws {Error} When a model the job needs isn't installed
 */
function addWanFrames(builder: GraphBuilder, input: VideoInput): NodeRef {
  const { jobId, prompt, params, references, aspectRatio, models } = input
  const video = models.video?.wan
  if (!video) throw new Error("The Wan 2.2 video models aren't installed in ComfyUI")

  // A job from before there was a choice names no model and runs on the first pair
  const model = params.model
    ? video.models.find((pair) => pair.name === params.model)
    : video.models[0]
  if (!model) throw new Error(`The video model ${params.model} isn't installed any more`)

  let keyframes: NodeRef[]
  if (references.length > 0) {
    keyframes = references.map((reference, index) =>
      loadReference(builder, reference, `Reading image ${index + 1}`)
    )
  } else {
    if (!params.imageModel) {
      throw new Error("Text-to-video needs the image model to draw the first frame")
    }

    const [width, height] = IMAGE_SIZES[params.aspect].standard
    const sampling = IMAGE_FAMILY_SAMPLING[imageFamily(params.imageModel)]
    const still = addImage(builder, models.image, {
      model: params.imageModel,
      textEncoder: null,
      prompt,
      negative: "",
      references: [],
      size: { width, height },
      count: 1,
      steps: sampling.steps,
      cfg: sampling.cfg,
      sampler: null,
      lora: null,
      seed: params.seed
    })
    const savedStill = builder.add("SaveImage", {
      images: still,
      filename_prefix: outputPrefix(jobId, "still")
    })
    builder.output(savedStill, "still", "image")
    keyframes = [still]
  }

  const isFast = params.isFast && !!video.fastHighNoise && !!video.fastLowNoise
  let highNoise = builder.add(
    "UnetLoaderGGUF",
    { unet_name: model.highNoise },
    "Loading the video model (motion)"
  )
  let lowNoise = builder.add(
    "UnetLoaderGGUF",
    { unet_name: model.lowNoise },
    "Loading the video model (detail)"
  )
  if (isFast) {
    highNoise = builder.add("LoraLoaderModelOnly", {
      model: highNoise,
      lora_name: video.fastHighNoise,
      strength_model: 1
    })
    lowNoise = builder.add("LoraLoaderModelOnly", {
      model: lowNoise,
      lora_name: video.fastLowNoise,
      strength_model: 1
    })
  }
  highNoise = builder.add("ModelSamplingSD3", { model: highNoise, shift: 5 })
  lowNoise = builder.add("ModelSamplingSD3", { model: lowNoise, shift: 5 })

  const textEncoder = builder.add(
    "CLIPLoader",
    { clip_name: video.textEncoder, type: "wan", device: "default" },
    "Loading the text encoder"
  )
  const vae = builder.add("VAELoader", { vae_name: video.vae })
  const positive = builder.add(
    "CLIPTextEncode",
    { clip: textEncoder, text: videoPrompt(prompt, params) },
    "Reading the prompt"
  )
  // What the user wants kept out goes in front of Wan's own list, which stays: it is what holds off the
  // blur, the extra fingers and the frozen frames
  const negative = builder.add("CLIPTextEncode", {
    clip: textEncoder,
    text: [params.negative?.trim(), WAN_NEGATIVE_PROMPT].filter(Boolean).join(", ")
  })

  const segments = planSegments(
    params.seconds,
    keyframes.length,
    params.isLoop,
    "wan",
    params.resolution
  )
  const size = videoSize(params.resolution, aspectRatio, "wan")
  // The high-noise model takes the first half of the steps, the low-noise model the rest
  const split = Math.max(1, Math.floor(params.steps / 2))
  const passes: NodeRef[] = []
  let previousLast: NodeRef | null = null

  segments.forEach((segment, index) => {
    const label = (text: string) => passLabel(index, segments.length, text)
    const start = segment.from === null ? previousLast : keyframes[segment.from]

    const conditioning = builder.add(
      segment.end === null ? "WanImageToVideo" : "WanFirstLastFrameToVideo",
      {
        positive,
        negative,
        vae,
        width: size.width,
        height: size.height,
        length: segment.frames,
        batch_size: 1,
        start_image: start,
        ...(segment.end === null ? {} : { end_image: keyframes[segment.end] })
      },
      label("preparing")
    )
    const sampling = {
      steps: params.steps,
      cfg: params.cfg,
      sampler_name: "euler",
      scheduler: "simple",
      positive: conditioning,
      negative: output(conditioning, 1)
    }
    const motion = builder.add(
      "KSamplerAdvanced",
      {
        ...sampling,
        model: highNoise,
        add_noise: "enable",
        noise_seed: params.seed + index,
        latent_image: output(conditioning, 2),
        start_at_step: 0,
        end_at_step: split,
        return_with_leftover_noise: "enable"
      },
      label("drawing the motion")
    )
    const detail = builder.add(
      "KSamplerAdvanced",
      {
        ...sampling,
        model: lowNoise,
        add_noise: "disable",
        noise_seed: 0,
        latent_image: motion,
        start_at_step: split,
        end_at_step: params.steps,
        return_with_leftover_noise: "disable"
      },
      label("refining the detail")
    )
    const frames = builder.add(
      "VAEDecode",
      { samples: detail, vae },
      label("decoding the frames")
    )

    const next = segments[index + 1]
    if (next && next.from === null) {
      previousLast = builder.add("ImageFromBatch", {
        image: frames,
        batch_index: -1,
        length: 1
      })
    }

    passes.push(frames)
  })

  return joinPasses(builder, passes)
}

/**
 * The most pixels (frames × width × height) LTX's VAE decodes in one go on a 16 GB card: 5 seconds at 480p,
 * which took 35 seconds in all. Twice that spilled into shared memory and the decode alone was still
 * running after 8 minutes, with ComfyUI deaf to an interrupt.
 */
const LTX_WHOLE_DECODE_PIXELS = 121 * 832 * 480

/**
 * How a larger LTX video is decoded: in tiles of this size in space and time, the sizes its release's own
 * workflows use. Slower for a short clip (5 seconds at 480p: 64 seconds instead of 35), but 10 seconds at
 * 480p and 5 at 720p each finish in about 100. No seams showed in either.
 */
const LTX_DECODE_TILES = {
  tile_size: 512,
  overlap: 64,
  temporal_size: 64,
  temporal_overlap: 16
} as const

/**
 * The frames of a video on LTX 2.5: from the prompt alone, or starting on one image.
 *
 * - The model also makes sound, as a second latent beside the video's. That one is left out: sampling
 *   the video latent alone gave the same picture (tried with one seed both ways), needs no audio VAE, and
 *   Frozen's videos are silent.
 * - The first frame is written into the latent at full strength, so the video opens on exactly the image
 *   it was given: a sprite sheet's first frame is the artwork itself.
 * - It is a distilled build, sampled with `euler` on the `simple` schedule at CFG 1, as its release's own
 *   workflows do. CFG 1 never reads the negative prompt, so it is left empty.
 * - A video longer than one pass is chained like Wan's: each pass starts on the last frame of the one
 *   before.
 *
 * @returns The decoded frames of the whole video
 * @throws {Error} When a model the job needs isn't installed
 */
function addLtxFrames(builder: GraphBuilder, input: VideoInput): NodeRef {
  const { prompt, params, references, aspectRatio, models } = input
  const video = models.video?.ltx
  if (!video) throw new Error("The LTX 2.5 video models aren't installed in ComfyUI")

  const modelFile = video.models.find((name) => name === params.model)
  if (!modelFile) {
    throw new Error(`The video model ${params.model} isn't installed any more`)
  }

  const [reference] = references
  const firstFrame = reference
    ? loadReference(builder, reference, "Reading the image")
    : null

  const model = isGgufFile(modelFile)
    ? builder.add("UnetLoaderGGUF", { unet_name: modelFile }, "Loading the video model")
    : builder.add(
        "UNETLoader",
        { unet_name: modelFile, weight_dtype: "default" },
        "Loading the video model"
      )
  const textEncoder = builder.add(
    "CLIPLoader",
    { clip_name: video.textEncoder, type: "ltxv", device: "default" },
    "Loading the text encoder"
  )
  const vae = builder.add("VAELoader", { vae_name: video.vae })
  const positive = builder.add(
    "CLIPTextEncode",
    { clip: textEncoder, text: videoPrompt(prompt, params) },
    "Reading the prompt"
  )
  const negative = builder.add("CLIPTextEncode", { clip: textEncoder, text: "" })
  // The model is told the frame rate it is drawing for
  const conditioning = builder.add("LTXVConditioning", {
    positive,
    negative,
    frame_rate: VIDEO_FAMILY_SETTINGS.ltx.fps
  })

  const segments = planSegments(
    params.seconds,
    references.length,
    false,
    "ltx",
    params.resolution
  )
  const size = videoSize(params.resolution, aspectRatio, "ltx")
  const passes: NodeRef[] = []
  let previousLast: NodeRef | null = null

  segments.forEach((segment, index) => {
    const label = (text: string) => passLabel(index, segments.length, text)
    const start = segment.from === null ? previousLast : firstFrame

    const empty = builder.add("EmptyLTXVLatentVideo", {
      width: size.width,
      height: size.height,
      length: segment.frames,
      batch_size: 1
    })
    const latent = start
      ? builder.add(
          "LTXVImgToVideoInplace",
          { vae, image: start, latent: empty, strength: 1, bypass: false },
          label("preparing")
        )
      : empty
    const sampled = builder.add(
      "KSampler",
      {
        model,
        seed: params.seed + index,
        steps: params.steps,
        cfg: params.cfg,
        sampler_name: "euler",
        scheduler: "simple",
        positive: conditioning,
        negative: output(conditioning, 1),
        latent_image: latent,
        denoise: 1
      },
      label("drawing the frames")
    )
    const frames =
      segment.frames * size.width * size.height <= LTX_WHOLE_DECODE_PIXELS
        ? builder.add(
            "VAEDecode",
            { samples: sampled, vae },
            label("decoding the frames")
          )
        : builder.add(
            "VAEDecodeTiled",
            { samples: sampled, vae, ...LTX_DECODE_TILES },
            label("decoding the frames")
          )

    if (segments[index + 1]) {
      previousLast = builder.add("ImageFromBatch", {
        image: frames,
        batch_index: -1,
        length: 1
      })
    }

    passes.push(frames)
  })

  return joinPasses(builder, passes)
}

/**
 * The workflow of a video job, on the family of its model: Wan 2.2 (`addWanFrames`) or LTX 2.5
 * (`addLtxFrames`).
 *
 * - All passes run in this one workflow, so the models load once, and the result is a single MP4 at the
 *   family's frame rate.
 * - `shouldSaveFrames` also saves every frame as a PNG for sprite sheets, cut out when
 *   `shouldRemoveBackground` is set. The MP4 itself always keeps the background: H.264 has no alpha.
 *
 * @param input.aspectRatio - Width divided by height of the first keyframe (or of `params.aspect`)
 * @throws {Error} When a model the job needs isn't installed
 */
export function buildVideoGraph(input: VideoInput): BuiltGraph {
  const { jobId, params, models } = input
  if (!models.video) throw new Error("The video models aren't installed in ComfyUI")

  const family = videoFamily(params.model)
  const builder = new GraphBuilder()
  const allFrames =
    family === "ltx" ? addLtxFrames(builder, input) : addWanFrames(builder, input)

  const created = builder.add(
    "CreateVideo",
    { images: allFrames, fps: VIDEO_FAMILY_SETTINGS[family].fps },
    "Encoding the video"
  )
  const saved = builder.add(
    "SaveVideo",
    {
      "video": created,
      "filename_prefix": outputPrefix(jobId, "video"),
      "format": "mp4",
      "format.codec": "auto"
    },
    "Saving the video"
  )
  builder.output(saved, "output", "video")

  if (params.shouldSaveFrames) {
    const frames =
      params.shouldRemoveBackground && models.cutout
        ? removeBackground(
            builder,
            allFrames,
            models.cutout.model,
            "Removing the background of every frame"
          )
        : allFrames
    const savedFrames = builder.add(
      "SaveImage",
      { images: frames, filename_prefix: outputPrefix(jobId, "frames/frame") },
      "Saving the frames"
    )
    builder.output(savedFrames, "frame", "image")
  }

  return builder.build()
}
