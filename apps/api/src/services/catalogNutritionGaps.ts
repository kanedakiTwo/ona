/**
 * Ingredient data that makes a recipe's cached nutrition come out short:
 * 0 kcal in the catalogue, a `u` line whose ingredient has no `unitWeight`,
 * an `ml` line whose ingredient has no `density` (the aggregator skips those
 * lines). Report only: the menu generator doesn't use it. Printed by
 * `scripts/auditCatalogRecipes.ts`. Spec: specs/nutrition.md (Constraints).
 */

export type NutritionGapKind = 'sin_kcal' | 'sin_peso_por_unidad' | 'sin_densidad'

export const NUTRITION_GAP_LABEL: Record<NutritionGapKind, string> = {
  sin_kcal: '0 kcal en el catálogo',
  sin_peso_por_unidad: 'se usa por unidades y no tiene peso por unidad',
  sin_densidad: 'se usa en ml y no tiene densidad',
}

export interface NutritionGapLine {
  recipe: string
  ingredient: string
  unit: string
  calories: number | null
  unitWeight: number | null
  density: number | null
}

export interface NutritionGap {
  ingredient: string
  kinds: NutritionGapKind[]
  recipes: string[]
}

/** They really have 0 kcal. */
const NO_ENERGY = new Set(['agua', 'sal'])
/** Units the aggregator counts as 0 g anyway. */
const NEGLIGIBLE_UNITS = new Set(['pizca', 'al_gusto'])

export function nutritionDataGaps(lines: NutritionGapLine[]): NutritionGap[] {
  const byIngredient = new Map<string, { kinds: Set<NutritionGapKind>; recipes: Set<string> }>()
  for (const l of lines) {
    if (NO_ENERGY.has(l.ingredient.trim().toLowerCase()) || NEGLIGIBLE_UNITS.has(l.unit)) continue
    const kinds: NutritionGapKind[] = []
    if (!l.calories) kinds.push('sin_kcal')
    if (l.unit === 'u' && l.unitWeight == null) kinds.push('sin_peso_por_unidad')
    if (l.unit === 'ml' && l.density == null) kinds.push('sin_densidad')
    if (kinds.length === 0) continue
    const gap = byIngredient.get(l.ingredient) ?? { kinds: new Set<NutritionGapKind>(), recipes: new Set<string>() }
    for (const k of kinds) gap.kinds.add(k)
    gap.recipes.add(l.recipe)
    byIngredient.set(l.ingredient, gap)
  }
  return [...byIngredient.entries()]
    .map(([ingredient, g]) => ({
      ingredient,
      kinds: [...g.kinds],
      recipes: [...g.recipes].sort((a, b) => a.localeCompare(b, 'es')),
    }))
    .sort((a, b) => b.recipes.length - a.recipes.length || a.ingredient.localeCompare(b.ingredient, 'es'))
}
