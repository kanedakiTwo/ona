/**
 * «Cocinar ahora» search (specs/cook-now.md), pure. The candidates already
 * passed the menu's filters (allergies, diet, dislikes, vetoes, «Mejor no»,
 * equipment, meal, season, course — load.ts); here: time, what the house
 * has (pantry, staples, substitutes), essentials vs secondaries, order.
 */
import { recipeTotalMinutes } from '@ona/shared'
import type { CookNowHitFacts } from '@ona/shared'
import { nameHasTerm, normalizeText } from '../dietaryRestrictions.js'
import { recipeGrams, roleOf, type RoleLine } from '../ingredientRoles.js'
import { isBasicIngredient, singularTerm } from '../withWhatIHave.js'

export const TIME_MARGIN = 1.2
export const MAX_MISSING_WHEN_BUYING = 2
export const EXPIRING_DAYS = 3
export const HOUSE_SERVINGS = 4

export interface CookNowIngredient extends RoleLine {
  ingredientId: string
  substituteIngredientIds?: string[]
}

export interface CookNowCandidate {
  id: string
  name: string
  servings?: number | null
  totalTime?: number | null
  prepTime?: number | null
  cookTime?: number | null
  ingredients: CookNowIngredient[]
}

export interface PantryLine {
  ingredientId: string | null
  name: string
  quantity: number
  unit: string
  expiresAt: string | null
}

export interface CookNowContext {
  pantry: PantryLine[]
  /** Active household staples (free text). */
  staples: string[]
  /** Substitute ingredient id → name, for the line «Cambia la nata por leche». */
  substituteNames: Map<string, string>
  /** «Repetir a menudo» (5 stars, «Me encanta»). */
  boost: Set<string>
  /** Cooked by the household in the last 7 days. */
  cookedRecently: Set<string>
  /** YYYY-MM-DD, Madrid. */
  today: string
}

export interface CookNowAnswers {
  minutes: number | null
  servings: number
  canBuy: boolean
}

export type CookNowFit = 'fits' | 'margin'

export interface CookNowHit<R extends CookNowCandidate = CookNowCandidate> extends CookNowHitFacts {
  recipe: R
  fit: CookNowFit
  /** Pantry ingredients it uses, and those expiring within 3 days. */
  uses: string[]
  expiring: string[]
}

export function fitOf(r: { totalTime?: number | null; prepTime?: number | null; cookTime?: number | null }, minutes: number | null): CookNowFit | null {
  const total = recipeTotalMinutes(r)
  if (total == null) return null
  if (minutes == null || total <= minutes) return 'fits'
  return total <= Math.floor(minutes * TIME_MARGIN) ? 'margin' : null
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 86_400_000)
}

/** A catalogue-linked pantry row with something in it: same id, or its name's word inside the ingredient's. */
function pantryRowFor(ing: CookNowIngredient, pantry: readonly PantryLine[]): PantryLine | undefined {
  const name = normalizeText(ing.ingredientName)
  return pantry.find(
    (p) => p.ingredientId != null && p.quantity > 0 && (p.ingredientId === ing.ingredientId || nameHasTerm(name, singularTerm(p.name))),
  )
}

function isStaple(ing: CookNowIngredient, staples: readonly string[]): boolean {
  const name = normalizeText(ing.ingredientName)
  return staples.some((s) => {
    const term = singularTerm(s)
    return term.length > 0 && nameHasTerm(name, term)
  })
}

/** Pure: what one recipe uses and lacks, given the house. */
export function evaluateRecipe<R extends CookNowCandidate>(recipe: R, answers: CookNowAnswers, ctx: CookNowContext): Omit<CookNowHit<R>, 'fit'> {
  const lines = recipe.ingredients.filter((i) => !isBasicIngredient(i.ingredientName))
  const total = recipeGrams(lines)
  const scale = answers.servings / (recipe.servings && recipe.servings > 0 ? recipe.servings : HOUSE_SERVINGS)
  const hit: Omit<CookNowHit<R>, 'fit'> = { recipe, missingEssential: [], short: [], missingSecondary: [], substitutions: [], uses: [], expiring: [] }
  const seen = new Set<string>()
  for (const ing of lines) {
    if (seen.has(ing.ingredientName)) continue
    seen.add(ing.ingredientName)
    const role = roleOf(ing, total)
    const row = pantryRowFor(ing, ctx.pantry)
    if (row) {
      if (role === 'essential' && row.unit === ing.unit && row.quantity < ing.quantity * scale) {
        hit.missingEssential.push(ing.ingredientName)
        hit.short.push(ing.ingredientName)
        continue
      }
      hit.uses.push(ing.ingredientName)
      if (row.expiresAt && daysBetween(ctx.today, row.expiresAt) <= EXPIRING_DAYS) hit.expiring.push(ing.ingredientName)
      continue
    }
    if (isStaple(ing, ctx.staples)) continue
    const sub = (ing.substituteIngredientIds ?? []).find((id) => ctx.pantry.some((p) => p.ingredientId === id && p.quantity > 0))
    if (sub) {
      hit.substitutions.push({ missing: ing.ingredientName, use: ctx.substituteNames.get(sub) ?? '' })
      continue
    }
    if (ing.optional) continue
    if (role === 'essential') hit.missingEssential.push(ing.ingredientName)
    else hit.missingSecondary.push(ing.ingredientName)
  }
  return hit
}

/** Pure: filter by time and what's missing, then order (each criterion only breaks the previous one's ties). */
export function rankCookNow<R extends CookNowCandidate>(
  candidates: readonly R[],
  answers: CookNowAnswers,
  ctx: CookNowContext,
): { hits: CookNowHit<R>[]; fallback: boolean } {
  const evaluated: CookNowHit<R>[] = []
  for (const recipe of candidates) {
    const fit = fitOf(recipe, answers.minutes)
    if (!fit) continue
    evaluated.push({ ...evaluateRecipe(recipe, answers, ctx), fit })
  }
  const limit = answers.canBuy ? MAX_MISSING_WHEN_BUYING : 0
  let pool = evaluated.filter((h) => h.missingEssential.length <= limit)
  let fallback = false
  if (!answers.canBuy && pool.length === 0) {
    pool = evaluated.filter((h) => h.missingEssential.length === 1)
    fallback = pool.length > 0
  }
  const pantryScore = (h: CookNowHit<R>) => h.uses.length + h.expiring.length
  pool.sort(
    (a, b) =>
      Number(a.fit === 'margin') - Number(b.fit === 'margin') ||
      a.missingEssential.length - b.missingEssential.length ||
      pantryScore(b) - pantryScore(a) ||
      a.missingSecondary.length - b.missingSecondary.length ||
      Number(ctx.boost.has(b.recipe.id)) - Number(ctx.boost.has(a.recipe.id)) ||
      Number(ctx.cookedRecently.has(a.recipe.id)) - Number(ctx.cookedRecently.has(b.recipe.id)) ||
      a.recipe.name.localeCompare(b.recipe.name, 'es'),
  )
  return { hits: pool, fallback }
}
