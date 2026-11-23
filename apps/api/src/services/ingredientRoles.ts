/**
 * «Cocinar ahora» (specs/cook-now.md): each recipe ingredient is essential
 * or secondary and may list substitutes. Cocina marks catalogue recipes
 * (routes/ingredientRoles.ts); until then `autoIngredientRole` decides.
 */
import type { IngredientRole } from '@ona/shared'
import { lineGrams } from './catalogRecipeAudit.js'
import { normalizeText } from './dietaryRestrictions.js'
import { isBasicIngredient } from './withWhatIHave.js'

export interface IngredientMarks {
  role: IngredientRole | null
  substituteIngredientIds: string[]
}

export interface MarkedRow extends IngredientMarks {
  id: string
  ingredientId: string
}

/** The marks a copied row carries (both «Añadir a mis recetas» paths). */
export function ingredientMarksOf(row: { role?: string | null; substituteIngredientIds?: string[] | null }): IngredientMarks {
  return {
    role: row.role === 'essential' || row.role === 'secondary' ? row.role : null,
    substituteIngredientIds: [...(row.substituteIngredientIds ?? [])],
  }
}

/**
 * Pure: the marks each row of an edited recipe keeps. First by row id (the
 * edit form sends them back) when the ingredient is the same; then by
 * ingredient id for the rows left (an ingredient can appear twice, in two
 * sections). New ingredients come unmarked.
 */
export function carryIngredientMarks(
  previous: readonly MarkedRow[],
  next: ReadonlyArray<{ id: string; ingredientId: string }>,
): IngredientMarks[] {
  const used = new Set<string>()
  const out: Array<IngredientMarks | null> = next.map(() => null)
  next.forEach((n, i) => {
    const p = previous.find((q) => q.id === n.id && q.ingredientId === n.ingredientId)
    if (p) {
      out[i] = ingredientMarksOf(p)
      used.add(p.id)
    }
  })
  next.forEach((n, i) => {
    if (out[i]) return
    const p = previous.find((q) => !used.has(q.id) && q.ingredientId === n.ingredientId)
    if (p) {
      out[i] = ingredientMarksOf(p)
      used.add(p.id)
    }
  })
  return out.map((m) => m ?? { role: null, substituteIngredientIds: [] })
}

/** Categories whose ingredient defines the dish (seeded `ingredients.category`). */
export const ESSENTIAL_CATEGORIES = ['proteina', 'cereal', 'legumbre'] as const
/** A line weighing at least this share of the recipe is essential. */
export const ESSENTIAL_WEIGHT_SHARE = 0.15

export interface RoleLine {
  ingredientName: string
  quantity: number
  unit: string
  category?: string | null
  optional?: boolean
  note?: string | null
  displayUnit?: string | null
  unitWeight?: number | null
  density?: number | null
  edibleFraction?: number | null
  role?: IngredientRole | null
}

function gramsOf(l: RoleLine): number | null {
  return lineGrams({
    name: l.ingredientName,
    quantity: l.quantity,
    unit: l.unit,
    unitWeight: l.unitWeight ?? null,
    density: l.density ?? null,
    edibleFraction: l.edibleFraction ?? null,
    note: l.note ?? null,
  })
}

/** Grams of the recipe that can be weighed, basics left out. */
export function recipeGrams(lines: readonly RoleLine[]): number {
  return lines.reduce((sum, l) => (isBasicIngredient(l.ingredientName) ? sum : sum + (gramsOf(l) ?? 0)), 0)
}

const TO_TASTE = /\b(al gusto|pizca)\b/

/** Pure: the role of an unmarked line (specs/cook-now.md → «Regla automática»). */
export function autoIngredientRole(l: RoleLine, totalGrams: number): IngredientRole {
  if (l.optional) return 'secondary'
  if (!(l.quantity > 0)) return 'secondary'
  if (l.unit === 'al_gusto' || l.unit === 'pizca') return 'secondary'
  if (TO_TASTE.test(normalizeText(`${l.note ?? ''} ${l.displayUnit ?? ''}`))) return 'secondary'
  const category = normalizeText(l.category ?? '')
  if ((ESSENTIAL_CATEGORIES as readonly string[]).includes(category)) return 'essential'
  const g = gramsOf(l)
  if (g == null || totalGrams <= 0) return 'secondary'
  return g / totalGrams >= ESSENTIAL_WEIGHT_SHARE ? 'essential' : 'secondary'
}

/** Cocina's mark if there is one, else the rule. An optional line is always secondary. */
export function roleOf(l: RoleLine, totalGrams: number): IngredientRole {
  if (l.optional) return 'secondary'
  return l.role ?? autoIngredientRole(l, totalGrams)
}
