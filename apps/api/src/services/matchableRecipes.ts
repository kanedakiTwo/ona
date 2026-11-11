import { eq, inArray } from 'drizzle-orm'
import { isBaseRecipe, type Course } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { recipes, recipeIngredients, recipeSteps, ingredients } from '../db/schema.js'
import { visibleAuthorIds, visibleRecipeWhere } from './recipeVisibility.js'
import type { RecipeWithIngredients } from './recipeMatcher.js'
import { catalogAuditIssuesFor } from './catalogRecipeAudit.js'
import { isRetiredRecipe } from './recipeCatalogOrder.js'
import { loadFichaMenuConstraints } from './profile/reader.js'
import { unlistedDietMentions } from './stepDietMentions.js'
import { loadDishDislikeOverrides } from './dishDislikes.js'

/**
 * The two CPU-heavy reads of every recipe — what its steps name that the
 * ingredients don't (PRO-346) and the catalogue audit (PRO-73) — kept per
 * recipe and reused while their inputs don't change (2026-11-10). They took
 * ~250 ms of CPU per call over 400 recipes on a laptop (seconds on the
 * server), on every `GET /recipes?fitsMe=1`, `/taste/status`, «al azar» and
 * menu generation; Node runs one thing at a time, so a menu change sent
 * meanwhile waited for them (Miguel, 2026-11-10: «tardan mucho en
 * mostrarse»). The key is the inputs themselves, so an edited recipe is read
 * again; one entry per recipe id.
 */
const mentionsMemo = new Map<string, { key: string; value: RecipeWithIngredients['stepMentions'] }>()
const auditMemo = new Map<string, { key: string; value: ReturnType<typeof catalogAuditIssuesFor> }>()

/**
 * Two memos (2026-11-10): the step mentions per recipe id (they don't depend
 * on the household), the audit per `id|strictProteinMinimum` — so households
 * with and without «proteína en cada plato» don't throw each other's out.
 */
export function derivedRecipeReads(
  id: string,
  authorId: string | null,
  steps: string[],
  ingredientNames: string[],
  audit: Parameters<typeof catalogAuditIssuesFor>[1],
  auditOptions: Parameters<typeof catalogAuditIssuesFor>[2],
) {
  const mentionsKey = JSON.stringify([steps, ingredientNames])
  let mentions = mentionsMemo.get(id)
  if (!mentions || mentions.key !== mentionsKey) {
    mentions = {
      key: mentionsKey,
      value: unlistedDietMentions(steps, ingredientNames).map(({ term, category }) => ({ term, category })),
    }
    mentionsMemo.set(id, mentions)
  }
  const auditId = `${id}|${auditOptions?.strictProteinMinimum ? 1 : 0}`
  const auditKey = JSON.stringify([authorId, audit, auditOptions ?? {}])
  let checked = auditMemo.get(auditId)
  if (!checked || checked.key !== auditKey) {
    checked = { key: auditKey, value: catalogAuditIssuesFor(authorId, audit, auditOptions) }
    auditMemo.set(auditId, checked)
  }
  return { stepMentions: mentions.value, audit: checked.value }
}

/** Tests only. */
export function _clearDerivedRecipeMemo(): void {
  mentionsMemo.clear()
  auditMemo.clear()
}

/** `authorId`: null for the catalogue, the household member's id for their own recipes (PRO-1141 looks there first). */
export type RecipeWithCourse = RecipeWithIngredients & { course: Course | null; authorId?: string | null }

/**
 * Every recipe the user may be served, shaped for the matcher: the weekly
 * generator, single-slot regenerations (menus.ts) and the assistant's swap
 * all load through here, so they apply the same filters (fit maps,
 * frequency, equipment, prep time, allergens).
 * The catalogue audit (PRO-73) runs with the household ficha's options: a
 * household where someone wants protein in every dish (`protein_minimum`)
 * keeps the 80 g minimum for starters and rice/legume dishes too.
 *
 * Visibility: catalogue + the user's and their household's own recipes —
 * never other users' private recipes (specs/recipes.md).
 * Allergens: the recipe's union plus each ingredient's catalogue tags, so
 * the restriction check doesn't depend on a stale recipe-level union.
 * Retired catalogue recipes (PRO-140) are never picked or suggested, nor are
 * bases (PRO-373: sofrito, verduras asadas… are cooked for the dishes that
 * use them, never served as a dish).
 */
export async function loadMatchableRecipes(userId: string, db: any = defaultDb): Promise<RecipeWithCourse[]> {
  const allRecipes = (await db.select().from(recipes).where(visibleRecipeWhere(await visibleAuthorIds(userId, db)))).filter(
    (r: any) => !isRetiredRecipe(r) && !isBaseRecipe(r),
  )

  const recipeIds = allRecipes.map((r: any) => r.id)
  if (recipeIds.length === 0) return []

  // The household's ficha decides how strict the audit's protein minimum is:
  // someone with «proteína en cada plato» (`protein_minimum`, Miguel
  // 2026-10-21) keeps it for starters and rice/legume dishes too.
  const ficha = await loadFichaMenuConstraints(userId, { db })
  const auditOptions = { strictProteinMinimum: ficha.strictProteinMinimum }

  const riRows = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      ingredientId: recipeIngredients.ingredientId,
      quantity: recipeIngredients.quantity,
      unit: recipeIngredients.unit,
      note: recipeIngredients.note,
      ingredientName: ingredients.name,
      allergenTags: ingredients.allergenTags,
      containsTags: ingredients.containsTags,
      unitWeight: ingredients.unitWeight,
      density: ingredients.density,
      edibleFraction: ingredients.edibleFraction,
      aisle: ingredients.aisle,
      rowId: recipeIngredients.id,
      optional: recipeIngredients.optional,
      displayUnit: recipeIngredients.displayUnit,
      category: ingredients.category,
      role: recipeIngredients.role,
      substituteIngredientIds: recipeIngredients.substituteIngredientIds,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(inArray(recipeIngredients.recipeId, recipeIds))

  // Step texts: their count for the catalogue quality audit (PRO-73) and
  // what they name that the ingredients don't (PRO-346).
  const stepRows = await db
    .select({ recipeId: recipeSteps.recipeId, index: recipeSteps.index, text: recipeSteps.text })
    .from(recipeSteps)
    .where(inArray(recipeSteps.recipeId, recipeIds))
  const stepsByRecipe = new Map<string, Array<{ index: number; text: string }>>()
  for (const s of stepRows) {
    const list = stepsByRecipe.get(s.recipeId) ?? []
    list.push({ index: s.index, text: s.text ?? '' })
    stepsByRecipe.set(s.recipeId, list)
  }
  const stepTexts = (recipeId: string) => [...(stepsByRecipe.get(recipeId) ?? [])].sort((a, b) => a.index - b.index).map((s) => s.text)

  // PRO-1142: a dislike that names the dish keeps it out unless the household
  // said «Me apetece» (or «Me encanta», or 5 stars) after it. A read error
  // keeps every dislike.
  const dislikesOverridden = await loadDishDislikeOverrides(userId, allRecipes, db).catch(() => new Map<string, string[]>())

  const auditLinesByRecipe = new Map<string, Array<{ name: string; quantity: number; unit: string; unitWeight: number | null; density: number | null; edibleFraction: number | null; note: string | null }>>()
  const ingredientsByRecipe = new Map<string, RecipeWithIngredients['ingredients']>()
  for (const row of riRows) {
    const lines = auditLinesByRecipe.get(row.recipeId) ?? []
    lines.push({ name: row.ingredientName, quantity: row.quantity, unit: row.unit ?? 'g', unitWeight: row.unitWeight ?? null, density: row.density ?? null, edibleFraction: row.edibleFraction ?? null, note: row.note ?? null })
    auditLinesByRecipe.set(row.recipeId, lines)
    const list = ingredientsByRecipe.get(row.recipeId) ?? []
    list.push({
      ingredientId: row.ingredientId,
      ingredientName: row.ingredientName,
      quantity: row.quantity,
      unit: row.unit ?? 'g',
      allergenTags: row.allergenTags ?? [],
      containsTags: row.containsTags ?? [],
      // Grams per serving for the week rules (PRO-280).
      unitWeight: row.unitWeight ?? null,
      density: row.density ?? null,
      edibleFraction: row.edibleFraction ?? null,
      note: row.note ?? null,
      aisle: row.aisle ?? null,
      // «Cocinar ahora» (specs/cook-now.md).
      rowId: row.rowId,
      optional: row.optional ?? false,
      displayUnit: row.displayUnit ?? null,
      category: row.category ?? null,
      role: row.role === 'essential' || row.role === 'secondary' ? row.role : null,
      substituteIngredientIds: row.substituteIngredientIds ?? [],
    })
    ingredientsByRecipe.set(row.recipeId, list)
  }

  const derivedOf = new Map<string, ReturnType<typeof derivedRecipeReads>>()
  const derived = (r: any) => {
    let d = derivedOf.get(r.id)
    if (!d) {
      d = derivedRecipeReads(
        r.id,
        r.authorId ?? null,
        stepTexts(r.id),
        (ingredientsByRecipe.get(r.id) ?? []).map((i) => i.ingredientName),
        {
          name: r.name,
          servings: r.servings ?? 4,
          course: (r.course as string | null | undefined) ?? null,
          meals: r.meals ?? [],
          stepCount: stepsByRecipe.get(r.id)?.length ?? 0,
          ingredients: auditLinesByRecipe.get(r.id) ?? [],
        },
        auditOptions,
      )
      derivedOf.set(r.id, d)
    }
    return d
  }

  return allRecipes.map((r: any) => ({
    id: r.id,
    name: r.name,
    authorId: r.authorId ?? null,
    meals: r.meals ?? [],
    seasons: r.seasons ?? [],
    // Three-state fit maps (migration 0024); legacy rows have null and the
    // matcher derives 'perfect' from the array tagging.
    mealFit: r.mealFit ?? undefined,
    seasonFit: r.seasonFit ?? undefined,
    // Frequency hint (migration 0026). Null = 'normal'.
    frequency: r.frequency ?? null,
    tags: r.tags ?? [],
    equipment: r.equipment ?? [],
    prepTime: r.prepTime ?? null,
    cookTime: r.cookTime ?? null,
    activeTime: r.activeTime ?? null,
    totalTime: r.totalTime ?? null,
    allergens: r.allergens ?? [],
    // Course classification for multi-dish slot building (starter/main/dessert).
    course: (r.course as Course | null | undefined) ?? null,
    // Dish type / main protein (`tipo:`, `proteina:`) and kcal per serving,
    // for the week rules and the planner (PRO-254/255).
    internalTags: r.internalTags ?? [],
    nutritionPerServing: r.nutritionPerServing ?? null,
    servings: r.servings ?? null,
    ingredients: ingredientsByRecipe.get(r.id) ?? [],
    // PRO-346: meat, fish or allergens the steps name and the ingredients
    // don't (PRO-268's list for Cocina). The diet filter counts them as
    // ingredients until the recipe is fixed: «Lentejas guisadas» with
    // «añadir chorizo y morcilla» isn't vegetarian.
    stepMentions: derived(r).stepMentions,
    dislikesOverridden: dislikesOverridden.get(r.id) ?? [],
    // PRO-73: catalogue recipes with no steps, too few ingredients or
    // quantities out of range are skipped by the matcher. Computed here, on
    // read; nothing is written. Users' own recipes are never audited.
    catalogAuditIssues: derived(r).audit,
  }))
}
