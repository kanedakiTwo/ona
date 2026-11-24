/**
 * PRO-1290 — the office fixes a catalogue recipe through the API
 * (`PATCH /admin/catalog-recipes/:id`, specs/admin-dashboard.md).
 *
 * Its ingredients, allergens, steps, times and tags. A list sent replaces
 * the recipe's (ingredients, steps, tags); a time sent (or null) replaces
 * that time; what isn't sent stays. The save goes through `persistRecipe`
 * (lint, nutrition, allergens from the ingredients, total time), so the
 * recipe ends up as if it had been saved from the editor.
 *
 * Before anything is written, the allergen audit (`allergenAudit`, pure):
 *   - `allergens`, when sent, is what the recipe must carry after the fix;
 *     the recipe's allergens come from its ingredients, so they must match;
 *   - an allergen the recipe had and loses is only accepted when `allergens`
 *     confirms it (a fix never drops one by accident);
 *   - the steps can't name meat, fish, shellfish or an allergen its
 *     ingredients don't account for (`unlistedDietMentions`), unless the
 *     term is in `acceptMentions` (a false positive the office checked).
 * Any of those holds the save (nothing written) with what failed.
 *
 * The audit row (`catalog_recipe.edit`) is written in the same transaction
 * as the save, with the before and after of what changed. Only recipes of
 * the catalogue (no author), draft or published.
 */
import { asc, eq, inArray } from 'drizzle-orm'
import type { Difficulty, Meal, Season, SourceType, Unit } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { ingredients, recipeIngredients, recipeSteps, recipes } from '../db/schema.js'
import { diff, record } from './auditLog.js'
import { recheckMenusForRecipe } from './menuRecipeRecheck.js'
import { allergenUnion } from './nutrition/allergens.js'
import { persistRecipe, type RecipeIngredientWriteInput, type RecipeStepWriteInput, type RecipeWriteInput } from './recipePersistence.js'
import type { LintIssue } from './recipeLint.js'
import { DIET_CATEGORY_LABEL, unlistedDietMentions, type DietCategory } from './stepDietMentions.js'

type Db = typeof defaultDb

export interface CatalogRecipeStepPatch {
  text: string
  durationMin?: number | null
  temperature?: number | null
  technique?: string | null
  /** A kept row's id or `ing_<n>` (the n-th ingredient of the list sent). */
  ingredientRefs?: string[]
}

export interface CatalogRecipePatch {
  /** The full list; replaces the recipe's. A row sent with its id keeps it (and the steps' links). */
  ingredients?: RecipeIngredientWriteInput[]
  /** The full list, in order; replaces the recipe's. */
  steps?: CatalogRecipeStepPatch[]
  /** The allergens the recipe must carry after the fix (checked, not written: they come from the ingredients). */
  allergens?: string[]
  prepTime?: number | null
  cookTime?: number | null
  activeTime?: number | null
  tags?: string[]
  /** Terms of the steps check the office has checked by hand («hueso»). */
  acceptMentions?: string[]
  /** Why: goes to the audit row. */
  reason?: string
}

// ─── The allergen audit (pure) ──────────────────────────────────

export type AllergenAuditIssue =
  | { code: 'ALLERGENS_MISMATCH'; message: string; missing: string[]; extra: string[] }
  | { code: 'ALLERGEN_LOST'; message: string; lost: string[] }
  | { code: 'STEP_MENTIONS'; message: string; mentions: Array<{ step: number; term: string; category: DietCategory }> }

export interface AllergenAuditInput {
  /** The recipe's allergens as saved. */
  before: readonly string[]
  /** The allergens of the new ingredient list. */
  after: readonly string[]
  /** `allergens` of the patch, when sent. */
  declared?: readonly string[]
  steps: readonly string[]
  ingredientNames: readonly string[]
  acceptMentions?: readonly string[]
}

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort()
const list = (xs: readonly string[]) => xs.join(', ')

export function allergenAudit(input: AllergenAuditInput): AllergenAuditIssue[] {
  const issues: AllergenAuditIssue[] = []
  const after = new Set(input.after)
  if (input.declared) {
    const declared = new Set(input.declared)
    const missing = sorted([...declared].filter((a) => !after.has(a)))
    const extra = sorted([...after].filter((a) => !declared.has(a)))
    if (missing.length || extra.length) {
      const parts: string[] = []
      if (missing.length) parts.push(`los ingredientes no llevan ${list(missing)}`)
      if (extra.length) parts.push(`los ingredientes llevan ${list(extra)}, que no está en la lista`)
      issues.push({ code: 'ALLERGENS_MISMATCH', message: `Los alérgenos no cuadran: ${parts.join('; ')}.`, missing, extra })
    }
  } else {
    const lost = sorted(input.before.filter((a) => !after.has(a)))
    if (lost.length) {
      issues.push({
        code: 'ALLERGEN_LOST',
        message: `La receta deja de llevar ${list(lost)}. Si es lo que toca, mándalo confirmado en «allergens».`,
        lost,
      })
    }
  }
  const accepted = new Set((input.acceptMentions ?? []).map((t) => t.trim().toLowerCase()))
  const mentions = unlistedDietMentions(input.steps, input.ingredientNames)
    .filter((m) => !accepted.has(m.term))
    .map((m) => ({ step: m.step + 1, term: m.term, category: m.category }))
  if (mentions.length) {
    const what = mentions.map((m) => `«${m.term}» (${DIET_CATEGORY_LABEL[m.category]}, paso ${m.step})`).join(', ')
    issues.push({ code: 'STEP_MENTIONS', message: `Los pasos nombran ${what} y los ingredientes no lo llevan.`, mentions })
  }
  return issues
}

// ─── What the audit row keeps ───────────────────────────────────

interface Snapshot extends Record<string, unknown> {
  ingredients: Array<{ name: string; quantity: number; unit: string; section: string | null; optional: boolean; note: string | null }>
  steps: Array<{ text: string; durationMin: number | null }>
  allergens: string[]
  prepTime: number | null
  cookTime: number | null
  activeTime: number | null
  tags: string[]
}

function snapshot(
  r: { ingredients: readonly RecipeIngredientWriteInput[]; steps: readonly RecipeStepWriteInput[]; prepTime?: number | null; cookTime?: number | null; activeTime?: number | null; tags?: string[] },
  allergens: readonly string[],
  names: ReadonlyMap<string, string>,
): Snapshot {
  return {
    ingredients: r.ingredients.map((i) => ({
      name: names.get(i.ingredientId) ?? i.ingredientId,
      quantity: i.quantity,
      unit: i.unit,
      section: i.section ?? null,
      optional: i.optional ?? false,
      note: i.note ?? null,
    })),
    steps: r.steps.map((s) => ({ text: s.text, durationMin: s.durationMin ?? null })),
    allergens: sorted(allergens),
    prepTime: r.prepTime ?? null,
    cookTime: r.cookTime ?? null,
    activeTime: r.activeTime ?? null,
    tags: [...(r.tags ?? [])],
  }
}

// ─── The edit ───────────────────────────────────────────────────

export type CatalogRecipeEditResult =
  | { ok: true; id: string; name: string; changed: string[]; allergens: string[]; warnings: LintIssue[] }
  | { ok: false; code: 'NOT_FOUND' }
  | { ok: false; code: 'UNKNOWN_INGREDIENT'; ids: string[] }
  | { ok: false; code: 'ALLERGEN_AUDIT'; issues: AllergenAuditIssue[] }
  | { ok: false; code: 'LINT'; errors: LintIssue[]; warnings: LintIssue[] }

/** The catalogue recipe as a full write input, plus its saved allergens. */
async function loadCatalogRecipe(id: string, db: Db): Promise<{ input: RecipeWriteInput; name: string; allergens: string[] } | null> {
  const [row] = await db.select().from(recipes).where(eq(recipes.id, id)).limit(1)
  if (!row || row.authorId !== null) return null
  const ings = await db.select().from(recipeIngredients).where(eq(recipeIngredients.recipeId, id)).orderBy(asc(recipeIngredients.displayOrder))
  const steps = await db.select().from(recipeSteps).where(eq(recipeSteps.recipeId, id)).orderBy(asc(recipeSteps.index))
  const input: RecipeWriteInput = {
    name: row.name,
    imageUrl: row.imageUrl,
    servings: row.servings,
    servingsConfidence: row.servingsConfidence,
    yieldText: row.yieldText,
    prepTime: row.prepTime,
    cookTime: row.cookTime,
    activeTime: row.activeTime,
    difficulty: (row.difficulty ?? 'medium') as Difficulty,
    meals: row.meals as Meal[],
    seasons: row.seasons as Season[],
    ...(row.mealFit ? { mealFit: row.mealFit as RecipeWriteInput['mealFit'] } : {}),
    ...(row.seasonFit ? { seasonFit: row.seasonFit as RecipeWriteInput['seasonFit'] } : {}),
    frequency: row.frequency as RecipeWriteInput['frequency'],
    equipment: row.equipment ?? [],
    notes: row.notes,
    tips: row.tips,
    substitutions: row.substitutions,
    storage: row.storage,
    advancePrep: row.advancePrep,
    tags: row.tags ?? [],
    internalTags: row.internalTags ?? [],
    sourceUrl: row.sourceUrl,
    sourceType: row.sourceType as SourceType | null,
    course: row.course,
    ingredients: ings.map((i) => ({
      id: i.id,
      ingredientId: i.ingredientId,
      section: i.section,
      quantity: i.quantity,
      unit: i.unit as Unit,
      optional: i.optional,
      note: i.note,
      displayOrder: i.displayOrder,
      displayQuantity: i.displayQuantity,
      displayUnit: i.displayUnit,
    })),
    steps: steps.map((s) => ({
      index: s.index,
      text: s.text,
      durationMin: s.durationMin,
      temperature: s.temperature,
      technique: s.technique,
      ingredientRefs: s.ingredientRefs ?? [],
    })),
  }
  return { input, name: row.name, allergens: row.allergens ?? [] }
}

/** Pure: the saved recipe with the patch on top. Kept steps drop links to rows that left the list. */
export function applyPatch(saved: RecipeWriteInput, patch: CatalogRecipePatch): RecipeWriteInput {
  const out: RecipeWriteInput = { ...saved }
  if (patch.ingredients) out.ingredients = patch.ingredients.map((i, n) => ({ ...i, displayOrder: i.displayOrder ?? n }))
  if (patch.steps) {
    out.steps = patch.steps.map((s, index) => ({ ...s, index, ingredientRefs: s.ingredientRefs ?? [] }))
  } else if (patch.ingredients) {
    const kept = new Set(out.ingredients.map((i) => i.id).filter(Boolean))
    out.steps = saved.steps.map((s) => ({ ...s, ingredientRefs: (s.ingredientRefs ?? []).filter((r) => kept.has(r)) }))
  }
  for (const k of ['prepTime', 'cookTime', 'activeTime'] as const) {
    if (patch[k] !== undefined) out[k] = patch[k]
  }
  if (patch.tags) out.tags = patch.tags
  return out
}

export async function editCatalogRecipe(id: string, patch: CatalogRecipePatch, adminId: string, db: Db = defaultDb): Promise<CatalogRecipeEditResult> {
  const saved = await loadCatalogRecipe(id, db)
  if (!saved) return { ok: false, code: 'NOT_FOUND' }
  const next = applyPatch(saved.input, patch)

  const ids = [...new Set([...saved.input.ingredients, ...next.ingredients].map((i) => i.ingredientId))]
  const catalog = await db.select({ id: ingredients.id, name: ingredients.name, allergenTags: ingredients.allergenTags }).from(ingredients).where(inArray(ingredients.id, ids))
  const byId = new Map(catalog.map((c) => [c.id, c]))
  const unknown = next.ingredients.map((i) => i.ingredientId).filter((i) => !byId.has(i))
  if (unknown.length) return { ok: false, code: 'UNKNOWN_INGREDIENT', ids: [...new Set(unknown)] }

  const after = allergenUnion(next.ingredients, byId)
  const issues = allergenAudit({
    before: saved.allergens,
    after,
    declared: patch.allergens,
    steps: next.steps.map((s) => s.text),
    ingredientNames: next.ingredients.map((i) => byId.get(i.ingredientId)!.name),
    acceptMentions: patch.acceptMentions,
  })
  if (issues.length) return { ok: false, code: 'ALLERGEN_AUDIT', issues }

  const names = new Map(catalog.map((c) => [c.id, c.name]))
  const change = diff(snapshot(saved.input, saved.allergens, names), snapshot(next, after, names))
  const changed = Object.keys(change.after)
  if (changed.length === 0) return { ok: true, id, name: saved.name, changed, allergens: after, warnings: [] }

  const result = await persistRecipe(next, {
    authorId: null,
    recipeId: id,
    preserveExistingImage: true,
    inTransaction: async (tx) => {
      await record({
        adminId,
        action: 'catalog_recipe.edit',
        targetType: 'recipe',
        targetId: id,
        payload: {
          name: saved.name,
          reason: patch.reason ?? null,
          ...(patch.acceptMentions?.length ? { acceptMentions: patch.acceptMentions } : {}),
          ...change,
        },
      }, tx)
    },
  })
  if (!result.ok) return { ok: false, code: 'LINT', errors: result.errors, warnings: result.warnings }
  // The saved menus with this recipe from today on, against each household's allergies and diet (PRO-345).
  recheckMenusForRecipe(id)
  return { ok: true, id, name: saved.name, changed, allergens: result.allergens, warnings: result.warnings }
}
