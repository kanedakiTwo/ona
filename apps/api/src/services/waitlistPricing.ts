/**
 * Founder pricing signal on the waitlist (PRO-26): the four optional Van
 * Westendorp answers, the reserved plan + period, «Ninguno me encaja» + why.
 * Nothing is charged. The credential is the entry's opt-out token, which
 * only the browser that created the entry ever gets.
 */
import { and, eq, ne } from 'drizzle-orm'
import {
  FOUNDER_DECLINE_REASONS,
  FOUNDER_PLAN_IDS,
  PRICE_QUESTIONS,
  founderPlanById,
  type PriceQuestionKey,
  type WaitlistPricingAnswers,
  type WaitlistReservation,
} from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { waitlistEntries } from '../db/schema.js'

type Db = typeof defaultDb

export type PricingOutcome = 'ok' | 'not_found'

function activeByToken(token: string) {
  return and(eq(waitlistEntries.unsubscribeToken, token), ne(waitlistEntries.status, 'unsubscribed'))
}

export async function saveWaitlistPricing(a: WaitlistPricingAnswers, db: Db = defaultDb): Promise<PricingOutcome> {
  const rows = await db
    .update(waitlistEntries)
    .set({
      priceTooCheapEur: a.tooCheap,
      priceGoodEur: a.good,
      priceExpensiveEur: a.expensive,
      priceTooExpensiveEur: a.tooExpensive,
      priceAnsweredAt: new Date(),
    })
    .where(activeByToken(a.token))
    .returning({ id: waitlistEntries.id })
  return rows.length > 0 ? 'ok' : 'not_found'
}

export async function saveWaitlistReservation(r: WaitlistReservation, db: Db = defaultDb): Promise<PricingOutcome> {
  const now = new Date()
  const set =
    r.choice === 'ninguno'
      ? { reservedPlan: null, reservedPeriod: null, reservedAt: null, declinedReason: r.reason, declinedAt: now }
      : r.choice === 'anular'
        ? { reservedPlan: null, reservedPeriod: null, reservedAt: null }
        : (() => {
            const plan = founderPlanById(r.choice)!
            return { reservedPlan: plan.plan, reservedPeriod: plan.period, reservedAt: now, declinedReason: null, declinedAt: null }
          })()
  const rows = await db
    .update(waitlistEntries)
    .set(set)
    .where(activeByToken(r.token))
    .returning({ id: waitlistEntries.id })
  return rows.length > 0 ? 'ok' : 'not_found'
}

// ─── Report (GET /admin/waitlist → `pricing`) ─────────────────────

export interface PricingReportRow {
  priceTooCheapEur: number | null
  priceGoodEur: number | null
  priceExpensiveEur: number | null
  priceTooExpensiveEur: number | null
  priceAnsweredAt: Date | null
  reservedPlan: string | null
  reservedPeriod: string | null
  declinedReason: string | null
}

export interface PriceDistribution {
  answers: number
  min: number | null
  p25: number | null
  median: number | null
  p75: number | null
  max: number | null
  /** Answers rounded to the euro: [{ eur, count }], ascending. */
  histogram: Array<{ eur: number; count: number }>
}

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return Math.round((sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)) * 100) / 100
}

export function priceDistribution(values: Array<number | null>): PriceDistribution {
  const sorted = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b)
  const buckets = new Map<number, number>()
  for (const v of sorted) buckets.set(Math.round(v), (buckets.get(Math.round(v)) ?? 0) + 1)
  return {
    answers: sorted.length,
    min: sorted[0] ?? null,
    p25: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    p75: quantile(sorted, 0.75),
    max: sorted.length ? sorted[sorted.length - 1] : null,
    histogram: [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([eur, count]) => ({ eur, count })),
  }
}

const COLUMN: Record<PriceQuestionKey, keyof PricingReportRow> = {
  tooCheap: 'priceTooCheapEur',
  good: 'priceGoodEur',
  expensive: 'priceExpensiveEur',
  tooExpensive: 'priceTooExpensiveEur',
}

/** Aggregates only: no ids, emails or names. Rows = active entries. */
export function buildPricingReport(rows: PricingReportRow[]) {
  const questions = Object.fromEntries(
    PRICE_QUESTIONS.map((q) => [q.key, { text: q.text, ...priceDistribution(rows.map((r) => r[COLUMN[q.key]] as number | null)) }]),
  ) as Record<PriceQuestionKey, PriceDistribution & { text: string }>
  const byPlan = Object.fromEntries(FOUNDER_PLAN_IDS.map((id) => [id, 0])) as Record<(typeof FOUNDER_PLAN_IDS)[number], number>
  for (const r of rows) {
    const id = `${r.reservedPlan}-${r.reservedPeriod}`
    if (id in byPlan) byPlan[id as keyof typeof byPlan] += 1
  }
  const byReason = Object.fromEntries(FOUNDER_DECLINE_REASONS.map((k) => [k, 0])) as Record<(typeof FOUNDER_DECLINE_REASONS)[number], number>
  for (const r of rows) if (r.declinedReason && r.declinedReason in byReason) byReason[r.declinedReason as keyof typeof byReason] += 1
  const reservations = Object.values(byPlan).reduce((a, b) => a + b, 0)
  const declined = Object.values(byReason).reduce((a, b) => a + b, 0)
  return {
    answeredPriceQuestions: rows.filter((r) => r.priceAnsweredAt != null).length,
    questions,
    reservations: { total: reservations, byPlan },
    none: { total: declined, byReason },
    definitions: {
      questions: 'Respuestas en €/mes de las entradas activas (Van Westendorp). Cada pregunta es opcional.',
      reservations: 'Reservas de plaza de fundador vigentes, por plan y periodo. No se cobra nada.',
      none: '«Ninguno me encaja», por motivo.',
    },
  }
}

export type PricingReport = ReturnType<typeof buildPricingReport>
