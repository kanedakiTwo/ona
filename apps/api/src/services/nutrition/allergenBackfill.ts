/**
 * PRO-332 — when the name rules learn a word (gouda, emmental, kéfir, ghee…),
 * the tags already stored in the database don't. The recipe ficha and the
 * menu filter read the names on the fly (`effectiveAllergens`,
 * `dietaryRestrictions.ts`), but Mimo, the favourites and the recipe lists
 * read the stored `ingredients.allergen_tags` and `recipes.allergens`.
 *
 * Boot step (after `db:migrate`): an ingredient whose name has one of the
 * PRO-332 words (`PRO332_MILK_TERMS`) and lacks «lactosa» (the milk tag,
 * shown as «leche») gets it, and so does the stored union of every recipe
 * that uses it. Only those names and only that tag, so nothing a person set
 * by hand elsewhere comes back. **Additive only**: a stored tag is never
 * removed. Idempotent: the next boot finds nothing.
 */
import { eq, inArray } from 'drizzle-orm'
import { ingredients, recipeIngredients, recipes } from '../../db/schema.js'
import { PRO332_MILK_TERMS, inferAllergenTagsFromName, nameHasTerm, normalize } from './allergens.js'

type Db = typeof import('../../db/connection.js').db

/** ['lactosa'] when a PRO-332 word in the name says milk and `stored` lacks it; else []. */
export function missingNameAllergens(name: string, stored: readonly string[] | null | undefined): string[] {
  if ((stored ?? []).includes('lactosa')) return []
  const n = normalize(name)
  if (!PRO332_MILK_TERMS.some((t) => nameHasTerm(n, t))) return []
  // The full rules decide («kéfir de agua», «pisto manchego» are not milk).
  return inferAllergenTagsFromName(name).includes('lactosa') ? ['lactosa'] : []
}

export interface AllergenBackfillResult {
  /** «name» +tags, per ingredient changed. */
  ingredients: string[]
  /** Recipes whose stored union got a tag. */
  recipes: number
  /** Of them, catalogue (system) recipes. */
  catalogRecipes: number
}

export async function applyNameAllergenTags(
  db: Db,
  log: (line: string) => void = console.log,
): Promise<AllergenBackfillResult> {
  const rows = await db
    .select({ id: ingredients.id, name: ingredients.name, allergenTags: ingredients.allergenTags })
    .from(ingredients)
  const added = new Map<string, string[]>()
  const changed: string[] = []
  for (const r of rows) {
    const missing = missingNameAllergens(r.name, r.allergenTags)
    if (missing.length === 0) continue
    const next = [...new Set([...(r.allergenTags ?? []), ...missing])].sort()
    await db.update(ingredients).set({ allergenTags: next }).where(eq(ingredients.id, r.id))
    added.set(r.id, missing)
    changed.push(`«${r.name}» +${missing.join(', ')}`)
  }
  if (added.size === 0) {
    log('[allergen-milk-names] nada que cambiar')
    return { ingredients: [], recipes: 0, catalogRecipes: 0 }
  }

  const uses = await db
    .select({ recipeId: recipeIngredients.recipeId, ingredientId: recipeIngredients.ingredientId })
    .from(recipeIngredients)
    .where(inArray(recipeIngredients.ingredientId, [...added.keys()]))
  const perRecipe = new Map<string, Set<string>>()
  for (const u of uses) {
    const set = perRecipe.get(u.recipeId) ?? new Set<string>()
    for (const t of added.get(u.ingredientId) ?? []) set.add(t)
    perRecipe.set(u.recipeId, set)
  }

  let recipeCount = 0
  let catalogCount = 0
  if (perRecipe.size > 0) {
    const recipeRows = await db
      .select({ id: recipes.id, allergens: recipes.allergens, authorId: recipes.authorId })
      .from(recipes)
      .where(inArray(recipes.id, [...perRecipe.keys()]))
    for (const r of recipeRows) {
      const have = new Set(r.allergens ?? [])
      const extra = [...(perRecipe.get(r.id) ?? [])].filter((t) => !have.has(t))
      if (extra.length === 0) continue
      await db
        .update(recipes)
        .set({ allergens: [...new Set([...have, ...extra])].sort() })
        .where(eq(recipes.id, r.id))
      recipeCount++
      if (r.authorId == null) catalogCount++
    }
  }
  log(
    `[allergen-milk-names] ${changed.join('; ')}; ${recipeCount} receta(s) con alérgenos nuevos, ${catalogCount} del catálogo`,
  )
  return { ingredients: changed, recipes: recipeCount, catalogRecipes: catalogCount }
}
