/**
 * «¿Qué tal?» after cooking (PRO-110, specs/cook-log.md): a one-tap sheet
 * whose answer goes into the household's existing 1–5 rating.
 */
export const RATING_PROMPT_CHOICES = [
  { label: 'Repetir a menudo', rating: 5 },
  { label: 'Bien', rating: 3 },
  { label: 'Mejor no', rating: 1 },
] as const

/** A recipe already rated isn't asked about again for this many days. */
export const RATING_PROMPT_COOLDOWN_DAYS = 30

/**
 * Pure: ask after this cook? Yes when the household hasn't rated the recipe,
 * or its notes row (where the rating lives) was last touched 30+ days ago.
 */
export function shouldAskRating(
  notes: { rating: number | null; updatedAt: string | Date | null } | null,
  now: Date = new Date(),
): boolean {
  if (!notes || notes.rating == null) return true
  if (!notes.updatedAt) return true
  const last = new Date(notes.updatedAt).getTime()
  return now.getTime() - last >= RATING_PROMPT_COOLDOWN_DAYS * 86_400_000
}
