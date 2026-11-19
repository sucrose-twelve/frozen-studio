import type { ImageValidator, VideoValidator } from "@/actions/jobs/validator.zod"
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
    seed: input.seed ?? randomSeed(),
    shouldRemoveBackground: input.shouldRemoveBackground
  }
}

/**
 * Turns a validated video form into the parameters stored with the job.
 *
 * - Fast mode needs both Lightning LoRAs; without them the job runs the full schedule.
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
  const sampling = isFast ? VIDEO_SAMPLING.fast : VIDEO_SAMPLING.full

  return {
    ok: true,
    params: {
      kind: "video",
      seconds: input.seconds,
      resolution: input.resolution,
      aspect: input.aspect,
      imageModel: isTextToVideo ? imageModel : null,
      isStaticCamera: input.isStaticCamera,
      isLoop: input.isLoop && input.references.length > 1,
      isFast,
      steps: sampling.steps,
      cfg: sampling.cfg,
      seed: input.seed ?? randomSeed(),
      shouldSaveFrames: input.shouldSaveFrames,
      shouldRemoveBackground: input.shouldSaveFrames && input.shouldRemoveBackground
    }
  }
}
