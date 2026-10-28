/**
 * «Con lo que tengo» (PRO-31): the user names 1–3 ingredients they have and
 * gets recipes from their own recipes and the Mimoia catalogue, ranked by
 * how many of those ingredients each recipe uses. Every hit says what would
 * be missing, not counting the basics everyone has (salt, oil, water,
 * pepper, flour) nor optional ingredients. Recipes that clash with the
 * user's allergies, diet or dislikes never appear — same rules as the
 * assistant's `suggest_recipes` (`loadUserRestrictions` is shared).
 *
 * One search, two doors: `GET /recipes/with-what-i-have` (the catalogue
 * filter on `/recipes`) and Mimo's `cook_with_what_i_have` tool.
 */
import { eq, inArray } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { ingredients, recipeIngredients, recipeSteps, recipes, users } from '../db/schema.js'
import {
  compileRestrictions,
  mergeRestrictions,
  nameHasTerm,
  normalizeText,
  violatesRestrictions,
  type CompiledRestrictions,
  type RestrictableRecipe,
} from './dietaryRestrictions.js'
import { visibleAuthorIds, visibleRecipeWhere } from './recipeVisibility.js'
import { unlistedDietMentions } from './stepDietMentions.js'

type Db = typeof defaultDb

/** At most this many ingredients per search (PRO-31: «hasta 3»). */
export const MAX_CHOSEN_INGREDIENTS = 3

/** Pantry basics: never reported as missing. */
export const BASIC_TERMS = ['sal', 'aceite', 'agua', 'pimienta', 'harina'] as const

export interface ChosenIngredient {
  /** Catalogue ingredient id (the `/recipes` picker); optional for free text (Mimo). */
  id?: string
  name: string
}

export interface CandidateIngredient {
  ingredientId: string
  ingredientName: string
  optional?: boolean
  allergenTags?: readonly string[] | null
  containsTags?: readonly string[] | null
}

export interface CandidateRecipe {
  id: string
  name: string
  authorId?: string | null
  allergens?: readonly string[] | null
  ingredients: CandidateIngredient[]
  /** PRO-346: what the steps name and the ingredients don't (`unlistedDietMentions`). */
  stepMentions?: RestrictableRecipe['stepMentions']
}

export interface WithWhatIHaveHit<R extends CandidateRecipe = CandidateRecipe> {
  recipe: R
  /** Names (as the user chose them) of the chosen ingredients this recipe uses. */
  uses: string[]
  /** Required, non-basic ingredients the user didn't name. */
  missing: string[]
}

/** «Huevos» → «huevo», «calabacines» → «calabacin», «tomates» → «tomate». */
export function singularTerm(name: string): string {
  const n = normalizeText(name)
  return n
    .split(' ')
    .map((w) => {
      if (w.length > 4 && /[rnldzj]es$/.test(w)) return w.slice(0, -2)
      if (w.length > 3 && w.endsWith('s')) return w.slice(0, -1)
      return w
    })
    .join(' ')
}

export function isBasicIngredient(name: string): boolean {
  const n = normalizeText(name)
  return BASIC_TERMS.some((t) => nameHasTerm(n, t))
}

/** Does this recipe ingredient count as the chosen one? Same id, or its name contains the chosen word. */
function ingredientMatches(ing: CandidateIngredient, chosen: ChosenIngredient, term: string): boolean {
  if (chosen.id && ing.ingredientId === chosen.id) return true
  return term.length > 0 && nameHasTerm(normalizeText(ing.ingredientName), term)
}

/**
 * Pure ranking: keep recipes that use at least one chosen ingredient and
 * don't break the user's rules; order by how many chosen ingredients they
 * use, then by how little is missing, then by name.
 */
export function rankWithWhatIHave<R extends CandidateRecipe>(
  candidates: readonly R[],
  chosen: readonly ChosenIngredient[],
  rules: CompiledRestrictions,
  maxChosen: number = MAX_CHOSEN_INGREDIENTS,
): WithWhatIHaveHit<R>[] {
  const picks = chosen
    .filter((c) => c.name.trim().length > 0 || c.id)
    .slice(0, maxChosen)
    .map((c) => ({ chosen: c, term: singularTerm(c.name) }))
  if (picks.length === 0) return []

  const hits: WithWhatIHaveHit<R>[] = []
  for (const recipe of candidates) {
    if (violatesRestrictions(recipe, rules)) continue
    const uses = picks.filter((p) => recipe.ingredients.some((ing) => ingredientMatches(ing, p.chosen, p.term)))
    if (uses.length === 0) continue
    const missing: string[] = []
    for (const ing of recipe.ingredients) {
      if (ing.optional) continue
      if (isBasicIngredient(ing.ingredientName)) continue
      if (picks.some((p) => ingredientMatches(ing, p.chosen, p.term))) continue
      if (!missing.includes(ing.ingredientName)) missing.push(ing.ingredientName)
    }
    hits.push({ recipe, uses: uses.map((u) => u.chosen.name), missing })
  }
  return hits.sort(
    (a, b) =>
      b.uses.length - a.uses.length ||
      a.missing.length - b.missing.length ||
      a.recipe.name.localeCompare(b.recipe.name, 'es'),
  )
}

/**
 * The user's allergies + diet (profile and memory) and dislikes (memory).
 * Shared with the assistant's `suggest_recipes` so both apply the same rules.
 */
export async function loadUserRestrictions(
  userId: string,
  db: any = defaultDb,
): Promise<{ restrictions: string[]; dislikes: string[] }> {
  const [user] = await db
    .select({ restrictions: users.restrictions })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  const { getMemoryForUser } = await import('./userMemoryStore.js')
  const memory = await getMemoryForUser(userId).catch(() => null)
  const dislikesValue = memory?.dislikes?.value
  return {
    restrictions: mergeRestrictions(user?.restrictions, memory),
    dislikes: Array.isArray(dislikesValue) ? (dislikesValue as string[]) : [],
  }
}

type RecipeRow = typeof recipes.$inferSelect

/**
 * DB entry point: every recipe the user can see (catalogue + their
 * household's own; a system recipe the user copied shows as their copy
 * only), ranked by `rankWithWhatIHave`.
 */
export async function findRecipesWithWhatIHave(
  userId: string,
  chosen: readonly ChosenIngredient[],
  db: any = defaultDb,
  limit = 100,
  opts: {
    /** Recipes never to propose: the week's menu vetoes (PRO-222). */
    excludeIds?: ReadonlySet<string>
    /** How many named ingredients count (the `/recipes` picker: 3; Mimo, from a fridge photo: more). */
    maxChosen?: number
  } = {},
): Promise<WithWhatIHaveHit<CandidateRecipe & { row: RecipeRow }>[]> {
  if (chosen.length === 0) return []
  const { restrictions, dislikes } = await loadUserRestrictions(userId, db)
  const rules = compileRestrictions(restrictions, dislikes)

  const rows: RecipeRow[] = await db.select().from(recipes).where(visibleRecipeWhere(await visibleAuthorIds(userId, db)))
  const copied = new Set(rows.filter((r) => r.authorId && r.copiedFromRecipeId).map((r) => r.copiedFromRecipeId as string))
  const visible = rows.filter((r) => !copied.has(r.id) && !opts.excludeIds?.has(r.id))
  if (visible.length === 0) return []

  const ingRows = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      ingredientId: recipeIngredients.ingredientId,
      ingredientName: ingredients.name,
      optional: recipeIngredients.optional,
      allergenTags: ingredients.allergenTags,
      containsTags: ingredients.containsTags,
    })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
    .where(inArray(recipeIngredients.recipeId, visible.map((r) => r.id)))
  const byRecipe = new Map<string, CandidateIngredient[]>()
  for (const r of ingRows as any[]) {
    const list = byRecipe.get(r.recipeId) ?? []
    list.push({ ingredientId: r.ingredientId, ingredientName: r.ingredientName, optional: !!r.optional, allergenTags: r.allergenTags ?? [], containsTags: r.containsTags ?? [] })
    byRecipe.set(r.recipeId, list)
  }

  // PRO-346: what the steps name and the ingredients don't counts for the diet too.
  const stepRows = await db
    .select({ recipeId: recipeSteps.recipeId, index: recipeSteps.index, text: recipeSteps.text })
    .from(recipeSteps)
    .where(inArray(recipeSteps.recipeId, visible.map((r) => r.id)))
  const stepsByRecipe = new Map<string, Array<{ index: number; text: string }>>()
  for (const s of (stepRows ?? []) as any[]) {
    const list = stepsByRecipe.get(s.recipeId) ?? []
    list.push({ index: s.index, text: s.text ?? '' })
    stepsByRecipe.set(s.recipeId, list)
  }
  const stepTexts = (id: string) => [...(stepsByRecipe.get(id) ?? [])].sort((a, b) => a.index - b.index).map((s) => s.text)

  const candidates = visible.map((row) => ({
    id: row.id,
    name: row.name,
    authorId: row.authorId,
    allergens: row.allergens ?? [],
    ingredients: byRecipe.get(row.id) ?? [],
    stepMentions: unlistedDietMentions(stepTexts(row.id), (byRecipe.get(row.id) ?? []).map((i) => i.ingredientName)),
    row,
  }))
  return rankWithWhatIHave(candidates, chosen, rules, opts.maxChosen).slice(0, limit)
}

/** Catalogue ingredient names for the ids the `/recipes` picker sends. */
export async function chosenFromIds(ids: readonly string[], db: any = defaultDb): Promise<ChosenIngredient[]> {
  const unique = [...new Set(ids)].slice(0, MAX_CHOSEN_INGREDIENTS)
  if (unique.length === 0) return []
  const rows = await db.select({ id: ingredients.id, name: ingredients.name }).from(ingredients).where(inArray(ingredients.id, unique))
  return (rows as Array<{ id: string; name: string }>).map((r) => ({ id: r.id, name: r.name }))
}
