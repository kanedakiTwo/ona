/**
 * PRO-1118 — a recipe's stored `allergens` is the union of its ingredients'
 * `allergenTags` (`allergenUnion`), computed when the recipe is saved. When
 * Cocina changes the tags of an ingredient (the za'atar that got «sesamo» on
 * 2026-11-03), the recipes that use it kept the old union until someone saved
 * them again. The menu filter read the ingredients and was right; the ficha
 * the household reads, and what Mimo tells, were not.
 *
 *   - `recomputeRecipeAllergens`: after an ingredient's tags change, every
 *     recipe that uses it gets its union again. Only `allergens` (and
 *     `updatedAt`, so the saved menus re-check it) move: never ingredients
 *     nor steps.
 *   - `findRecipeAllergenMismatches`: read-only, the recipes whose stored
 *     `allergens` differ from the union of their ingredients. Boot step
 *     (`db:migrate`, only a log line) and Admin → Alérgenos sugeridos.
 */
import { eq, inArray } from 'drizzle-orm'
import { ingredients, recipeIngredients, recipes } from '../../db/schema.js'
import { allergenUnion } from './allergens.js'
import { record } from '../auditLog.js'

type Db = typeof import('../../db/connection.js').db
/** `db` or the `tx` of `db.transaction`. */
type DbOrTx = Pick<Db, 'select' | 'update'>

export interface RecipeAllergenChange {
  recipeId: string
  name: string
  authorId: string | null
  before: string[]
  after: string[]
}

export interface RecipeAllergenMismatch {
  id: string
  name: string
  /** Null: catalogue recipe. */
  authorId: string | null
  stored: string[]
  expected: string[]
}

function sameTags(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((t, i) => t === sb[i])
}

/** True when two tag lists differ as sets (order never counts). */
export function allergenTagsChanged(
  before: readonly string[] | null | undefined,
  after: readonly string[] | null | undefined,
): boolean {
  return !sameTags([...new Set(before ?? [])], [...new Set(after ?? [])])
}

/**
 * For each recipe (stored allergens + ingredient ids), the union it should
 * have and whether it differs. Pure: the DB reads are in the callers.
 */
export function compareRecipeAllergens(
  rows: Array<{ id: string; allergens: string[] | null; ingredientIds: string[] }>,
  catalog: Map<string, { allergenTags?: string[] | null }>,
): Array<{ id: string; stored: string[]; expected: string[]; differs: boolean }> {
  return rows.map((r) => {
    const stored = [...new Set(r.allergens ?? [])].sort()
    const expected = allergenUnion(
      r.ingredientIds.map((ingredientId) => ({ ingredientId })),
      catalog,
    )
    return { id: r.id, stored, expected, differs: !sameTags(stored, expected) }
  })
}

/** Stored allergens vs. their ingredients' union for the given recipes (all when omitted). */
async function loadComparison(db: DbOrTx, recipeIds?: string[]) {
  if (recipeIds && recipeIds.length === 0) return []
  const recipeRows = await (recipeIds
    ? db
        .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId, allergens: recipes.allergens })
        .from(recipes)
        .where(inArray(recipes.id, recipeIds))
    : db
        .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId, allergens: recipes.allergens })
        .from(recipes))
  if (recipeRows.length === 0) return []
  const lines = await (recipeIds
    ? db
        .select({ recipeId: recipeIngredients.recipeId, ingredientId: recipeIngredients.ingredientId, allergenTags: ingredients.allergenTags })
        .from(recipeIngredients)
        .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))
        .where(inArray(recipeIngredients.recipeId, recipeIds))
    : db
        .select({ recipeId: recipeIngredients.recipeId, ingredientId: recipeIngredients.ingredientId, allergenTags: ingredients.allergenTags })
        .from(recipeIngredients)
        .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId)))
  const catalog = new Map<string, { allergenTags?: string[] | null }>()
  const perRecipe = new Map<string, string[]>()
  for (const l of lines) {
    catalog.set(l.ingredientId, { allergenTags: l.allergenTags })
    const ids = perRecipe.get(l.recipeId) ?? []
    ids.push(l.ingredientId)
    perRecipe.set(l.recipeId, ids)
  }
  const compared = compareRecipeAllergens(
    recipeRows.map((r) => ({ id: r.id, allergens: r.allergens, ingredientIds: perRecipe.get(r.id) ?? [] })),
    catalog,
  )
  return recipeRows.map((r, i) => ({ ...r, ...compared[i] }))
}

/**
 * Recompute and store `allergens` of every recipe that uses `ingredientId`.
 * Call it inside the transaction that changed the ingredient's tags; returns
 * only the recipes that changed (for the audit log, one line each).
 */
export async function recomputeRecipeAllergens(
  db: DbOrTx,
  ingredientId: string,
): Promise<RecipeAllergenChange[]> {
  const uses = await db
    .select({ recipeId: recipeIngredients.recipeId })
    .from(recipeIngredients)
    .where(eq(recipeIngredients.ingredientId, ingredientId))
  const ids = [...new Set(uses.map((u) => u.recipeId))]
  const changes: RecipeAllergenChange[] = []
  for (const r of await loadComparison(db, ids)) {
    if (!r.differs) continue
    await db
      .update(recipes)
      .set({ allergens: r.expected, updatedAt: new Date() })
      .where(eq(recipes.id, r.id))
    changes.push({ recipeId: r.id, name: r.name, authorId: r.authorId, before: r.stored, after: r.expected })
  }
  return changes
}

/** One audit line per recipe recomputed, in the same transaction as the change. */
export async function recordRecipeAllergenChanges(
  tx: Parameters<typeof record>[1],
  adminId: string,
  ingredientId: string,
  changes: readonly RecipeAllergenChange[],
): Promise<void> {
  for (const c of changes) {
    await record(
      {
        adminId,
        action: 'recipe.allergens_recompute',
        targetType: 'recipe',
        targetId: c.recipeId,
        payload: { ingredientId, before: { allergens: c.before }, after: { allergens: c.after } },
      },
      tx,
    )
  }
}

/** Read-only: every recipe whose stored `allergens` differ from its ingredients' union. */
export async function findRecipeAllergenMismatches(db: DbOrTx): Promise<RecipeAllergenMismatch[]> {
  return (await loadComparison(db))
    .filter((r) => r.differs)
    .map((r) => ({ id: r.id, name: r.name, authorId: r.authorId, stored: r.stored, expected: r.expected }))
    .sort((a, b) => a.name.localeCompare(b.name, 'es'))
}

/** Boot step (after `db:migrate`): only counts and logs, never writes. */
export async function logRecipeAllergenMismatches(
  db: DbOrTx,
  log: (line: string) => void = console.log,
): Promise<number> {
  const rows = await findRecipeAllergenMismatches(db)
  const catalog = rows.filter((r) => r.authorId == null).length
  log(
    rows.length === 0
      ? '[recipe-allergens] todas las recetas cuadran con sus ingredientes'
      : `[recipe-allergens] ${rows.length} receta(s) con alérgenos que no cuadran con sus ingredientes, ${catalog} del catálogo (Admin → Alérgenos sugeridos)`,
  )
  return rows.length
}
