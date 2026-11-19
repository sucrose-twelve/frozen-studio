import { createClient } from "redis"

import { REDIS } from "@/constants/env"

import { logger } from "./logger"

function createRedisClient() {
  const client = createClient({
    socket: { host: REDIS.host, port: REDIS.port },
    username: REDIS.username,
    password: REDIS.password
  })
  client.on("error", (error: Error) => logger(`Redis: ${error.message}`))

  return client
}

export type RedisClient = ReturnType<typeof createRedisClient>

type RedisState = {
  client: RedisClient
  ready: Promise<unknown>
}

declare global {
  var frozenRedis: RedisState | undefined
}

/**
 * The shared Redis client, connected on first use. It sits on `globalThis` so every bundle (Server Actions,
 * Route Handlers, dev reloads) shares one connection, and `ready` keeps concurrent first calls from
 * connecting twice.
 */
export async function redis() {
  let state = globalThis.frozenRedis
  if (!state) {
    const client = createRedisClient()
    state = globalThis.frozenRedis = { client, ready: client.connect() }
  }

  await state.ready
  return state.client
}

/**
 * A connection of its own, for commands that take one over: subscriptions and blocking pops. The caller
 * closes it (`client.destroy()`).
 */
export async function redisDedicated() {
  const client = createRedisClient()
  await client.connect()

  return client
}
