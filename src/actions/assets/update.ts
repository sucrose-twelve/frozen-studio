"use server"

import { eq } from "drizzle-orm"

import { db, schema } from "@/drizzle"

import { favoriteValidator } from "./validator.zod"

/**
 * Marks or unmarks a result as a favorite, the gallery's keep pile.
 *
 * @param input - `{ id, isFavorite }`
 */
export async function updateFavorite(input: unknown) {
  const parsed = favoriteValidator.safeParse(input)
  if (!parsed.success) return { ok: false as const, message: "Invalid asset" }

  await db
    .update(schema.assets)
    .set({ isFavorite: parsed.data.isFavorite })
    .where(eq(schema.assets.id, parsed.data.id))

  return { ok: true as const }
}
