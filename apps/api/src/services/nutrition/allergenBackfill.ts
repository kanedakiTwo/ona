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
 *
 * PRO-363 (2026-10-24): same step, two more rules — a broth («caldo de ave»,
 * «fondo oscuro de ternera»…, `isCeleryBroth`) gets «apio» and raisins
 * («pasas») get «sulfitos».
 *
 * PRO-1062 (2026-11-04): «aceite de sésamo», «semillas de sésamo», «tahini»…
 * get «sesamo». And a recipe that uses a sesame ingredient gets «sesamo» in
 * its stored union even when the ingredient already had the tag (a union
 * saved before the tag, or by a path that skipped it): a test home's noodles
 * showed no sesame with «aceite de sésamo» in the list. Every recipe fixed is
 * logged by name, so the boot log is the list of what was wrong.
 */
import { eq, inArray } from 'drizzle-orm'
import { ingredients, recipeIngredients, recipes } from '../../db/schema.js'
import {
  PRO332_MILK_TERMS,
  PRO363_SULFITE_TERMS,
  inferAllergenTagsFromName,
  isCeleryBroth,
  nameHasTerm,
  normalize,
} from './allergens.js'

type Db = typeof import('../../db/connection.js').db

/**
 * The tags the boot step adds to a name: «lactosa» for a PRO-332 milk word,
 * «apio» for a broth and «sulfitos» for raisins (PRO-363), «sesamo» for
 * sesame (PRO-1062), each only when `stored` lacks it; else [].
 */
export function missingNameAllergens(name: string, stored: readonly string[] | null | undefined): string[] {
  const have = new Set(stored ?? [])
  const n = normalize(name)
  // The full rules decide («kéfir de agua», «pisto manchego» are not milk).
  const inferred = inferAllergenTagsFromName(name)
  const missing: string[] = []
  if (!have.has('apio') && isCeleryBroth(n)) missing.push('apio')
  if (!have.has('lactosa') && PRO332_MILK_TERMS.some((t) => nameHasTerm(n, t)) && inferred.includes('lactosa'))
    missing.push('lactosa')
  if (!have.has('sulfitos') && PRO363_SULFITE_TERMS.some((t) => nameHasTerm(n, t))) missing.push('sulfitos')
  if (!have.has('sesamo') && inferred.includes('sesamo')) missing.push('sesamo')
  return missing
}

/**
 * The tags the boot step makes sure every recipe using this ingredient
 * carries: what it just added to the ingredient plus «sesamo» when the name
 * says sesame, even if the ingredient already had it (PRO-1062).
 */
export function recipeNameAllergens(name: string, added: readonly string[]): string[] {
  const tags = new Set(added)
  if (inferAllergenTagsFromName(name).includes('sesamo')) tags.add('sesamo')
  return [...tags].sort()
}

export interface AllergenBackfillResult {
  /** «name» +tags, per ingredient changed. */
  ingredients: string[]
  /** Recipes whose stored union got a tag. */
  recipes: number
  /** «recipe name» +tags, per recipe changed. */
  recipeNames: string[]
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
  // ingredient id → tags every recipe that uses it must carry.
  const added = new Map<string, string[]>()
  const changed: string[] = []
  for (const r of rows) {
    const missing = missingNameAllergens(r.name, r.allergenTags)
    if (missing.length > 0) {
      const next = [...new Set([...(r.allergenTags ?? []), ...missing])].sort()
      await db.update(ingredients).set({ allergenTags: next }).where(eq(ingredients.id, r.id))
      changed.push(`«${r.name}» +${missing.join(', ')}`)
    }
    const forRecipes = recipeNameAllergens(r.name, missing)
    if (forRecipes.length > 0) added.set(r.id, forRecipes)
  }
  const nothing: AllergenBackfillResult = { ingredients: [], recipes: 0, recipeNames: [], catalogRecipes: 0 }
  if (added.size === 0) {
    log('[allergen-names] nada que cambiar')
    return nothing
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
  const recipeNames: string[] = []
  if (perRecipe.size > 0) {
    const recipeRows = await db
      .select({ id: recipes.id, name: recipes.name, allergens: recipes.allergens, authorId: recipes.authorId })
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
      recipeNames.push(`«${r.name}» +${extra.sort().join(', ')}${r.authorId == null ? ' (catálogo)' : ''}`)
    }
  }
  // Sesame ingredients already tagged, in recipes already right: nothing to say.
  if (changed.length === 0 && recipeCount === 0) {
    log('[allergen-names] nada que cambiar')
    return nothing
  }
  log(
    `[allergen-names] ${changed.length > 0 ? `${changed.join('; ')}; ` : ''}${recipeCount} receta(s) con alérgenos nuevos, ${catalogCount} del catálogo${recipeNames.length > 0 ? `: ${recipeNames.join('; ')}` : ''}`,
  )
  return { ingredients: changed, recipes: recipeCount, recipeNames, catalogRecipes: catalogCount }
}
