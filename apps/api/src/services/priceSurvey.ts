/**
 * Beta price survey (specs/billing.md → «Encuesta de precio de la beta»).
 * Moved off the waitlist on 2026-10-15: the four Van Westendorp questions are
 * asked to beta users who have used Mimoia for a week, once, until launch day.
 */
import { eq } from 'drizzle-orm'
import { PRICE_SURVEY_AFTER_DAYS, type PriceSurveyAnswers } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { priceSurveyResponses, users } from '../db/schema.js'
import { isBeta } from './billing.js'
import { priceDistribution, type PriceDistribution } from './waitlistPricing.js'

const DAY_MS = 24 * 60 * 60 * 1000

export interface SurveyRecord {
  answeredAt: Date | null
  dismissedAt: Date | null
}

/** Show it when the account is ≥ 7 days old, we're still in the beta, and it was never answered nor dismissed. */
export function shouldShowPriceSurvey(opts: { userCreatedAt: Date | null; record: SurveyRecord | null; now: Date }): boolean {
  if (!opts.userCreatedAt) return false
  if (!isBeta(opts.now)) return false
  if (opts.record && (opts.record.answeredAt || opts.record.dismissedAt)) return false
  return opts.now.getTime() - opts.userCreatedAt.getTime() >= PRICE_SURVEY_AFTER_DAYS * DAY_MS
}

export interface PriceSurveyRow extends PriceSurveyAnswers, SurveyRecord {}

export interface PriceSurveyRepo {
  userCreatedAt(userId: string): Promise<Date | null>
  get(userId: string): Promise<SurveyRecord | null>
  answer(userId: string, a: PriceSurveyAnswers, at: Date): Promise<void>
  dismiss(userId: string, at: Date): Promise<void>
  /** Every answered survey (no user ids), for the admin report. */
  answered(): Promise<PriceSurveyAnswers[]>
}

export function createDbPriceSurveyRepo(db: typeof defaultDb = defaultDb): PriceSurveyRepo {
  return {
    async userCreatedAt(userId) {
      const [u] = await db.select({ createdAt: users.createdAt }).from(users).where(eq(users.id, userId)).limit(1)
      return u?.createdAt ?? null
    },
    async get(userId) {
      const [r] = await db
        .select({ answeredAt: priceSurveyResponses.answeredAt, dismissedAt: priceSurveyResponses.dismissedAt })
        .from(priceSurveyResponses)
        .where(eq(priceSurveyResponses.userId, userId))
        .limit(1)
      return r ?? null
    },
    async answer(userId, a, at) {
      const values = {
        tooCheapEur: a.tooCheap,
        goodEur: a.good,
        expensiveEur: a.expensive,
        tooExpensiveEur: a.tooExpensive,
        answeredAt: at,
      }
      await db
        .insert(priceSurveyResponses)
        .values({ userId, ...values })
        .onConflictDoUpdate({ target: priceSurveyResponses.userId, set: values })
    },
    async dismiss(userId, at) {
      await db
        .insert(priceSurveyResponses)
        .values({ userId, dismissedAt: at })
        .onConflictDoUpdate({ target: priceSurveyResponses.userId, set: { dismissedAt: at } })
    },
    async answered() {
      const rows = await db
        .select({
          tooCheap: priceSurveyResponses.tooCheapEur,
          good: priceSurveyResponses.goodEur,
          expensive: priceSurveyResponses.expensiveEur,
          tooExpensive: priceSurveyResponses.tooExpensiveEur,
          answeredAt: priceSurveyResponses.answeredAt,
        })
        .from(priceSurveyResponses)
      return rows.filter((r) => r.answeredAt).map(({ answeredAt: _a, ...a }) => a)
    },
  }
}

export interface PriceSurveyReport {
  answers: number
  tooCheap: PriceDistribution
  good: PriceDistribution
  expensive: PriceDistribution
  tooExpensive: PriceDistribution
  note: string
}

export function buildPriceSurveyReport(rows: PriceSurveyAnswers[]): PriceSurveyReport {
  return {
    answers: rows.length,
    tooCheap: priceDistribution(rows.map((r) => r.tooCheap)),
    good: priceDistribution(rows.map((r) => r.good)),
    expensive: priceDistribution(rows.map((r) => r.expensive)),
    tooExpensive: priceDistribution(rows.map((r) => r.tooExpensive)),
    note: 'Encuesta de precio a usuarios de la beta tras una semana de uso (€/mes, todo el hogar). Sin datos personales.',
  }
}
