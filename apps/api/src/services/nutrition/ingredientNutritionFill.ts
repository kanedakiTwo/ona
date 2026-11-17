/**
 * PRO-1125 (2) — fill the nutrition of the ingredients that have none, with
 * no API: an agent on the subscription (Cocina, at night) writes a JSON
 *
 *   { "manitas de cerdo": { "kcal": 232, "proteína": 23.2, "hidratos": 0,
 *       "grasa": 14.8, "fibra": 0, "sal": 0.18, "fuente": "BEDCA 1234" }, … }
 *
 * and `scripts/ingredientNutrition.ts` applies it here: per-100 g values on
 * the row, then the recipes that use it recomputed (`recomputeRecipesUsing`,
 * the same calculation as `persistRecipe`). Sources, in this order: BEDCA,
 * USDA Foundation or SR Legacy (no dishes), an estimate marked as such.
 * A «USDA <fdcId>» source stores the id; BEDCA and estimates leave it null.
 *
 * Spec: ../../../../../specs/nutrition.md ("Filling missing nutrition")
 */
import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { ingredients } from '../../db/schema.js'
import { normalizeForDedupe } from '../ingredientAutoCreate.js'
import { lacksNutrition } from './aggregate.js'
import { recomputeRecipesUsing, type RecomputedRecipe } from './recomputeRecipes.js'

type Db = typeof import('../../db/connection.js').db

export type FillSourceKind = 'BEDCA' | 'USDA' | 'estimación'

export interface FillEntry {
  name: string
  kcal: number
  proteinG: number
  carbsG: number
  fatG: number
  fiberG: number
  saltG: number
  /** As written in the file («BEDCA 1234», «USDA SR Legacy 168280», «estimación»). */
  source: string
  sourceKind: FillSourceKind
  /** From a «USDA … <id>» source. */
  fdcId: number | null
}

const valuesSchema = z.object({
  kcal: z.number().min(0).max(900),
  proteina: z.number().min(0).max(100),
  hidratos: z.number().min(0).max(100),
  grasa: z.number().min(0).max(100),
  fibra: z.number().min(0).max(100),
  sal: z.number().min(0).max(50),
  fuente: z.string().trim().min(1).max(200),
})

/** «proteína» and «proteina» both work; keys are matched without accents. */
function unaccentKeys(v: unknown): unknown {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return v
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>).map(([k, x]) => [k.normalize('NFD').replace(/\p{Diacritic}+/gu, '').toLowerCase(), x]),
  )
}

export function sourceKind(source: string): { kind: FillSourceKind; fdcId: number | null } | null {
  const s = source.normalize('NFD').replace(/\p{Diacritic}+/gu, '').toLowerCase().trim()
  if (s.startsWith('bedca')) return { kind: 'BEDCA', fdcId: null }
  if (s.startsWith('usda')) {
    // FNDDS are dishes: never a source (PRO-1125).
    if (/fndds|survey/.test(s)) return null
    const id = s.match(/\b(\d{4,8})\b/)
    return { kind: 'USDA', fdcId: id ? Number(id[1]) : null }
  }
  if (s.startsWith('estimacion')) return { kind: 'estimación', fdcId: null }
  return null
}

/** Pure: read the agent's JSON. Every bad entry is an error line; good ones are returned. */
export function parseNutritionFile(json: unknown): { entries: FillEntry[]; errors: string[] } {
  const entries: FillEntry[] = []
  const errors: string[] = []
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    return { entries, errors: ['El fichero debe ser un objeto {nombre: {kcal, proteína, hidratos, grasa, fibra, sal, fuente}}.'] }
  }
  for (const [rawName, raw] of Object.entries(json as Record<string, unknown>)) {
    const name = rawName.trim()
    const parsed = valuesSchema.safeParse(unaccentKeys(raw))
    if (!name || !parsed.success) {
      const why = parsed.success ? 'sin nombre' : parsed.error.issues.map((i) => `${i.path.join('.') || 'valor'}: ${i.message}`).join('; ')
      errors.push(`«${rawName}»: ${why}`)
      continue
    }
    const v = parsed.data
    const kind = sourceKind(v.fuente)
    if (!kind) {
      errors.push(`«${name}»: la fuente debe empezar por BEDCA, USDA (Foundation o SR Legacy) o «estimación» («${v.fuente}»)`)
      continue
    }
    if (v.proteina + v.hidratos + v.grasa + v.fibra > 100.5) {
      errors.push(`«${name}»: proteína + hidratos + grasa + fibra pasan de 100 g`)
      continue
    }
    entries.push({
      name,
      kcal: v.kcal,
      proteinG: v.proteina,
      carbsG: v.hidratos,
      fatG: v.grasa,
      fiberG: v.fibra,
      saltG: v.sal,
      source: v.fuente,
      sourceKind: kind.kind,
      fdcId: kind.fdcId,
    })
  }
  return { entries, errors }
}

export interface FillResult {
  filled: Array<{ id: string; name: string; source: string }>
  /** In the file but not in the catalogue. */
  unknown: string[]
  /** Already have nutrition (only with `overwrite`). */
  kept: string[]
  recipes: RecomputedRecipe[]
}

/**
 * Apply the entries to the catalogue rows with the same name (accents and
 * capitals aside) and recompute the recipes that use them. Only rows with no
 * nutrition yet unless `overwrite`. Dry-run (`execute: false`) writes nothing.
 */
export async function applyIngredientNutrition(
  db: Db,
  entries: readonly FillEntry[],
  opts: { execute: boolean; overwrite?: boolean; log?: (line: string) => void },
): Promise<FillResult> {
  const log = opts.log ?? console.log
  const rows = await db.select().from(ingredients)
  const byName = new Map(rows.map((r) => [normalizeForDedupe(r.name), r]))
  const result: FillResult = { filled: [], unknown: [], kept: [], recipes: [] }

  for (const e of entries) {
    const row = byName.get(normalizeForDedupe(e.name))
    if (!row) {
      result.unknown.push(e.name)
      log(`  ✗ ${e.name.padEnd(34)} no está en el catálogo`)
      continue
    }
    if (!lacksNutrition(row) && !opts.overwrite) {
      result.kept.push(row.name)
      log(`  = ${row.name.padEnd(34)} ya tiene nutrición (${Math.round(row.calories ?? 0)} kcal); usa --overwrite para cambiarla`)
      continue
    }
    log(
      `  ${opts.execute ? '✓' : '·'} ${row.name.padEnd(34)} ← ${e.source}: ${Math.round(e.kcal)} kcal, P ${e.proteinG} HC ${e.carbsG} G ${e.fatG} F ${e.fiberG} sal ${e.saltG}${e.sourceKind === 'estimación' ? '  [estimación]' : ''}`,
    )
    result.filled.push({ id: row.id, name: row.name, source: e.source })
    if (!opts.execute) continue
    await db
      .update(ingredients)
      .set({
        // A USDA source with its id stores it; anything else keeps what the row had.
        ...(e.fdcId != null ? { fdcId: e.fdcId } : {}),
        calories: e.kcal,
        protein: e.proteinG,
        carbs: e.carbsG,
        fat: e.fatG,
        fiber: e.fiberG,
        salt: e.saltG,
        updatedAt: new Date(),
      })
      .where(eq(ingredients.id, row.id))
  }

  if (opts.execute && result.filled.length > 0) {
    result.recipes = await recomputeRecipesUsing(db, result.filled.map((f) => f.id))
    for (const r of result.recipes) {
      log(`    receta «${r.name}»: ${r.kcalBefore ?? '—'} → ${r.kcalAfter} kcal${r.incomplete ? ' (sigue incompleta)' : ''}`)
    }
  }
  return result
}
