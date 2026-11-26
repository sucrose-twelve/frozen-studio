import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { z } from "zod"

import { readCharacter } from "../../actions/read"
import { CharacterForm } from "../../components/character-form"

export const instant = false

export const metadata: Metadata = { title: "Character" }

/**
 * The character editor: `/chat/characters/new` for a new card, or a character's id to change one.
 */
export default async function CharacterEditor({ params }: NextParams<{ id: string }>) {
  const { id } = await params
  if (id === "new") return <CharacterForm character={null} />
  if (!z.uuid().safeParse(id).success) notFound()

  const character = await readCharacter(id)
  if (!character) notFound()

  return <CharacterForm key={character.id} character={character} />
}
