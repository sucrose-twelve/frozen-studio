import type {
  CaptionValidator,
  ImageValidator,
  VideoValidator,
  VoiceValidator
} from "@/actions/jobs/validator.zod"
import { IMAGE_SIZES, VIDEO_SAMPLING } from "@/constants"

/**
 * A fresh seed under 2^48, the range the validators accept.
 */
export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 48)
}

/**
 * Turns a validated image form into the parameters stored with the job: the pixel size behind the aspect and
 * tier, and a seed when none was given.
 */
export function toImageParams(input: ImageValidator): Media.ImageParams {
  const size = input.aspect ? IMAGE_SIZES[input.aspect][input.tier] : null

  return {
    kind: "image",
    model: input.model,
    negative: input.negative,
    aspect: input.aspect,
    tier: input.tier,
    width: size?.[0] ?? null,
    height: size?.[1] ?? null,
    count: input.count,
    steps: input.steps,
    cfg: input.cfg,
    sampler: input.sampler,
    seed: input.seed ?? randomSeed(),
    shouldRemoveBackground: input.shouldRemoveBackground
  }
}

/**
 * The lines of a voice script that will be spoken: trimmed, without the empty ones. Each becomes one clip,
 * so its index here is the clip's position.
 */
export function scriptLines(script: string) {
  return script
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/**
 * Turns a validated voice form into the parameters stored with the job.
 *
 * @param models - What the engine has installed, or `null` when the worker hasn't reported
 * @returns The parameters, or a `message` when the voice engine or the chosen model isn't installed
 */
export function toVoiceParams(
  input: VoiceValidator,
  models: Engine.Models | null
): { ok: true; params: Media.VoiceParams } | { ok: false; message: string } {
  if (!models?.voice) {
    return {
      ok: false,
      message: "The voice engine isn't installed, or the worker isn't running."
    }
  }
  if (!models.voice.models.includes(input.model)) {
    return { ok: false, message: "That voice model isn't installed any more." }
  }

  return {
    ok: true,
    params: {
      kind: "voice",
      model: input.model,
      voice: input.voice,
      description: input.description,
      seed: input.seed ?? randomSeed()
    }
  }
}

/**
 * Turns a validated caption form into the parameters stored with each of its jobs.
 *
 * @param models - What the engine has installed, or `null` when the worker hasn't reported
 * @returns The parameters, or a `message` when the caption engine or the chosen model isn't installed
 */
export function toCaptionParams(
  input: CaptionValidator,
  models: Engine.Models | null
): { ok: true; params: Media.CaptionParams } | { ok: false; message: string } {
  if (!models?.caption) {
    return {
      ok: false,
      message: "The caption engine isn't installed, or the worker isn't running."
    }
  }
  if (!models.caption.models.includes(input.model)) {
    return { ok: false, message: "That caption model isn't installed any more." }
  }

  return {
    ok: true,
    params: {
      kind: "caption",
      model: input.model,
      mode: input.mode,
      style: input.style
    }
  }
}

/**
 * Turns a validated video form into the parameters stored with the job.
 *
 * - Fast mode needs both Lightning LoRAs; without them the job runs the full schedule.
 * - The steps asked for apply to the full schedule only. Fast mode always runs its own.
 * - A loop needs at least two keyframes, and cut-out frames need the frames to be saved at all.
 * - Without references the job draws its first frame, so it records which image model to use.
 *
 * @param models - What the engine has installed, or `null` when the worker hasn't reported
 * @returns The parameters, or a `message` when the job can't run with what is installed
 */
export function toVideoParams(
  input: VideoValidator,
  models: Engine.Models | null
): { ok: true; params: Media.VideoParams } | { ok: false; message: string } {
  // With the worker offline the list is unknown, and the job waits in the queue either way
  if (models?.video && !models.video.models.some((pair) => pair.name === input.model)) {
    return { ok: false, message: "That video model isn't installed any more." }
  }

  const isTextToVideo = input.references.length === 0
  const imageModel = models?.image?.models[0] ?? null
  if (isTextToVideo && !imageModel) {
    return {
      ok: false,
      message:
        "Text-to-video draws its first frame with the image model, which isn't available. Add a reference image instead."
    }
  }

  const hasFastModels = !!models?.video?.fastHighNoise && !!models.video.fastLowNoise
  const isFast = input.isFast && hasFastModels
  const sampling = isFast
    ? VIDEO_SAMPLING.fast
    : { ...VIDEO_SAMPLING.full, steps: input.steps }

  return {
    ok: true,
    params: {
      kind: "video",
      model: input.model,
      seconds: input.seconds,
      resolution: input.resolution,
      aspect: input.aspect,
      imageModel: isTextToVideo ? imageModel : null,
      isStaticCamera: input.isStaticCamera,
      isLoop: input.isLoop && input.references.length > 1,
      isFast,
      steps: sampling.steps,
      cfg: sampling.cfg,
      // Kept even in fast mode, where it does nothing, so turning fast mode off on a reuse brings it back
      negative: input.negative,
      seed: input.seed ?? randomSeed(),
      shouldSaveFrames: input.shouldSaveFrames,
      shouldRemoveBackground: input.shouldSaveFrames && input.shouldRemoveBackground
    }
  }
}
