import { z } from "zod"

export const envSchema = z.object({
  APP_MODE: z
    .union([z.literal("production"), z.literal("development")])
    .default("development"),
  APP_NAME: z.string().default("project_frozen"),
  APP_URL: z.string().default("http://localhost:8190"),
  TZ: z.string().default("Asia/Bangkok")
})

export const dbSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.string().default("5432"),
  name: z.string().default("postgres"),
  user: z.string().default("postgres"),
  password: z.string().default("password")
})

export const redisSchema = z.object({
  host: z.string().default("127.0.0.1"),
  port: z.string().transform(Number).default(6379),
  username: z.string().default("default"),
  password: z.string().default("password")
})

/**
 * The text-to-speech service the worker starts for voice jobs. Paths are relative to the project root; the
 * defaults are where the README installs things.
 *
 * `modelDir` is the model the Voice form starts on. The other model folders beside it can be picked in the
 * form.
 */
export const ttsSchema = z.object({
  port: z.string().transform(Number).default(8191),
  python: z.string().default("tts/.venv/Scripts/python.exe"),
  modelDir: z.string().default("tts/models/japanese-parler-tts-mini")
})

/**
 * The captioning service the worker starts for caption jobs, set up like the text-to-speech one. Any
 * vision-language model transformers can load works: put its folder beside `modelDir`, the model the
 * Caption form starts on, and pick it in the form.
 */
export const captionSchema = z.object({
  port: z.string().transform(Number).default(8192),
  python: z.string().default("caption/.venv/Scripts/python.exe"),
  modelDir: z.string().default("caption/models/Ministral-3-8B-Uncensored-FP8")
})

/**
 * stable-diffusion.cpp, the second image engine: a program the worker runs once per job, for the model
 * files ComfyUI can't read (text encoders as GGUF).
 *
 * - `cli` is its `sd-cli` executable, relative to the project root.
 * - `modelDirs` are the folders it may take model files from, separated by `;`, searched with their
 *   subfolders. Adding ComfyUI's own models folder lets both engines share one copy of a file.
 */
export const sdCppSchema = z.object({
  cli: z.string().default("sdcpp/bin/sd-cli.exe"),
  modelDirs: z
    .string()
    .default("sdcpp/models")
    .transform((value) =>
      value
        .split(";")
        .map((folder) => folder.trim())
        .filter(Boolean)
    )
})

/**
 * Where the ComfyUI engine listens and where it keeps its files. The directories must be the ones ComfyUI
 * was started with (`--input-directory` / `--output-directory`): the worker hands it paths relative to them,
 * and the app reads the same files from disk.
 */
export const comfySchema = z.object({
  url: z.url().default("http://127.0.0.1:8188"),
  inputDir: z.string().min(1),
  outputDir: z.string().min(1)
})
