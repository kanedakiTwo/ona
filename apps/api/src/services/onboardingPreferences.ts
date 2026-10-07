import { nameHasTerm, normalizeText } from './dietaryRestrictions.js'

/**
 * Onboarding answers the generator used to ignore (users.favorite_dishes,
 * priority, cooking_freq). Pure, so the rules are unit-tested.
 */

const DISH_STOPWORDS = new Set([
  'con', 'de', 'del', 'la', 'las', 'el', 'los', 'al', 'a', 'y', 'en', 'mi', 'tu', 'su', 'para', 'sin', 'estilo',
  'casera', 'casero', 'receta', 'plato',
])

/** Significant words of "Lentejas con chorizo" → ['lentejas', 'chorizo']. */
export function dishWords(dish: string): string[] {
  return normalizeText(dish)
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 4 && !DISH_STOPWORDS.has(w))
}

/**
 * Recipes whose name shares a significant word with a dish the user said they
 * love ("pasta", "pollo al curry"). They join the favourites pool weighting
 * (2×), never as a filter: liking pasta doesn't mean pasta every day.
 */
export function recipesMatchingDishes(
  recipes: ReadonlyArray<{ id: string; name: string }>,
  dishes: readonly string[] | null | undefined,
): Set<string> {
  const words = [...new Set((dishes ?? []).flatMap(dishWords))]
  const out = new Set<string>()
  if (words.length === 0) return out
  for (const r of recipes) {
    const name = normalizeText(r.name)
    if (words.some((w) => nameHasTerm(name, w))) out.add(r.id)
  }
  return out
}

/** Weekday prep-time cap (minutes) for "Rapidez" / "Cocino poco" users. */
export const QUICK_WEEKDAY_PREP_MINUTES = 30

/**
 * Per-day prep-time budget. Explicit `time_available` memory wins; otherwise
 * a user who chose priority "quick" or cooks "rarely" gets ≤ 30 min Mon–Fri.
 */
export function prepBudgetByDay(
  fromMemory: Record<number, number>,
  user: { priority?: string | null; cookingFreq?: string | null },
): Record<number, number> {
  if (Object.keys(fromMemory).length > 0) return fromMemory
  if (user.priority !== 'quick' && user.cookingFreq !== 'rarely') return fromMemory
  const out: Record<number, number> = {}
  for (let d = 0; d < 5; d++) out[d] = QUICK_WEEKDAY_PREP_MINUTES
  return out
}
