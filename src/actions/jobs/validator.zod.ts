import { z } from "zod"

import {
  ASPECTS,
  IMAGE_COUNTS,
  IMAGE_TIERS,
  MAX_REFERENCES,
  VIDEO_RESOLUTIONS,
  VIDEO_SECONDS
} from "@/constants"

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
    // `null` follows the first reference image
    aspect: z.enum(ASPECTS).nullable(),
    tier: z.enum(IMAGE_TIERS),
    count: literals(IMAGE_COUNTS),
    steps: z.number().int().min(1).max(100),
    cfg: z.number().min(1).max(15),
    seed,
    shouldRemoveBackground: z.boolean()
  })
  .refine((value) => value.aspect !== null || value.references.length > 0, {
    error: "Pick a size, or add a reference image to follow",
    path: ["aspect"]
  })

export type ImageValidator = z.infer<typeof imageValidator>

export const videoValidator = z.object({
  kind: z.literal("video"),
  prompt,
  references: z.array(z.uuid()).max(MAX_REFERENCES.video),
  seconds: literals(VIDEO_SECONDS),
  resolution: literals(VIDEO_RESOLUTIONS),
  // Only used without references; the first reference decides the shape otherwise
  aspect: z.enum(ASPECTS),
  isStaticCamera: z.boolean(),
  isLoop: z.boolean(),
  isFast: z.boolean(),
  seed,
  shouldSaveFrames: z.boolean(),
  shouldRemoveBackground: z.boolean()
})

export type VideoValidator = z.infer<typeof videoValidator>

export const cutoutValidator = z.object({
  kind: z.literal("cutout"),
  references: z
    .array(z.uuid())
    .min(1, { error: "Add at least one image" })
    .max(MAX_REFERENCES.cutout)
})

export type CutoutValidator = z.infer<typeof cutoutValidator>

export const jobValidator = z.discriminatedUnion("kind", [
  imageValidator,
  videoValidator,
  cutoutValidator
])

export type JobValidator = z.infer<typeof jobValidator>

export const jobIdValidator = z.object({ id: z.uuid() })
