/**
 * PRO-1047 — ingredients that auto-create saved with another food's USDA
 * entry, fixed at boot.
 *
 * Before PRO-1125 a name the es→en dictionary didn't know went to USDA in
 * Spanish, and USDA put first anything with a shared word: «pechuga de
 * pollo», «zumo de naranja» and 26 more got «Dulce de Leche» (315 kcal,
 * 55 g of carbs), «copos de maíz sin gluten…» and 8 more a row with chicken
 * values, «Panko sin gluten» the vital wheat gluten (75 g of protein). Every
 * recipe with them was off: Mimo's gluten-free agridulce, 450 g of pechuga
 * for 2, gave 20 g of protein and 966 kcal per serving (Dani y Sara,
 * 2026-10-25). `isRelevantUsdaHit` keeps it from happening again.
 *
 * A row is fixed only while it still holds the wrong entry's values (a hand
 * fix is never overwritten): it takes the values of a well-mapped catalogue
 * row («pechuga de pollo» ← «pollo»), or an estimate from the USDA/BEDCA
 * tables; with neither it is left with no nutrition, so its recipes say
 * «nutrición incompleta» instead of a wrong figure and the nightly fill
 * (`scripts/ingredientNutrition.ts`, PRO-1125) gives it values. Then the
 * recipes that use it are recomputed. Idempotent.
 *
 * Spec: ../../../../../specs/nutrition.md ("Wrong USDA entries")
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import { ingredients, recipeIngredients, recipes } from '../../db/schema.js'
import { gramsPerUnitFromNote } from './aggregate.js'
import { recomputeRecipesUsing } from './recomputeRecipes.js'

type Db = typeof import('../../db/connection.js').db

/** kcal, protein, carbs, fat per 100 g. */
type Macros = readonly [number, number, number, number]

/** The wrong USDA entries, with the per-100 g values they wrote. */
export const WRONG_USDA_ENTRIES: ReadonlyArray<{ fdcId: number; food: string; values: Macros }> = [
  { fdcId: 173461, food: 'Dulce de Leche', values: [315, 6.84, 55.35, 7.35] },
  { fdcId: 747432, food: 'Beans, Dry, Flor de Mayo (otros valores)', values: [101, 23.3, 0, 0.86] },
  { fdcId: 170319, food: "McDONALD'S, FILET-O-FISH", values: [282, 11.26, 26.39, 14.64] },
  { fdcId: 167663, food: 'Restaurant, Latino, pupusas del cerdo', values: [232, 11.51, 23.02, 10.43] },
  { fdcId: 168147, food: 'Vital wheat gluten', values: [370, 75.16, 13.79, 1.85] },
  { fdcId: 2705817, food: 'plato preparado', values: [325, 14.8, 25.1, 18.3] },
  { fdcId: 746765, food: 'otra comida', values: [326, 24.5, 2.07, 24.3] },
  { fdcId: 171674, food: 'harina', values: [363, 10.6, 79.55, 0.82] },
  { fdcId: 2257046, food: 'bebida de avena', values: [48.3298, 0.796875, 5.100325, 2.749] },
  { fdcId: 2758993, food: 'sin valores', values: [0, 0, 0, 0] },
]

/** Per-100 g values of an estimate: kcal, protein, carbs, fat, fiber, salt. */
type Estimate = readonly [number, number, number, number, number, number]

/**
 * What each row gets: `from` = the catalogue row whose values it copies;
 * `estimate` = values from the tables (USDA SR Legacy unless said otherwise).
 * A name that isn't here, or whose `from` row is missing, is left with no
 * nutrition. Names without accents, in lower case.
 */
export const REPAIRS: Readonly<Record<string, { from: string } | { estimate: Estimate; source: string }>> = {
  'pechuga de pollo': { from: 'pollo' },
  'solomillo de pavo': { from: 'pechuga de pavo' },
  'corazones de merluza': { from: 'merluza' },
  'copos de maiz sin gluten certificados (sin malta de cebada)': { from: 'cereales' },
  'panko sin gluten': { from: 'panko' },
  'pan rallado sin gluten': { from: 'pan rallado' },
  'copos de avena': { from: 'avena' },
  'aceite de cacahuete': { from: 'aceite de girasol' },
  'aceite de nuez': { from: 'aceite de girasol' },
  'agua de azahar': { from: 'agua' },
  'agua de rosas': { from: 'agua' },
  'caldo de paella': { from: 'caldo de pescado' },
  'pierna de cordero': { from: 'cordero' },
  'hamburguesas de cerdo': { from: 'carne picada de cerdo' },
  'calamar o pota limpio en anillas': { from: 'calamares' },
  'preparado de pescado para paella congelado': { from: 'calamares' },
  'panceta o guanciale': { from: 'panceta' },
  'eneldo o perejil': { from: 'perejil' },
  'col china o repollo': { from: 'col repollo' },
  'contramuslos de pollo deshuesados y sin piel': { from: 'contramuslos de pollo' },
  'chipotle en adobo o en polvo (sin gluten)': { from: 'chili en polvo' },
  'agracejo seco': { from: 'pasas' },
  'petalos de rosa': { from: 'agua' },
  // Its edible fraction is 0 (PRO-282): the values don't count, only that it has some.
  'hueso de pollo': { from: 'pollo' },
  'solomillo de cerdo': { estimate: [120, 20.95, 0, 3.39, 0, 0.13], source: 'Pork, fresh, loin, tenderloin, raw' },
  'corazones de pollo': { estimate: [153, 15.55, 0.71, 9.33, 0, 0.19], source: 'Chicken, heart, raw' },
  'zumo de naranja': { estimate: [45, 0.7, 10.4, 0.2, 0.2, 0], source: 'Orange juice, raw' },
  'caballa en conserva': { estimate: [156, 23.19, 0, 6.3, 0, 0.95], source: 'Fish, mackerel, canned, drained' },
  'trigo en grano': { estimate: [327, 12.61, 71.18, 1.54, 12.2, 0.01], source: 'Wheat, hard red winter' },
  'higos secos': { estimate: [249, 3.3, 63.87, 0.93, 9.8, 0.03], source: 'Figs, dried, uncooked' },
  'coles de bruselas': { estimate: [43, 3.38, 8.95, 0.3, 3.8, 0.06], source: 'Brussels sprouts, raw' },
  'pipas de calabaza': { estimate: [559, 30.23, 10.71, 49.05, 6, 0.02], source: 'Seeds, pumpkin and squash seed kernels, dried' },
  'semillas de hinojo': { estimate: [345, 15.8, 52.29, 14.87, 39.8, 0.22], source: 'Spices, fennel seed' },
  'grasa de oca': { estimate: [900, 0, 0, 99.8, 0, 0], source: 'Goose fat' },
  'grasa de pato': { estimate: [882, 0, 0, 99.8, 0, 0], source: 'Fat, duck' },
  'lengua de ternera': { estimate: [224, 14.9, 3.68, 16.09, 0, 0.17], source: 'Beef, variety meats and by-products, tongue, raw' },
  'piel de naranja confitada': { estimate: [322, 0.34, 82.4, 0.07, 1.6, 0.23], source: 'Candied fruit' },
  'extracto de vainilla': { estimate: [288, 0.06, 12.65, 0.06, 0, 0.02], source: 'Vanilla extract' },
  'mermelada de naranja': { estimate: [246, 0.3, 66.27, 0, 0.7, 0.14], source: 'Marmalade, orange' },
  'pimienta de jamaica': { estimate: [263, 6.09, 72.12, 8.69, 21.6, 0.2], source: 'Spices, allspice, ground' },
  'ralladura de limon': { estimate: [47, 1.5, 16, 0.3, 10.6, 0.02], source: 'Lemon peel, raw' },
  'semillas de mostaza': { estimate: [508, 26.08, 28.09, 36.24, 12.2, 0.03], source: 'Spices, mustard seed, ground' },
  'semola de trigo': { estimate: [360, 12.68, 72.83, 1.05, 3.9, 0], source: 'Semolina, unenriched' },
  'sirope de datil': { estimate: [280, 1.5, 70, 0.1, 1, 0.02], source: 'estimación (sirope de dátil)' },
  'melaza de granada': { estimate: [260, 0.5, 65, 0, 0, 0.03], source: 'estimación (melaza de granada)' },
  'caldo de pollo en polvo': { estimate: [250, 10, 20, 15, 0, 50], source: 'estimación (pastilla de caldo)' },
  'revuelto de ajetes congelado': { estimate: [35, 2.5, 4, 0.5, 2, 0.1], source: 'estimación (ajetes y setas)' },
  'sobras del cocido madrileno': { estimate: [150, 10, 10, 8, 3, 0.8], source: 'estimación (cocido madrileño)' },
}

function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}+/gu, '').toLowerCase().trim().replace(/\s+/g, ' ')
}

const close = (a: number | null, b: number) => Math.abs((a ?? 0) - b) < 0.05

interface Row {
  id: string
  name: string
  fdcId: number | null
  calories: number | null
  protein: number | null
  carbs: number | null
  fat: number | null
  fiber: number | null
  salt: number | null
}

/** Pure: does this row still hold the values of a wrong USDA entry? */
export function holdsWrongUsdaEntry(row: Pick<Row, 'fdcId' | 'calories' | 'protein' | 'carbs' | 'fat'>): boolean {
  const entry = WRONG_USDA_ENTRIES.find((e) => e.fdcId === row.fdcId)
  if (!entry) return false
  const [kcal, protein, carbs, fat] = entry.values
  return close(row.calories, kcal) && close(row.protein, protein) && close(row.carbs, carbs) && close(row.fat, fat)
}

export type Fix = {
  fdcId: number | null
  calories: number
  protein: number
  carbs: number
  fat: number
  fiber: number
  salt: number
}

const NO_NUTRITION: Fix = { fdcId: null, calories: 0, protein: 0, carbs: 0, fat: 0, fiber: 0, salt: 0 }

/**
 * Pure: the values a wrong row gets — the `from` row's (if it exists and is
 * right itself), the estimate, or none.
 */
export function fixFor(name: string, byName: ReadonlyMap<string, Row>): Fix {
  const repair = REPAIRS[normalize(name)]
  if (!repair) return NO_NUTRITION
  if ('estimate' in repair) {
    const [calories, protein, carbs, fat, fiber, salt] = repair.estimate
    return { fdcId: null, calories, protein, carbs, fat, fiber, salt }
  }
  const src = byName.get(repair.from)
  if (!src || holdsWrongUsdaEntry(src)) return NO_NUTRITION
  return {
    fdcId: src.fdcId,
    calories: src.calories ?? 0,
    protein: src.protein ?? 0,
    carbs: src.carbs ?? 0,
    fat: src.fat ?? 0,
    fiber: src.fiber ?? 0,
    salt: src.salt ?? 0,
  }
}

export interface IngredientRepairResult {
  fixed: string[]
  recomputed: number
}

/**
 * Boot step (after `db:migrate`): the rows that still hold a wrong USDA
 * entry get their values, and the recipes that use them are recomputed.
 * Also recomputes the recipes «incompletas» by a line in units whose note
 * gives the weight of a piece (PRO-1047's salmón: 4 u, «lomos de unos 150 g»).
 */
export async function applyIngredientRepairs(
  db: Db,
  log: (line: string) => void = console.log,
): Promise<IngredientRepairResult> {
  const rows: Row[] = await db
    .select({
      id: ingredients.id,
      name: ingredients.name,
      fdcId: ingredients.fdcId,
      calories: ingredients.calories,
      protein: ingredients.protein,
      carbs: ingredients.carbs,
      fat: ingredients.fat,
      fiber: ingredients.fiber,
      salt: ingredients.salt,
    })
    .from(ingredients)
  const byName = new Map(rows.map((r) => [normalize(r.name), r]))

  const fixed: Array<{ id: string; name: string; fix: Fix }> = []
  for (const r of rows) {
    if (!holdsWrongUsdaEntry(r)) continue
    const fix = fixFor(r.name, byName)
    await db.update(ingredients).set({ ...fix, updatedAt: new Date() }).where(eq(ingredients.id, r.id))
    fixed.push({ id: r.id, name: r.name, fix })
  }

  // Recipes still «incompletas» by a unit line whose note now gives its weight.
  const unitLines = await db
    .select({ recipeId: recipeIngredients.recipeId, ingredientId: recipeIngredients.ingredientId, note: recipeIngredients.note })
    .from(recipeIngredients)
    .innerJoin(ingredients, eq(ingredients.id, recipeIngredients.ingredientId))
    .innerJoin(recipes, eq(recipes.id, recipeIngredients.recipeId))
    .where(and(eq(recipeIngredients.unit, 'u'), isNull(ingredients.unitWeight), eq(recipes.nutritionIncomplete, true)))
  const weighed = unitLines.filter((l) => gramsPerUnitFromNote(l.note) != null)

  const ids = [...new Set([...fixed.map((f) => f.id), ...weighed.map((l) => l.ingredientId)])]
  let recomputed = 0
  if (ids.length > 0) {
    const onlyRecipes = new Set([
      ...weighed.map((l) => l.recipeId),
      ...(fixed.length > 0
        ? (
            await db
              .selectDistinct({ recipeId: recipeIngredients.recipeId })
              .from(recipeIngredients)
              .where(inArray(recipeIngredients.ingredientId, fixed.map((f) => f.id)))
          ).map((r) => r.recipeId)
        : []),
    ])
    recomputed = (await recomputeRecipesUsing(db, ids, { onlyRecipeIds: onlyRecipes })).length
  }

  if (fixed.length === 0 && recomputed === 0) {
    log('[ingredient-repairs] nada que cambiar')
  } else {
    const names = fixed.map((f) => `«${f.name}»${f.fix.calories === 0 && f.fix.fdcId == null ? ' (sin valores)' : ` ${Math.round(f.fix.calories)} kcal`}`)
    log(`[ingredient-repairs] ${names.join(', ') || 'ningún ingrediente'}; ${recomputed} receta(s) recalculada(s)`)
  }
  return { fixed: fixed.map((f) => f.name), recomputed }
}
