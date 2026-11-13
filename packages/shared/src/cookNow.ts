/**
 * «Cocinar ahora» (specs/cook-now.md): what the web and the API share —
 * which meal «now» is, which dishes of a slot count as planned, the days a
 * planned dish can move to, the line under each proposal and the request
 * schemas of /cook-now/*.
 */
import { z } from 'zod'
import type { DayMenu, MealSlot } from './types/menu.js'
import { isRecipeDish, isTaperVariant, type RecipeDish } from './types/menuDish.js'

export const COOK_NOW_MINUTES = [15, 30, 45] as const
export type CookNowMeal = 'lunch' | 'dinner'

/** Lunch until 16:00 (Madrid, like Mimo), then dinner; a meal already eaten is skipped. */
export function cookNowMeal(day: DayMenu, hour: number): CookNowMeal | null {
  const order: CookNowMeal[] = hour < 16 ? ['lunch', 'dinner'] : ['dinner']
  return order.find((m) => !day[m]?.eaten) ?? null
}

/** Recipe dishes cooked for this slot: not leftovers, not tápers (freezer, fridge, another day's), not notes. */
export function plannedRecipeDishes(slot: MealSlot | null | undefined): RecipeDish[] {
  return (slot?.dishes ?? []).filter(isRecipeDish).filter((d) => d.variant !== 'leftover' && !isTaperVariant(d.variant))
}

export interface DisplaceTarget {
  day: number
  /** Names of the recipe dishes it would replace, joined; null = free. */
  replaces: string | null
  /** A skipped day. A locked meal is a target too (PRO-1175: the lock only keeps it when the week is redone). */
  disabled: boolean
}

/** The rest of the week (tomorrow → Sunday), same meal, for «Pasarlas a otro día». */
export function displaceTargets(days: readonly DayMenu[], fromDay: number, meal: string, skippedDays: readonly number[]): DisplaceTarget[] {
  const out: DisplaceTarget[] = []
  for (let day = fromDay + 1; day <= 6; day++) {
    const names = (days[day]?.[meal]?.dishes ?? []).filter(isRecipeDish).map((d) => d.recipeName ?? '').filter(Boolean)
    out.push({
      day,
      replaces: names.length > 0 ? listEs(names) : null,
      disabled: skippedDays.includes(day),
    })
  }
  return out
}

function listEs(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

export interface CookNowHitFacts {
  missingEssential: string[]
  /** Essentials the pantry has but not enough of (also in missingEssential). */
  short: string[]
  missingSecondary: string[]
  substitutions: Array<{ missing: string; use: string }>
}

/** The short line under a proposal. */
export function cookNowHitLine(h: CookNowHitFacts): string {
  if (h.missingEssential.length > 0) {
    const notShort = h.missingEssential.filter((n) => !h.short.includes(n))
    if (notShort.length === 0) return `Te falta un poco de ${listEs(h.short)}`
    return `Te falta: ${listEs(h.missingEssential.map((n) => (h.short.includes(n) ? `un poco de ${n}` : n)))}`
  }
  if (h.substitutions.length > 0) {
    const s = h.substitutions[0]
    return `Cambia la ${s.missing} por ${s.use}`
  }
  if (h.missingSecondary.length > 0) return `Puedes hacerla sin ${listEs(h.missingSecondary)}`
  return 'No te falta nada'
}

export const cookNowProposalSchema = z.object({
  minutes: z.union([z.literal(15), z.literal(30), z.literal(45), z.null()]),
  servings: z.number().int().min(1).max(20),
  canBuy: z.boolean(),
  /** «Con lo que tienes» card: only recipes that use something from the pantry. */
  requirePantryUse: z.boolean().optional(),
})
export type CookNowProposalRequest = z.infer<typeof cookNowProposalSchema>

export const cookNowChooseSchema = z.object({
  recipeId: z.string().uuid(),
  /** People of question 2 when it differs from the household's default diners (not the slot's); null = the household default. */
  servings: z.number().int().min(1).max(20).nullable(),
  /** Day (0–6, same week and meal) the planned dishes move to; null = remove them. */
  displacedTo: z.number().int().min(0).max(6).nullable(),
})
export type CookNowChooseRequest = z.infer<typeof cookNowChooseSchema>

export const cookNowPhraseSchema = z.object({ recipeId: z.string().uuid() })
