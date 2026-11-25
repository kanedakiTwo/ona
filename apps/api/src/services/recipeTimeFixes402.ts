/**
 * PRO-402 (2) — the corrected times of Cocina's audit (`atajos-tiempo.md`,
 * 2026-11-05, «Tiempos que parecen mal calculados»), as a reviewable batch
 * that the office applies in production (`scripts/applyTimeFixes402.ts`).
 *
 * Two kinds of fix:
 *  - **Wait counted as cooking** (10): the soak, marinade or night in the
 *    fridge comes out of the time («Lo real» of the audit) and becomes a
 *    «preparativo con antelación» («La víspera: …» on the ficha).
 *  - **Total too short** (19): the total rises to what the steps add up.
 * The other 7 of the audit's first list stay as they are, each with its
 * reason (`TIME_FIXES_402_LEFT`): a same-day wait (it is time the household
 * waits that day) or a fix that needs the step rewritten (its shortcut).
 *
 * How a fix is applied (`planTimeFix`, pure): only while the recipe still
 * has the times the audit read (`before`; anything changed since is left
 * alone and reported); the prep is the audit's when it gives one; the cook
 * time is the smallest that makes the PRO-284 total rule (run at every API
 * boot, `planTimeTrim`) land exactly on the new total, so the next boot
 * doesn't undo it; the hands-on time never goes above the total (and drops
 * with the prep when the prep drops). The preparativos only go in when the
 * recipe has none. A fix the rule can't keep (the total wouldn't stay) is
 * skipped, with the reason. Only system recipes (`author_id IS NULL`).
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { recipeSteps, recipes } from '../db/schema.js'
import type { StepForTime } from './catalogRecipeTimes.js'
import { planTimeTrim, type TimeRow } from './recipeTimeTrim.js'

export interface TimeFix {
  id: string
  name: string
  kind: 'espera' | 'corto'
  /** The times the audit read (only those given are checked). */
  before: { prepTime?: number; cookTime?: number; totalTime: number }
  /** The new total and, when the audit gives it, the new prep. */
  totalTime: number
  prepTime?: number
  advancePrep?: Array<{ text: string; hoursBefore: number }>
  /** The audit's words, for the review. */
  why: string
}

export const TIME_FIXES_402: readonly TimeFix[] = [
  // ─── Waits counted as cooking ───
  { id: '8dc186a7-72b3-4fc8-b796-07cf225ec9b5', name: 'Ensalada fricasé con atún confitado', kind: 'espera', before: { prepTime: 30, cookTime: 1580, totalTime: 1595 }, totalTime: 55, advancePrep: [{ text: 'Confita el atún y, cuando temple, guárdalo en la nevera', hoursBefore: 24 }], why: '2 h de templado y 24 h de nevera en la cocción; el confitado va la víspera y el día son ~55 min' },
  { id: '85489afd-dbbe-489a-9659-d3291618aa8d', name: 'Solomillo a la pimienta', kind: 'espera', before: { prepTime: 20, cookTime: 1460, totalTime: 1470 }, totalTime: 50, advancePrep: [{ text: 'Cubre la carne de pimienta y déjala en la nevera', hoursBefore: 25 }], why: '24 h de nevera con la pimienta; el día, ~50 min' },
  { id: '76ec09d3-6287-4b25-8d09-ff6b6cba7694', name: 'Muslos de pavo a la catalana', kind: 'espera', before: { prepTime: 28, cookTime: 830, totalTime: 844 }, totalTime: 140, advancePrep: [{ text: 'Pon las pasas y las ciruelas a remojo en el vino', hoursBefore: 15 }], why: '12 h de remojo de la fruta en el vino; el día, ~2 h 20' },
  { id: '1c2f22ee-2022-4ac9-9f6f-9c35410ce46f', name: 'Cochinita pibil', kind: 'espera', before: { prepTime: 28, cookTime: 810, totalTime: 824 }, totalTime: 125, advancePrep: [{ text: 'Deja la carne marinando en el adobo, en la nevera', hoursBefore: 15 }], why: '12 h de marinado; el día, ~2 h 05' },
  { id: 'dd01cce0-7f1a-4972-8112-c1f380350957', name: 'Hummus kawarma (con cordero especiado y salsa de limón)', kind: 'espera', before: { prepTime: 40, cookTime: 775, totalTime: 795 }, totalTime: 90, advancePrep: [{ text: 'Pon los garbanzos en remojo', hoursBefore: 14 }], why: '12 h de remojo de los garbanzos; el día, ~1 h 30' },
  { id: '67830088-9c04-4aa9-b8d3-19e1c067c1aa', name: 'Musabaha (garbanzos tibios sobre hummus) con pita tostada', kind: 'espera', before: { prepTime: 35, cookTime: 740, totalTime: 757 }, totalTime: 70, advancePrep: [{ text: 'Pon los garbanzos en remojo', hoursBefore: 14 }], why: '12 h de remojo de los garbanzos; el día, ~1 h 10' },
  { id: '16b1fbe3-ca4b-4692-84a8-f7ba73ca476a', name: 'Noodles salteados con panceta y setas shiitake', kind: 'espera', before: { prepTime: 24, cookTime: 720, totalTime: 740 }, totalTime: 45, advancePrep: [{ text: 'Pon las setas shiitake a remojo', hoursBefore: 13 }], why: '12 h de remojo de las setas; el día, ~40-45 min' },
  { id: 'a83649f6-11b4-4b98-8680-5e67a0c320e7', name: 'Magret de pato con cebolla al oporto', kind: 'espera', before: { prepTime: 28, cookTime: 715, totalTime: 733 }, totalTime: 100, advancePrep: [{ text: 'Deja el magret marinando en la nevera', hoursBefore: 14 }], why: '12 h de marinado; el día, ~1 h 40' },
  { id: 'b8dfc394-d9e1-4ab6-8323-e0b7be958357', name: 'Migas', kind: 'espera', before: { prepTime: 36, cookTime: 605, totalTime: 641 }, totalTime: 45, advancePrep: [{ text: 'Humedece el pan y déjalo reposar tapado', hoursBefore: 11 }], why: '10 h de reposo del pan; ~15 min la víspera y ~45 el día' },
  { id: '30377b43-9b88-4517-9ad1-311c044314c2', name: 'Brochetas de rape con hawayej y perejil', kind: 'espera', before: { prepTime: 25, cookTime: 365, totalTime: 377 }, totalTime: 35, advancePrep: [{ text: 'Deja el rape marinando en la nevera', hoursBefore: 7 }], why: '6 h de marinado en la cocción; sin él, ~35 min (la receta dice que basta 1 h)' },
  // ─── Totals too short for their steps ───
  { id: '362f23e1-b2ab-4cde-8c90-cd306c1d9c86', name: 'Croquetas de cocido', kind: 'corto', before: { prepTime: 148, cookTime: 50, totalTime: 173 }, prepTime: 80, totalTime: 205, why: 'la preparación incluía la nevera: las manos son ~1 h 20 y, con 2 h de nevera, el total ~3 h 25' },
  { id: 'c784ae75-2ddf-4d56-aa26-7172df1e03ea', name: 'Ossobuco a la milanesa', kind: 'corto', before: { totalTime: 140 }, totalTime: 165, why: 'la cocción solo contaba las 2 h de horno; la salsa y el sofrito suman ~50 min más' },
  { id: '9690564e-1173-48bc-ae46-6dd4caf9c782', name: 'Kubbeh hamusta (sopa ácida de acelgas con kubbeh de carne)', kind: 'corto', before: { totalTime: 97 }, totalTime: 120, why: 'formar los kubbeh (25-30 min) no tenía minutos y la cocción con reposo son 50' },
  { id: '04a56c71-1ba6-49b8-bb6e-0145cca538e3', name: 'Arroz de pato', kind: 'corto', before: { totalTime: 88 }, totalTime: 110, why: 'el sofrito ya son 65 min y el arroz, 35' },
  { id: '40413d77-48e4-46a8-972e-558d76953848', name: 'Arroz caldoso de cangrejos', kind: 'corto', before: { totalTime: 83 }, totalTime: 105, why: 'sofrito de 75 min y arroz de 25' },
  { id: 'dddca166-bf11-4bf5-b4d1-8f9d82d3f0d1', name: 'Arroz negro con sepia', kind: 'corto', before: { totalTime: 80 }, totalTime: 100, why: 'sofrito de 65 min y arroz de 30' },
  { id: '84ee950e-f2d9-4a59-8d2c-7a6567c817ae', name: 'Judías con chirlas', kind: 'corto', before: { totalTime: 79 }, totalTime: 95, why: 'sofrito de 70 min y 18 de cocción (el purgado va en paralelo)' },
  { id: 'a250ccb5-bf66-41d5-903d-880511a86813', name: 'Pollo sofrito con patatas y ajos fritos', kind: 'corto', before: { totalTime: 82 }, totalTime: 105, why: 'el paso 3 dice «hora y media en total» al fuego' },
  { id: 'dd4e8490-3578-4adb-bdb2-410039986429', name: 'Sanfaina con bacalao', kind: 'corto', before: { totalTime: 76 }, totalTime: 100, why: 'freír, sofreír y 1 h de cocción lenta, más 20 min de cortar' },
  { id: '1a781d4d-41e9-437a-b407-9b6495b6eeab', name: 'Conejo al cava', kind: 'corto', before: { totalTime: 75 }, totalTime: 90, why: 'dorar 10, sofreír 5, 1 h de cava y 10 de salsa' },
  { id: '88a56afe-8afe-4ead-af4e-d601e9162a8a', name: 'Codillo al estilo alemán', kind: 'corto', before: { totalTime: 73 }, totalTime: 95, why: 'no contaba subir y bajar la presión (~20 min) ni la preparación' },
  { id: 'ebf9533f-a1d4-41ae-9993-46d4ed3a13ee', name: 'Maqluba (arroz con pollo y verduras al revés)', kind: 'corto', before: { totalTime: 72 }, totalTime: 100, why: 'sal a la berenjena 30, caldo 20, freír 15, montaje y 40 de cocción con reposo' },
  { id: '335549f9-c720-41f5-a028-d461c5a3b478', name: "Pollo a l'ast con patatas paja", kind: 'corto', before: { totalTime: 65 }, totalTime: 80, why: 'solo el horno son 60 min, más la salsa' },
  { id: '6764a63a-84d1-4b92-8d13-8415a417796f', name: 'Conejo en salsa de almendras', kind: 'corto', before: { totalTime: 62 }, totalTime: 75, why: 'dorar 12, cebolla 8 y 40 de guiso' },
  { id: '15e1f1c7-e084-4a44-8d1b-25ef8fce4d3b', name: 'Lentejas guisadas', kind: 'corto', before: { totalTime: 57 }, totalTime: 85, why: 'el paso 8 cuece 30 + 30 min' },
  { id: '8a9215cd-25f3-43ae-91b2-867624611cf4', name: 'Pollo con arroz al cardamomo y cebolla caramelizada', kind: 'corto', before: { totalTime: 57 }, totalTime: 70, why: 'cebolla 15, dorar 10, arroz 30 y reposo 10 en la misma cazuela' },
  { id: '0bcb64d0-f244-47e9-aca5-27cd62b7dc0f', name: 'Costillas a la riojana', kind: 'corto', before: { totalTime: 51 }, totalTime: 70, why: 'dorar, sofrito, 30 min de costillas y ~20 de patata' },
  { id: 'f3604bd5-fbae-467d-be0d-3f8a1ea7e9ed', name: 'Risotto de cebada con feta marinado', kind: 'corto', before: { totalTime: 50 }, totalTime: 65, why: 'el paso 6 son 45 min de fuego, más el sofrito y cortar' },
  { id: '0fe27711-34c6-4f73-898c-dc25470f6174', name: 'Riñones al jerez', kind: 'corto', before: { totalTime: 46 }, totalTime: 60, why: '30 min de remojo (que no se puede saltar) más ~30 de fuego' },
]

/** The audit's waits this batch leaves as they are, and why. */
export const TIME_FIXES_402_LEFT: ReadonlyArray<{ id: string; name: string; why: string }> = [
  { id: '813b3e30-c5ca-4915-aa79-5f6fadeff50b', name: 'Pollo asado con tupinambos, limón y azafrán', why: 'el total es correcto si se marina ese día (2 h); marinarlo la víspera es su atajo' },
  { id: 'c00a990c-af77-4863-8d39-3bd7d69ee08b', name: 'Codornices guisadas con orejones, pasas y tamarindo', why: 'las 2 h de marinado son del mismo día; bajar a ~55 min pide reescribir el paso (su atajo, «saltar la espera»)' },
  { id: 'b4277ea1-62ae-4ee4-baf1-42688a9f91c7', name: 'Judías con almejas', why: 'las 2 h de purgado son del mismo día; dejarlas en 30 min pide reescribir el paso (su atajo)' },
  { id: '1046d455-4809-4cfc-90d3-cb90ab48fc73', name: 'Codornices con cuscús a la marroquí', why: 'la hora en frío es del mismo día; saltársela pide reescribir el paso (su atajo)' },
  { id: '1a7a5305-bd8e-4b96-8bdc-a848ec2eb104', name: 'Rösti de patatas', why: 'el total es correcto ese día; cocer las patatas la víspera es su atajo' },
  { id: '21affe34-d5df-4d8d-b35b-bcd286a1f3b9', name: 'Pizza margarita casera', why: 'el total es correcto; el levado (1 h 30, del mismo día) está en la preparación y pasarlo a la cocción no lo deja más claro' },
  { id: '4653295c-a307-446d-8d09-0d1a10088923', name: 'Polpettone (rollo de carne con tortilla y salsa verde)', why: 'pide reescribirla como receta de víspera (su atajo): no es solo el número' },
]

const has = (n: number | null | undefined): n is number => typeof n === 'number' && n > 0

export interface TimeFixRow extends TimeRow {
  advancePrep: Array<{ text: string; hoursBefore: number }> | null
}

export type TimeFixPlan =
  | { ok: true; after: TimeRow; advancePrep: Array<{ text: string; hoursBefore: number }> | null }
  | { ok: false; reason: string }

/** Pure: the new times of one recipe, or why it is left alone. */
export function planTimeFix(row: TimeFixRow, steps: readonly StepForTime[], fix: TimeFix): TimeFixPlan {
  const b = fix.before
  const differs = (k: 'prepTime' | 'cookTime' | 'totalTime') => b[k] !== undefined && row[k] !== b[k]
  if (differs('prepTime') || differs('cookTime') || differs('totalTime')) {
    return { ok: false, reason: `sus tiempos ya no son los del informe (hoy ${row.prepTime ?? '—'} / ${row.cookTime ?? '—'} / ${row.totalTime ?? '—'})` }
  }
  const prep = fix.prepTime ?? (has(row.prepTime) ? row.prepTime : 0)
  const total = fix.totalTime
  let active = has(row.activeTime) ? row.activeTime : null
  if (active != null && has(row.prepTime) && prep < row.prepTime) active = Math.max(prep, active - (row.prepTime - prep))
  if (active != null) active = Math.min(active, total)

  // The smallest cook time the boot rule keeps at this total.
  for (let cook = Math.max(0, total - prep); cook <= total; cook++) {
    const after: TimeRow = { prepTime: prep || null, cookTime: cook || null, activeTime: active, totalTime: total }
    const trimmed = planTimeTrim(after, steps, { trimPrep: false })
    if (trimmed.totalTime === total && trimmed.prepTime === after.prepTime && trimmed.activeTime === after.activeTime) {
      return { ok: true, after, advancePrep: fix.advancePrep && !(row.advancePrep ?? []).length ? fix.advancePrep : null }
    }
  }
  return { ok: false, reason: `la regla del total (PRO-284) no deja ${total} min con estos pasos` }
}

const fmt = (r: TimeRow) => `${r.prepTime ?? '—'} / ${r.cookTime ?? '—'} / ${r.totalTime ?? '—'} (trabajo ${r.activeTime ?? '—'})`

/** ««Migas»: 36 / 605 / 641 (trabajo 30) → 36 / 9 / 45 (trabajo 30) · la víspera: …» */
export function timeFixLine(name: string, before: TimeRow, plan: TimeFixPlan): string {
  if (!plan.ok) return `[pro-402] «${name}»: se queda como está — ${plan.reason}`
  const prep = plan.advancePrep?.length ? ` · preparativo: ${plan.advancePrep.map((p) => `«${p.text}» (${p.hoursBefore} h antes)`).join(', ')}` : ''
  return `[pro-402] «${name}»: preparación / cocción / total ${fmt(before)} → ${fmt(plan.after)}${prep}`
}

type Db = typeof import('../db/connection.js').db

export interface TimeFixResult {
  fixed: number
  skipped: number
  missing: number
}

/**
 * Reads every recipe of the batch, logs the before and after of each and,
 * with `apply`, writes them one by one (only while the times are still the
 * ones read). Without `apply` nothing is written.
 */
export async function applyTimeFixes402(db: Db, opts: { apply: boolean; log?: (line: string) => void; fixes?: readonly TimeFix[] }): Promise<TimeFixResult> {
  const log = opts.log ?? console.log
  const fixes = opts.fixes ?? TIME_FIXES_402
  const ids = fixes.map((f) => f.id)
  const rows = await db
    .select({ id: recipes.id, prepTime: recipes.prepTime, cookTime: recipes.cookTime, activeTime: recipes.activeTime, totalTime: recipes.totalTime, advancePrep: recipes.advancePrep })
    .from(recipes)
    .where(and(isNull(recipes.authorId), inArray(recipes.id, ids)))
  const byId = new Map(rows.map((r) => [r.id, r]))
  const stepRows = rows.length
    ? await db
        .select({ recipeId: recipeSteps.recipeId, index: recipeSteps.index, text: recipeSteps.text, durationMin: recipeSteps.durationMin, technique: recipeSteps.technique })
        .from(recipeSteps)
        .where(inArray(recipeSteps.recipeId, rows.map((r) => r.id)))
    : []
  const result: TimeFixResult = { fixed: 0, skipped: 0, missing: 0 }

  for (const fix of fixes) {
    const row = byId.get(fix.id)
    if (!row) {
      result.missing++
      log(`[pro-402] «${fix.name}»: no está en el catálogo (${fix.id})`)
      continue
    }
    const steps = stepRows.filter((s) => s.recipeId === fix.id).sort((a, b) => a.index - b.index)
    const plan = planTimeFix(row, steps, fix)
    log(timeFixLine(fix.name, row, plan))
    if (!plan.ok) {
      result.skipped++
      continue
    }
    if (!opts.apply) {
      result.fixed++
      continue
    }
    const updated = await db
      .update(recipes)
      .set({ ...plan.after, ...(plan.advancePrep ? { advancePrep: plan.advancePrep } : {}) } as any)
      .where(
        and(
          eq(recipes.id, fix.id),
          isNull(recipes.authorId),
          sql`${recipes.prepTime} IS NOT DISTINCT FROM ${row.prepTime}`,
          sql`${recipes.cookTime} IS NOT DISTINCT FROM ${row.cookTime}`,
          sql`${recipes.totalTime} IS NOT DISTINCT FROM ${row.totalTime}`,
          sql`${recipes.activeTime} IS NOT DISTINCT FROM ${row.activeTime}`,
        ),
      )
      .returning({ id: recipes.id })
    if (updated.length) result.fixed++
    else {
      result.skipped++
      log(`[pro-402] «${fix.name}»: ha cambiado mientras tanto; no se toca`)
    }
  }
  for (const left of TIME_FIXES_402_LEFT) log(`[pro-402] «${left.name}»: no entra en el lote — ${left.why}`)
  log(`[pro-402] ${opts.apply ? 'aplicadas' : 'se aplicarían'} ${result.fixed}; se quedan como están ${result.skipped}; no están ${result.missing}`)
  return result
}
