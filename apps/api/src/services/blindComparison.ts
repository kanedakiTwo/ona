/**
 * PRO-256 (D-087, tarea 4 del «Menú inteligente») — comparación a ciegas en
 * los hogares de prueba. Para un menú generado con su propuesta a la sombra
 * (PRO-255), el hogar ve dos semanas, A y B (la del generador y la de Mimo,
 * en un orden fijo por menú que no se dice), elige una y cuenta por qué.
 * Cocina juzga las mismas semanas con sus reglas (`scoreWeek`, PRO-254), que
 * ya van guardadas con cada propuesta.
 *
 * Solo para las cuentas de prueba (`@example.com`, las de staging de los
 * hogares de prueba): para cualquier otra cuenta no existe (404). Nada de
 * esto llega a un hogar de verdad.
 */
import { createHash } from 'node:crypto'
import type { DayMenu } from '@ona/shared'

/** Email domain of the test households' staging accounts (ona-hq `hogares-prueba/cuentas.json`). */
export const BLIND_TEST_EMAIL_SUFFIX = '@example.com'

export function isBlindTestAccount(email: string | null | undefined): boolean {
  return typeof email === 'string' && email.trim().toLowerCase().endsWith(BLIND_TEST_EMAIL_SUFFIX)
}

export type BlindLabel = 'A' | 'B'
export type BlindSource = 'planner' | 'generator'

/** Pure: which week is A for this menu (fixed per menu, half and half across menus). */
export function blindSources(menuId: string): Record<BlindLabel, BlindSource> {
  const first = createHash('sha256').update(`a-ciegas:${menuId}`).digest()[0]
  return first % 2 === 0 ? { A: 'planner', B: 'generator' } : { A: 'generator', B: 'planner' }
}

const DAY = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const MEAL_LABEL: Record<string, string> = { breakfast: 'desayuno', lunch: 'comida', snack: 'merienda', dinner: 'cena' }
const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner']

export interface BlindDay {
  day: string
  meals: Array<{ meal: string; dishes: string[] }>
}

/**
 * Pure: a week as the household reads it — day, meal and dish names only.
 * Nothing that gives away where it comes from: no «por qué», no ids, no
 * course or pins; leftovers and tápers say so, as in the app.
 */
export function blindWeek(days: readonly DayMenu[] | null | undefined): BlindDay[] {
  return (days ?? []).map((day, i) => ({
    day: DAY[i] ?? String(i),
    meals: MEAL_ORDER.filter((m) => day?.[m]).concat(Object.keys(day ?? {}).filter((m) => !MEAL_ORDER.includes(m))).flatMap((meal) => {
      const dishes = (day?.[meal]?.dishes ?? []).flatMap((d) => {
        if (d.kind === 'note') return d.text ? [d.text] : []
        const name = d.recipeName?.trim() || 'Receta'
        return [d.variant === 'leftover' ? `${name} (sobras)` : d.variant === 'freezer' ? `${name} (del congelador)` : name]
      })
      return dishes.length ? [{ meal: MEAL_LABEL[meal] ?? meal, dishes }] : []
    }),
  }))
}

/** Pure: the two weeks of a plan, as A and B. */
export function blindPair(menuId: string, plannerDays: DayMenu[], generatorDays: DayMenu[]): { A: BlindDay[]; B: BlindDay[] } {
  const s = blindSources(menuId)
  const week = (src: BlindSource) => blindWeek(src === 'planner' ? plannerDays : generatorDays)
  return { A: week(s.A), B: week(s.B) }
}

/** Pure: the household's answer → what it means. */
export function preferredSource(menuId: string, label: BlindLabel | 'igual'): 'planner' | 'generator' | 'tie' {
  return label === 'igual' ? 'tie' : blindSources(menuId)[label]
}

// ─── Report (pure) ──────────────────────────────────────────────

export interface ComparisonPlanRow {
  householdId: string | null
  status: string
  check: { problems?: Record<string, number> } | null
  plannerScore: { score?: number } | null
  generatorScore: { score?: number } | null
}

export interface ComparisonVoteRow {
  householdId: string | null
  preferred: string
  reason: string | null
}

export interface HouseholdComparison {
  householdId: string
  plans: number
  byStatus: Record<string, number>
  /** Checker problems in the planner's proposals, by kind. */
  problems: Record<string, number>
  /** Mean `scoreWeek` (0–100) of each week: Cocina's rules. */
  plannerRules: number | null
  generatorRules: number | null
  votes: { planner: number; generator: number; tie: number }
  reasons: Array<{ preferred: string; reason: string }>
  /** More votes for the planner's week than for the generator's. */
  prefersPlanner: boolean | null
}

const mean = (xs: number[]) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) : null)

/** Pure: one line per household, for the report in `hogares-prueba/informes/`. */
export function summarizeComparison(plans: readonly ComparisonPlanRow[], votes: readonly ComparisonVoteRow[]): HouseholdComparison[] {
  const out = new Map<string, HouseholdComparison & { _p: number[]; _g: number[] }>()
  const get = (h: string) => {
    let row = out.get(h)
    if (!row) {
      row = { householdId: h, plans: 0, byStatus: {}, problems: {}, plannerRules: null, generatorRules: null, votes: { planner: 0, generator: 0, tie: 0 }, reasons: [], prefersPlanner: null, _p: [], _g: [] }
      out.set(h, row)
    }
    return row
  }
  for (const p of plans) {
    if (!p.householdId) continue
    const r = get(p.householdId)
    r.plans++
    r.byStatus[p.status] = (r.byStatus[p.status] ?? 0) + 1
    for (const [k, n] of Object.entries(p.check?.problems ?? {})) r.problems[k] = (r.problems[k] ?? 0) + n
    if (typeof p.plannerScore?.score === 'number' && p.status !== 'skipped' && p.status !== 'fallback') r._p.push(p.plannerScore.score)
    if (typeof p.generatorScore?.score === 'number') r._g.push(p.generatorScore.score)
  }
  for (const v of votes) {
    if (!v.householdId) continue
    const r = get(v.householdId)
    if (v.preferred === 'planner' || v.preferred === 'generator' || v.preferred === 'tie') r.votes[v.preferred]++
    if (v.reason?.trim()) r.reasons.push({ preferred: v.preferred, reason: v.reason.trim().slice(0, 300) })
  }
  return [...out.values()].map(({ _p, _g, ...r }) => ({
    ...r,
    plannerRules: mean(_p),
    generatorRules: mean(_g),
    prefersPlanner: r.votes.planner + r.votes.generator === 0 ? null : r.votes.planner > r.votes.generator,
  }))
}
