import { z } from "zod"

export const favoriteValidator = z.object({
  id: z.uuid(),
  isFavorite: z.boolean()
})

export const assetIdValidator = z.object({ id: z.uuid() })
