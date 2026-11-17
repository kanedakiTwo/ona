/**
 * PRO-1201 · What the ficha says about tastes, as weights of the draw: the
 * cuisines the household likes (`cuisine_bias`, cuisine → 0..100) and the
 * cook's level (`cooking_skill`). Neither filters: they only make a recipe
 * come out more or less often (`tasteWeight`, in `pickRandom`).
 *
 * - Cuisine (the recipe's internal tag `cocina:<slug>`): 80-100 ×1.5 (like a
 *   «Me apetece», less than a favourite's ×2), 40-79 ×1, 0-39 ×0.15. A
 *   recipe without the tag, or a cuisine the ficha doesn't name, ×1. A
 *   family covers its cuisines («asiática» → japonesa, china…) and the other
 *   way round, unless the ficha names the cuisine itself.
 * - Level: «easy» ×0.1 on a hard recipe, «medium» ×0.7, «advanced» or none ×1.
 * - The household (like the dislikes): per cuisine, if anyone is under 40 the
 *   lowest wins, else the highest; the level is the generating member's,
 *   else the household's.
 */
import type { UserMemory } from '@ona/shared'

export type CookingSkill = 'easy' | 'medium' | 'advanced'

export interface MenuTastes {
  /** Folded slug (no accents, hyphens) → 0..100. */
  cuisineBias?: Record<string, number>
  cookingSkill?: CookingSkill
}

export const CUISINE_LIKED_WEIGHT = 1.5
export const CUISINE_DISLIKED_WEIGHT = 0.15
export const SKILL_HARD_WEIGHT: Record<CookingSkill, number> = { easy: 0.1, medium: 0.7, advanced: 1 }

/** «Asiática» → «asiatica», «Oriente Medio» → «oriente-medio» (the import's slug). */
export function cuisineSlug(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Families Mimo asks about (systemPrompt.ts) and the cuisines the catalogue tags under them. */
const FAMILIES: Record<string, readonly string[]> = {
  mediterranea: ['espanola', 'italiana', 'griega', 'provenzal'],
  asiatica: ['japonesa', 'china', 'tailandesa', 'thai', 'coreana', 'vietnamita', 'india', 'indonesia', 'filipina', 'malaya', 'oriental'],
  mexicana: ['tex-mex'],
  latinoamericana: ['mexicana', 'tex-mex', 'peruana', 'argentina', 'colombiana', 'venezolana', 'cubana', 'brasilena', 'chilena'],
  americana: ['estadounidense', 'tex-mex'],
  arabe: ['libanesa', 'marroqui', 'turca', 'oriente-medio', 'persa'],
  'oriente-medio': ['libanesa', 'turca', 'persa', 'israeli', 'siria'],
}

/** Pure: the household's view of one cuisine — the lowest if anyone is under 40, else the highest. */
function combine(values: readonly number[]): number | null {
  if (!values.length) return null
  const min = Math.min(...values)
  return min < 40 ? min : Math.max(...values)
}

/** Pure: a `cuisine_bias` value made safe (slugged keys, 0..100), or {}. */
export function cuisineBiasOf(value: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const slug = cuisineSlug(k)
    const n = Number(v)
    if (slug && Number.isFinite(n)) out[slug] = Math.max(0, Math.min(100, n))
  }
  return out
}

/** Pure: several `cuisine_bias` values as the household's (`combine` per cuisine). */
export function mergeCuisineBias(...biases: ReadonlyArray<Record<string, number> | undefined>): Record<string, number> {
  const all = new Map<string, number[]>()
  for (const b of biases) for (const [k, v] of Object.entries(b ?? {})) (all.get(k) ?? all.set(k, []).get(k)!).push(v)
  const out: Record<string, number> = {}
  for (const [k, vs] of all) out[k] = combine(vs)!
  return out
}

export function cookingSkillOf(value: unknown): CookingSkill | undefined {
  return value === 'easy' || value === 'medium' || value === 'advanced' ? value : undefined
}

/** The generating member's tastes from their memory. */
export function memoryTastes(memory: UserMemory | null | undefined): MenuTastes {
  const bias = cuisineBiasOf(memory?.cuisine_bias?.value)
  return {
    ...(Object.keys(bias).length ? { cuisineBias: bias } : {}),
    ...(cookingSkillOf(memory?.cooking_skill?.value) ? { cookingSkill: cookingSkillOf(memory?.cooking_skill?.value) } : {}),
  }
}

/** Pure: the recipe's cuisine slug (`cocina:<slug>`), or null. */
export function recipeCuisine(internalTags: readonly string[] | null | undefined): string | null {
  const tag = (internalTags ?? []).find((t) => t.toLowerCase().startsWith('cocina:'))
  const slug = tag ? cuisineSlug(tag.slice('cocina:'.length)) : ''
  return slug || null
}

/** Pure: what the household says of a cuisine (itself, else its families, else its members), or null. */
export function cuisineScore(cuisine: string, bias: Record<string, number>): number | null {
  if (bias[cuisine] != null) return bias[cuisine]
  const families = Object.entries(FAMILIES).filter(([f, members]) => members.includes(cuisine) && bias[f] != null).map(([f]) => bias[f])
  if (families.length) return combine(families)
  return combine((FAMILIES[cuisine] ?? []).filter((m) => bias[m] != null).map((m) => bias[m]))
}

/** Pure: the draw weight of a recipe for these tastes (1 = as before). */
export function tasteWeight(
  recipe: { internalTags?: readonly string[] | null; difficulty?: string | null },
  tastes: MenuTastes | undefined,
): number {
  if (!tastes) return 1
  let w = 1
  const cuisine = tastes.cuisineBias ? recipeCuisine(recipe.internalTags) : null
  const score = cuisine ? cuisineScore(cuisine, tastes.cuisineBias!) : null
  if (score != null) w *= score >= 80 ? CUISINE_LIKED_WEIGHT : score < 40 ? CUISINE_DISLIKED_WEIGHT : 1
  if (tastes.cookingSkill && recipe.difficulty === 'hard') w *= SKILL_HARD_WEIGHT[tastes.cookingSkill]
  return w
}
