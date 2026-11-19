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
 * Where the ComfyUI engine listens and where it keeps its files. The directories must be the ones ComfyUI
 * was started with (`--input-directory` / `--output-directory`): the worker hands it paths relative to them,
 * and the app reads the same files from disk.
 */
export const comfySchema = z.object({
  url: z.url().default("http://127.0.0.1:8188"),
  inputDir: z.string().min(1),
  outputDir: z.string().min(1)
})
