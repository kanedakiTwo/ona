/**
 * PRO-1263 · The sign-up's list with what was written by hand read as Mimo
 * reads it (`POST /user/:id/restrictions/read`, PRO-347, with the consent
 * already given): «nada d alergias. la abuela no come higado…» saves
 * «higado». What isn't understood stays as typed (Perfil shows it); «nada» goes.
 */
import { RESTRICTION_PRESETS, unionRestrictions } from "@ona/shared"
import { api } from "@/lib/api"

/** Mirrors `RestrictionReading` in apps/api/src/services/restrictionReader.ts. */
interface RestrictionReading {
  text: string
  none: boolean
  restrictions: string[]
  understood: boolean
}

export async function readFreeRestrictions(userId: string, list: readonly string[]): Promise<string[]> {
  const free = list.filter((r) => !(RESTRICTION_PRESETS as readonly string[]).includes(r)).slice(0, 8)
  if (free.length === 0) return [...list]
  const { readings } = await api.post<{ readings: RestrictionReading[] }>(`/user/${userId}/restrictions/read`, { texts: free })
  const byText = new Map(readings.map((r) => [r.text, r]))
  return unionRestrictions(
    list.flatMap((r) => {
      const reading = free.includes(r) ? byText.get(r.trim()) : undefined
      return reading?.understood ? reading.restrictions : [r]
    }),
  )
}
