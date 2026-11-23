import { z } from "zod"

import {
  ASPECTS,
  CAPTION_MAX_PROMPT_LENGTH,
  CAPTION_MODES,
  CAPTION_STYLES,
  IMAGE_COUNTS,
  IMAGE_SAMPLERS,
  IMAGE_TIERS,
  LORA_STRENGTH,
  MAX_REFERENCES,
  VOICE_MAX_LINE_LENGTH,
  VOICE_MAX_LINES
} from "@/constants"
import { scriptLines } from "@/libs/job"

/**
 * Seeds stay under 2^48 so they survive JSON and JavaScript numbers exactly. `null` asks for a random one.
 */
const seed = z
  .number()
  .int()
  .min(0)
  .max(2 ** 48)
  .nullable()

const prompt = z.string().trim().min(1, { error: "Describe what you want" }).max(4_000)

const literals = <T extends number>(values: readonly T[]) =>
  z.union(values.map((value) => z.literal(value)))

export const imageValidator = z
  .object({
    kind: z.literal("image"),
    prompt,
    negative: z.string().trim().max(2_000),
    references: z.array(z.uuid()).max(MAX_REFERENCES.image),
    model: z.string().min(1, { error: "Pick a model" }),
    textEncoder: z.string().min(1, { error: "Pick a text encoder" }),
    // `null` follows the first reference image
    aspect: z.enum(ASPECTS).nullable(),
    tier: z.enum(IMAGE_TIERS),
    count: literals(IMAGE_COUNTS),
    steps: z.number().int().min(1).max(100),
    cfg: z.number().min(1).max(15),
    // `null` is "Auto": the sampler that suits the mode
    sampler: z.enum(IMAGE_SAMPLERS).nullable(),
    // `null` runs the model without one; the strength is kept either way, for the next pick
    lora: z.string().min(1).nullable(),
    loraStrength: z.number().min(LORA_STRENGTH.min).max(LORA_STRENGTH.max),
    seed,
    shouldRemoveBackground: z.boolean()
  })
  .refine((value) => value.aspect !== null || value.references.length > 0, {
    error: "Pick a size, or add a reference image to follow",
    path: ["aspect"]
  })

export type ImageValidator = z.infer<typeof imageValidator>

export const cutoutValidator = z.object({
  kind: z.literal("cutout"),
  references: z
    .array(z.uuid())
    .min(1, { error: "Add at least one image" })
    .max(MAX_REFERENCES.cutout)
})

export type CutoutValidator = z.infer<typeof cutoutValidator>

export const voiceValidator = z.object({
  kind: z.literal("voice"),
  model: z.string().min(1, { error: "Pick a model" }),
  // The script: every non-empty line is spoken as its own clip
  prompt: z
    .string()
    .trim()
    .min(1, { error: "Write at least one line to speak" })
    .refine((value) => scriptLines(value).length <= VOICE_MAX_LINES, {
      error: `At most ${VOICE_MAX_LINES} lines per job`
    })
    .refine(
      (value) => scriptLines(value).every((line) => line.length <= VOICE_MAX_LINE_LENGTH),
      {
        error: `Keep each line under ${VOICE_MAX_LINE_LENGTH} characters, or it gets cut off`
      }
    ),
  // A preset's id, or "custom"
  voice: z.string().min(1).max(40),
  description: z.string().trim().min(1, { error: "Describe the voice" }).max(600),
  seed
})

export type VoiceValidator = z.infer<typeof voiceValidator>

export const captionValidator = z
  .object({
    kind: z.literal("caption"),
    model: z.string().min(1, { error: "Pick a model" }),
    // What the model is told about the image: optional guidance for prompts, the question for an answer
    prompt: z.string().trim().max(CAPTION_MAX_PROMPT_LENGTH),
    // One job per image
    references: z
      .array(z.uuid())
      .min(1, { error: "Add at least one image" })
      .max(MAX_REFERENCES.caption),
    mode: z.enum(CAPTION_MODES),
    style: z.enum(CAPTION_STYLES)
  })
  .refine((value) => value.mode !== "answer" || value.prompt.length > 0, {
    error: "Write what the model should answer",
    path: ["prompt"]
  })

export type CaptionValidator = z.infer<typeof captionValidator>

export const jobValidator = z.discriminatedUnion("kind", [
  imageValidator,
  cutoutValidator,
  voiceValidator,
  captionValidator
])

export type JobValidator = z.infer<typeof jobValidator>

export const jobIdValidator = z.object({ id: z.uuid() })
