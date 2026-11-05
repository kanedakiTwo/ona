/**
 * «Cocinar ahora» (specs/cook-now.md): each recipe ingredient is essential
 * or secondary and may list substitutes. Cocina marks catalogue recipes
 * (routes/ingredientRoles.ts); until then `autoIngredientRole` decides.
 */
import type { IngredientRole } from '@ona/shared'

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
