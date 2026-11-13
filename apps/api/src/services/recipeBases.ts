/**
 * Bases de batch cooking (PRO-373, specs/recipes.md).
 *
 * A base (sofrito, legumbre aliñada, verduras asadas…) is a catalogue recipe
 * tagged `base` (`isBaseRecipe`, @ona/shared), cooked one day for several
 * dishes of the week. `recipe_bases` links a dish to the bases it uses, with
 * how many servings of each per batch of the dish. The recipe page reads
 * «Usa: Sofrito (2 raciones)»; the shopping list adds the base's ingredients
 * once for every dish that uses it (`withBaseServings`, shoppingList.ts); the
 * menu never picks a base as a dish (`loadMatchableRecipes`).
 */
import { eq } from 'drizzle-orm'
import type { RecipeBaseUse } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { recipeBases, recipes } from '../db/schema.js'
import { canViewRecipe, isHiddenDraft } from './recipeVisibility.js'

/**
 * The bases a recipe uses, as its page shows them — only those the reader may
 * open (a draft base only for an admin, a private one only for its household).
 */
export async function loadRecipeBaseUses(
  recipeId: string,
  viewer: { userId?: string | null; isAdmin?: boolean },
  db: any = defaultDb,
): Promise<RecipeBaseUse[]> {
  const rows: Array<{ id: string; name: string; authorId: string | null; status: string | null; servings: number }> = await db
    .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId, status: recipes.status, servings: recipeBases.servingsUsed })
    .from(recipeBases)
    .innerJoin(recipes, eq(recipeBases.baseRecipeId, recipes.id))
    .where(eq(recipeBases.recipeId, recipeId))
  const out: RecipeBaseUse[] = []
  for (const r of rows) {
    if (isHiddenDraft(r, !!viewer.isAdmin)) continue
    if (!(await canViewRecipe(viewer.userId, r.authorId, db))) continue
    out.push({ id: r.id, name: r.name, servings: r.servings })
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'es'))
}
