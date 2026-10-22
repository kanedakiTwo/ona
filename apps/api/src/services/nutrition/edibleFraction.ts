/**
 * PRO-194 — edible share of bone-in cuts.
 *
 * Recipes give meat as bought («1.350 g de gallina», «5 manitas de cerdo»,
 * «1,1 kg de chuletón») and the catalogue's per-100 g values are of the
 * edible part, so the bone was being counted as meat. `ingredients.
 * edible_fraction` (0–1, default 1) holds the share that is eaten; the
 * aggregator and the catalogue audit multiply by it.
 *
 * The values below are the USDA SR Legacy refuse (bone, and cartilage where
 * listed) of the closest raw entry, rounded; the ones marked ≈ are estimates
 * for Spanish cuts with no exact USDA entry, for Cocina to review.
 *
 * Only names that say the cut comes with bone get a value: «conejo» alone is
 * left at 1 because Cocina gave it the meat weight per unit (700 g), and
 * anything «deshuesado», «sin hueso», «fileteado», «picado», «carne de…»
 * or a stock is never touched.
 *
 * PRO-281 adds whole fish and shellfish in their shell, and PRO-282 the
 * stock bones (0: nothing of them is eaten). USDA SR Legacy gives these raw
 * entries as edible portion with 0 % refuse (`FOOD_DES.Refuse`, sr28asc, read
 * 2026-10-22), so the reference for them is the Spanish BEDCA «porción
 * comestible» (bedca.net, read 2026-10-22); where it differs from Cocina's
 * value the comment says so and the value stays Cocina's, for Cocina to decide.
 *
 * Spec: ../../../../../specs/nutrition.md ("Edible weight")
 */
import { and, eq, inArray } from 'drizzle-orm'
import { ingredients, recipeIngredients, recipes } from '../../db/schema.js'
import { aggregateNutrition, type IngredientCatalogEntry } from './aggregate.js'
import type { RecipeIngredient } from '@ona/shared'

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/** [pattern on the normalised name, edible fraction]. First match wins. */
export const EDIBLE_FRACTION_RULES: ReadonlyArray<readonly [RegExp, number]> = [
  // Chicken / hen (USDA: broiler whole meat+skin refuse 32 %; stewing hen ≈30 %)
  [/^gallinas?\b/, 0.7],
  [/^pollos? (entero|de corral entero|campero entero)s?\b/, 0.68],
  [/^alitas?( de pollo)?\b|^alas de pollo\b/, 0.54], // wing: refuse 46 %
  [/^(muslos?|jamoncitos?)( de pollo)?\b/, 0.7], // drumstick: refuse ≈30 %
  [/^contramuslos?( de pollo)?\b/, 0.8], // thigh with bone: refuse ≈20 %
  [/^cuartos? traseros?( de pollo)?\b/, 0.74], // leg quarter: refuse 26 %
  // Turkey
  [/^alas de pavo\b|^alitas de pavo\b/, 0.6], // ≈
  [/^muslos? de pavo\b/, 0.7], // ≈
  // Pork / lamb / beef
  [/^costillas?\b|^costillar\b/, 0.7], // spareribs: refuse ≈28–30 %
  [/^chuleton\b/, 0.85], // bone-in rib steak ≈15 %
  [/^chuletillas?\b/, 0.7], // lamb rib chops ≈
  [/^chuletas?\b/, 0.8], // bone-in chops ≈20 %
  [/^(manitas?|pies?|patas?) de cerdo\b/, 0.5], // ≈ trotters: half bone
  [/^rabo de (toro|vaca|ternera|buey)\b|^rabo\b/, 0.5], // ≈ oxtail
  [/^oss?obucos?\b/, 0.8], // ≈ shank slice with marrow bone («osobuco», «ossobuco»)
  [/^codillos?\b/, 0.7], // ≈ pork knuckle
  [/^paletilla\b|^pierna de cordero\b|^pierna de cabrito\b/, 0.75], // ≈ bone-in lamb shoulder / leg
  [/^cuellos? de (cordero|cabrito|cerdo|ternera)\b/, 0.6], // ≈ neck: many small bones
  // Rabbit: only when the name says it is whole
  [/^conejo entero\b/, 0.73], // ≈ USDA rabbit composite refuse 27 %
  [/^codorni(z|ces)\b/, 0.65], // ≈ whole quail
  [/^perdi(z|ces)\b/, 0.65], // ≈ whole partridge
]

/**
 * PRO-282 — bones that only flavour a stock: nothing of them is eaten (0).
 * Checked before `BONELESS`, whose «caldo» would hide «huesos para caldo».
 * Anchored at the start, so «caldo de huesos» (the stock itself) never matches.
 * What the stock draws from the bone is not counted (a little low, on purpose).
 */
export const STOCK_BONE_RULES: ReadonlyArray<readonly [RegExp, number]> = [
  [/^(huesos?|espinazos?|carcasas?|cartilagos?|raspas?)\b/, 0], // «huesos para caldo», «hueso de jamón», «hueso de rodilla», «carcasa de pollo»
  [/^espinas de pescado\b/, 0],
]

/**
 * PRO-281 — whole fish and shellfish in their shell, as bought. A plain
 * «mejillones» or «dorada» is taken as bought whole (that is how the catalogue
 * writes them); the name never gets a value when it says it is already the
 * edible part (`SHELLED`, plus everything in `BONELESS`). Mejillón, almeja,
 * chirla, berberecho, dorada and lubina come from the Ministerio de Agricultura
 * product sheets (Moreiras et al. tables, 2013; PRO-337, Cocina 2026-10-22) [V];
 * the rest are Cocina's [I], with BEDCA (porción comestible) next to them.
 */
export const SEAFOOD_EDIBLE_FRACTION_RULES: ReadonlyArray<readonly [RegExp, number]> = [
  [/^mejillon(es)?\b/, 0.25], // MAPA mejillón 25 %: https://servicio.mapa.gob.es/ca/ministerio/servicios/informacion/mejillon_tcm34-102425.pdf
  [/^(almejas?|chirlas?)\b/, 0.15], // MAPA almeja 15 %: https://servicio.mapama.gob.es/fr/ministerio/servicios/informacion/almeja_tcm36-102764.pdf
  [/^berberechos?\b/, 0.15], // MAPA berberecho 15 %: https://servicio.mapa.gob.es/ca/ministerio/servicios/informacion/berberecho_tcm34-102470.pdf
  [/^(gambas?|langostinos?|cigalas?)\b/, 0.48], // BEDCA gamba roja, langostino y cigala 0.47 (Cocina 0.48)
  [/^doradas?\b/, 0.55], // MAPA dorada 55 %: https://servicio.mapama.gob.es/en/ministerio/servicios/informacion/dorada_tcm38-102448.pdf
  [/^lubinas?\b/, 0.67], // MAPA lubina 67 %: https://servicio.mapama.gob.es/ca/ministerio/servicios/informacion/lubina_tcm34-102841.pdf
  [/^besugos?\b/, 0.5], // BEDCA besugo 0.55 (Cocina 0.5)
  [/^pescados?( [a-z]+)? enter[oa]s?\b/, 0.5], // «pescado entero», «pescado blanco entero»
]

/** Never bone-in, whatever the rest of the name says. */
const BONELESS = /deshuesad|sin hueso|filete|fileteado|picad|carne de|caldo|fondo|pechuga|lata|conserva/

/** Seafood that is already the edible part (peeled, cleaned, loins, tins). */
const SHELLED = /limpi|lomo|pelad|sin concha|sin cascara|sin cabeza|escabeche|al natural/

/** The edible fraction the rules give a catalogue name, or null when none applies. */
export function edibleFractionForName(name: string): number | null {
  const n = normalize(name)
  for (const [re, f] of STOCK_BONE_RULES) if (re.test(n)) return f
  if (BONELESS.test(n)) return null
  for (const [re, f] of EDIBLE_FRACTION_RULES) if (re.test(n)) return f
  if (SHELLED.test(n)) return null
  for (const [re, f] of SEAFOOD_EDIBLE_FRACTION_RULES) if (re.test(n)) return f
  return null
}

type Db = typeof import('../../db/connection.js').db

export interface EdibleFractionResult {
  /** Ingredients that got a fraction now. */
  set: string[]
  /** Recipes whose cached nutrition was recomputed because of it. */
  recomputed: number
}

/**
 * Values the rules gave before PRO-337 (PRO-281's first factors). A row still
 * holding one of them was set by this boot step, not by hand, so it moves to
 * the Ministerio's value.
 */
const SUPERSEDED_RULE_VALUES: ReadonlyArray<readonly [RegExp, number]> = [
  [/^mejillon(es)?\b/, 0.28],
  [/^(almejas?|berberechos?|chirlas?)\b/, 0.18],
  [/^(doradas?|lubinas?)\b/, 0.5],
]

/** Is `current` a value an earlier version of the rules wrote for this name? */
export function isSupersededRuleValue(name: string, current: number): boolean {
  const n = normalize(name)
  return SUPERSEDED_RULE_VALUES.some(([re, v]) => re.test(n) && Math.abs(current - v) < 1e-4)
}

/**
 * Boot step (after `db:migrate`): give the bone-in cuts still at the default
 * 1 the fraction the rules say, then recompute the cached nutrition (and the
 * «incompleta» mark) of every recipe that uses one of them — the
 * `recomputeRecipeNutrition --scope=all --execute` the task asks for, limited
 * to the recipes the change touches. A value someone set by hand (≠ 1) is
 * never changed; a value an earlier version of the rules wrote is
 * (`isSupersededRuleValue`, PRO-337). Idempotent: once set, the next boot finds nothing to do.
 */
export async function applyEdibleFractions(
  db: Db,
  log: (line: string) => void = console.log,
): Promise<EdibleFractionResult> {
  const rows = await db
    .select({ id: ingredients.id, name: ingredients.name, edibleFraction: ingredients.edibleFraction })
    .from(ingredients)
  const changes: Array<{ id: string; name: string; fraction: number; from: number }> = []
  for (const r of rows) {
    if (r.edibleFraction !== 1 && !isSupersededRuleValue(r.name, r.edibleFraction)) continue
    const f = edibleFractionForName(r.name)
    if (f != null && Math.abs(f - r.edibleFraction) >= 1e-4) {
      changes.push({ id: r.id, name: r.name, fraction: f, from: r.edibleFraction })
    }
  }
  if (changes.length === 0) {
    log('[edible-fraction] nada que cambiar')
    return { set: [], recomputed: 0 }
  }
  for (const c of changes) {
    await db
      .update(ingredients)
      .set({ edibleFraction: c.fraction })
      .where(
        // A float4 read back never equals the JS number exactly: only the default 1 is pinned.
        c.from === 1 ? and(eq(ingredients.id, c.id), eq(ingredients.edibleFraction, 1)) : eq(ingredients.id, c.id),
      )
  }
  const recomputed = await recomputeRecipesUsing(db, changes.map((c) => c.id))
  log(
    `[edible-fraction] ${changes.map((c) => `«${c.name}» ${c.fraction}`).join(', ')}; ${recomputed} receta(s) recalculada(s)`,
  )
  return { set: changes.map((c) => c.name), recomputed }
}

/** Recompute `nutrition_per_serving` + `nutrition_incomplete` of the recipes that use these ingredients. */
async function recomputeRecipesUsing(db: Db, ingredientIds: string[]): Promise<number> {
  const uses = await db
    .selectDistinct({ recipeId: recipeIngredients.recipeId })
    .from(recipeIngredients)
    .where(inArray(recipeIngredients.ingredientId, ingredientIds))
  const recipeIds = uses.map((u) => u.recipeId)
  if (recipeIds.length === 0) return 0

  const lines = await db
    .select({
      recipeId: recipeIngredients.recipeId,
      ingredientId: recipeIngredients.ingredientId,
      quantity: recipeIngredients.quantity,
      unit: recipeIngredients.unit,
      note: recipeIngredients.note,
    })
    .from(recipeIngredients)
    .where(inArray(recipeIngredients.recipeId, recipeIds))
  const usedIds = [...new Set(lines.map((l) => l.ingredientId))]
  const ingRows = await db.select().from(ingredients).where(inArray(ingredients.id, usedIds))
  const catalog = new Map<string, IngredientCatalogEntry>()
  for (const r of ingRows) {
    catalog.set(r.id, {
      id: r.id,
      name: r.name,
      calories: r.calories ?? 0,
      protein: r.protein ?? 0,
      carbs: r.carbs ?? 0,
      fat: r.fat ?? 0,
      fiber: r.fiber ?? 0,
      salt: r.salt ?? 0,
      density: r.density,
      unitWeight: r.unitWeight,
      edibleFraction: r.edibleFraction,
    })
  }
  const recipeRows = await db
    .select({ id: recipes.id, servings: recipes.servings })
    .from(recipes)
    .where(inArray(recipes.id, recipeIds))
  let n = 0
  for (const r of recipeRows) {
    const ings = lines.filter((l) => l.recipeId === r.id)
    if (ings.length === 0 || !(r.servings > 0)) continue
    const agg = aggregateNutrition({
      servings: r.servings,
      ingredients: ings.map((l, i) => ({
        id: String(i),
        ingredientId: l.ingredientId,
        quantity: l.quantity,
        unit: l.unit as RecipeIngredient['unit'],
        note: l.note ?? undefined,
        optional: false,
        displayOrder: i,
      })),
      catalog,
    })
    await db
      .update(recipes)
      .set({ nutritionPerServing: agg.perServing, nutritionIncomplete: agg.incomplete })
      .where(eq(recipes.id, r.id))
    n++
  }
  return n
}
