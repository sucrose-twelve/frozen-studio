import * as dotenv from "dotenv"
import { z } from "zod"

import {
  captionSchema,
  comfySchema,
  dbSchema,
  envSchema,
  redisSchema,
  sdCppSchema,
  ttsSchema
} from "./validator.zod"

dotenv.config({ quiet: true })

export type EnvSchema = z.infer<typeof envSchema>
export type DatabaseSchema = z.infer<typeof dbSchema>
export type RedisSchema = z.infer<typeof redisSchema>
export type ComfySchema = z.infer<typeof comfySchema>
export type TtsSchema = z.infer<typeof ttsSchema>
export type CaptionSchema = z.infer<typeof captionSchema>
export type SdCppSchema = z.infer<typeof sdCppSchema>

export const ENV = envSchema.parse({
  APP_MODE: process.env.NODE_ENV ?? process.env.NEXT_PUBLIC_APP_MODE,
  APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  TZ: process.env.NEXT_PUBLIC_APP_TZ
})

export const DB = dbSchema.parse({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  name: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD
})

export const REDIS = redisSchema.parse({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
  username: process.env.REDIS_USERNAME,
  password: process.env.REDIS_PASSWORD
})

export const COMFY = comfySchema.parse({
  url: process.env.COMFY_URL,
  inputDir: process.env.COMFY_INPUT_DIR,
  outputDir: process.env.COMFY_OUTPUT_DIR
})

export const TTS = ttsSchema.parse({
  port: process.env.TTS_PORT,
  python: process.env.TTS_PYTHON,
  modelDir: process.env.TTS_MODEL_DIR
})

export const CAPTION = captionSchema.parse({
  port: process.env.CAPTION_PORT,
  python: process.env.CAPTION_PYTHON,
  modelDir: process.env.CAPTION_MODEL_DIR
})

export const SDCPP = sdCppSchema.parse({
  cli: process.env.SDCPP_CLI,
  modelDirs: process.env.SDCPP_MODEL_DIRS
})

export const DATABASE_URL = `postgresql://${DB.user}:${DB.password}@${DB.host}:${DB.port}/${DB.name}`
