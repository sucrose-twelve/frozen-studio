import {
  IMAGE_FAMILY_SAMPLING,
  IMAGE_SIZES,
  STATIC_CAMERA_PROMPT,
  VIDEO_FPS,
  WAN_NEGATIVE_PROMPT
} from "@/constants"
import { imageFamily } from "@/libs/image-model"
import { planSegments, videoSize } from "@/libs/video-plan"

import {
  GraphBuilder,
  type BuiltGraph,
  type GraphReference,
  type NodeRef
} from "./builder"
import { addImage } from "./image"
import { loadReference, outputPrefix, removeBackground } from "./shared"

/**
 * The workflow of a video job, on Wan 2.2 image-to-video (two models: high noise draws the motion, low noise
 * refines the detail).
 *
 * - With references, they are the keyframes. Without, Qwen-Image draws the first frame from the prompt and
 *   the video starts there; that image is saved too (`still`).
 * - All passes run in this one workflow, so the models load once, and the result is a single MP4.
 * - `shouldSaveFrames` also saves every frame as a PNG for sprite sheets, cut out when
 *   `shouldRemoveBackground` is set. The MP4 itself always keeps the background: H.264 has no alpha.
 *
 * @param input.aspectRatio - Width divided by height of the first keyframe (or of `params.aspect`)
 * @throws {Error} When a model the job needs isn't installed
 */
export function buildVideoGraph(input: {
  jobId: string
  prompt: string
  params: Media.VideoParams
  references: GraphReference[]
  aspectRatio: number
  models: Engine.Models
}): BuiltGraph {
  const { jobId, prompt, params, references, aspectRatio, models } = input
  const video = models.video
  if (!video) throw new Error("The video models aren't installed in ComfyUI")

  // A job from before there was a choice names no model and runs on the first pair
  const model = params.model
    ? video.models.find((pair) => pair.name === params.model)
    : video.models[0]
  if (!model) throw new Error(`The video model ${params.model} isn't installed any more`)

  const builder = new GraphBuilder()

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
    {
      clip: textEncoder,
      text: params.isStaticCamera ? `${prompt} ${STATIC_CAMERA_PROMPT}` : prompt
    },
    "Reading the prompt"
  )
  // What the user wants kept out goes in front of Wan's own list, which stays: it is what holds off the
  // blur, the extra fingers and the frozen frames
  const negative = builder.add("CLIPTextEncode", {
    clip: textEncoder,
    text: [params.negative?.trim(), WAN_NEGATIVE_PROMPT].filter(Boolean).join(", ")
  })

  const segments = planSegments(params.seconds, keyframes.length, params.isLoop)
  const size = videoSize(params.resolution, aspectRatio)
  // The high-noise model takes the first half of the steps, the low-noise model the rest
  const split = Math.max(1, Math.floor(params.steps / 2))
  const parts: NodeRef[] = []
  let previousLast: NodeRef | null = null

  segments.forEach((segment, index) => {
    // "Part 2/3: drawing the motion", or just "Drawing the motion" for a single pass
    const label = (text: string) =>
      segments.length > 1
        ? `Part ${index + 1}/${segments.length}: ${text}`
        : text.charAt(0).toUpperCase() + text.slice(1)
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
      negative: [conditioning[0], 1] satisfies NodeRef
    }
    const motion = builder.add(
      "KSamplerAdvanced",
      {
        ...sampling,
        model: highNoise,
        add_noise: "enable",
        noise_seed: params.seed + index,
        latent_image: [conditioning[0], 2] satisfies NodeRef,
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

    parts.push(
      index === 0
        ? frames
        : builder.add("ImageFromBatch", { image: frames, batch_index: 1, length: 4096 })
    )
  })

  const allFrames =
    parts.length > 1
      ? builder.add(
          "BatchImagesNode",
          Object.fromEntries(parts.map((part, index) => [`images.image${index}`, part])),
          "Joining the parts"
        )
      : parts[0]

  const created = builder.add(
    "CreateVideo",
    { images: allFrames, fps: VIDEO_FPS },
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
