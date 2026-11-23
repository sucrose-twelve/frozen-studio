import type {
  CaptionValidator,
  ImageValidator,
  VoiceValidator
} from "@/actions/jobs/validator.zod"
import { IMAGE_SIZES, IMAGE_TURBO } from "@/constants"

import { imageEngine, isTurboImageModel } from "./image-model"

/**
 * A fresh seed under 2^48, the range the validators accept.
 */
export function randomSeed() {
  return Math.floor(Math.random() * 2 ** 48)
}

/**
 * Turns a validated image form into the parameters stored with the job: the pixel size behind the aspect and
 * tier, and a seed when none was given.
 *
 * - A Turbo model runs its own schedule whatever the form says, so that is what gets stored.
 * - The cut-out copy is made by ComfyUI in the same run, so a job on stable-diffusion.cpp has none; the
 *   result's own "Cut out" button does it afterwards.
 */
export function toImageParams(input: ImageValidator): Media.ImageParams {
  const size = input.aspect ? IMAGE_SIZES[input.aspect][input.tier] : null
  const sampling = isTurboImageModel(input.model)
    ? { steps: IMAGE_TURBO.steps, cfg: IMAGE_TURBO.cfg, sampler: null }
    : { steps: input.steps, cfg: input.cfg, sampler: input.sampler }

  return {
    kind: "image",
    model: input.model,
    textEncoder: input.textEncoder,
    // Kept for a Turbo model too, where it does nothing, so a reuse on another model brings it back
    negative: input.negative,
    aspect: input.aspect,
    tier: input.tier,
    width: size?.[0] ?? null,
    height: size?.[1] ?? null,
    count: input.count,
    steps: sampling.steps,
    cfg: sampling.cfg,
    sampler: sampling.sampler,
    lora: input.lora ? { name: input.lora, strength: input.loraStrength } : null,
    seed: input.seed ?? randomSeed(),
    shouldRemoveBackground:
      input.shouldRemoveBackground && imageEngine(input.textEncoder) === "comfy"
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
