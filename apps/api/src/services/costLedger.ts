/**
 * Cost ledger: one `cost_events` row per paid provider call, so Finance can
 * read the real cost per household per week (GET /admin/metrics). Prices come
 * from config/pricing.ts.
 *
 * Recording never blocks or fails the user path: `recordCost` is synchronous,
 * fire-and-forget, and swallows (logs) every error.
 *
 * Attribution: deep call sites (unit fallback, ingredient matcher, USDA
 * translator…) don't know who they are working for, so the user rides along
 * in an AsyncLocalStorage context:
 *   - `authMiddleware` runs every authed request inside `runWithCostUser(userId)`;
 *   - the WhatsApp webhook runs each inbound turn in a fresh `whatsapp`
 *     context; `checkAdvisorBudget` (called before any paid work of the turn)
 *     attributes it to the user once the phone has resolved to one;
 *   - schedulers / scripts have no context → recorded as system (userId null),
 *     unless the call site passes `userId` explicitly.
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { computeCostMicros, type CostProvider, type CostUnits } from '../config/pricing.js'
import { madridMidnightUtc, madridParts } from './madridTime.js'

type Db = typeof defaultDb

/** Where the paid work was requested from. */
export type CostChannel = 'web' | 'whatsapp'

interface CostContext {
  userId: string | null
  channel: CostChannel
}

const context = new AsyncLocalStorage<CostContext>()

/** Run `fn` (and everything it awaits) billed to `userId` (null = not known yet). */
export function runWithCostUser<T>(userId: string | null, fn: () => T, channel: CostChannel = 'web'): T {
  return context.run({ userId, channel }, fn)
}

/** Fill in the user for the current context once identity is known. No-op outside a context. */
export function attributeCostToUser(userId: string): void {
  const store = context.getStore()
  if (store) store.userId = userId
}

export function currentCostUserId(): string | null {
  return context.getStore()?.userId ?? null
}

/** Channel of the current context; null outside one (scheduler, scripts). */
export function currentCostChannel(): CostChannel | null {
  return context.getStore()?.channel ?? null
}

export interface CostEvent {
  feature: string
  provider: CostProvider
  model: string
  units: CostUnits
  /** Explicit attribution. `undefined` → the ambient context user; `null` → system job. */
  userId?: string | null
}

export interface CostRow {
  userId: string | null
  feature: string
  provider: CostProvider
  model: string
  units: CostUnits
  costMicros: number | null
}

type CostSink = (row: CostRow) => Promise<void>

/** Default sink: one INSERT; the household is resolved in the same statement. */
const dbSink: CostSink = async (row) => {
  // Unit tests run without a migrated DB; never write to the developer's DB from vitest.
  if (process.env.VITEST) return
  await defaultDb.execute(sql`
    INSERT INTO cost_events (user_id, household_id, feature, provider, model, units, cost_micros)
    VALUES (
      ${row.userId}::uuid,
      (SELECT primary_household_id FROM users WHERE id = ${row.userId}::uuid),
      ${row.feature},
      ${row.provider},
      ${row.model},
      ${JSON.stringify(row.units)}::jsonb,
      ${row.costMicros}
    )
  `)
}

let sink: CostSink = dbSink

/** Test seam: capture rows instead of inserting. `null` restores the DB sink. */
export function setCostSinkForTests(fake: CostSink | null): void {
  sink = fake ?? dbSink
}

/** Record one paid call. Synchronous and never throws; the insert runs in the background. */
export function recordCost(event: CostEvent): void {
  try {
    const row: CostRow = {
      userId: event.userId === undefined ? currentCostUserId() : event.userId,
      feature: event.feature,
      provider: event.provider,
      model: event.model,
      units: event.units,
      costMicros: computeCostMicros(event.provider, event.model, event.units),
    }
    if (row.costMicros === null) {
      console.warn(`[costLedger] no price for ${event.provider}/${event.model} — recorded as unpriced`)
    }
    sink(row).catch((err) => console.warn('[costLedger] record failed (ignored):', err?.message ?? err))
  } catch (err: any) {
    console.warn('[costLedger] record failed (ignored):', err?.message ?? err)
  }
}

/** Anthropic SDK `message.usage` (snake_case; cache fields optional/nullable). */
export interface AnthropicUsageLike {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
}

export function anthropicUnits(usage: AnthropicUsageLike): CostUnits {
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
  }
}

/** Convenience for the single-shot Claude calls (extraction, matcher, fallbacks…). */
export function recordAnthropicCost(
  feature: string,
  model: string,
  usage: AnthropicUsageLike | null | undefined,
  userId?: string | null,
): void {
  if (!usage) return
  recordCost({ feature, provider: 'anthropic', model, units: anthropicUnits(usage), userId })
}

/** UTC instant of 00:00 Europe/Madrid on the 1st of `now`'s Madrid calendar month. */
export function madridMonthStartUtc(now: Date = new Date()): Date {
  return madridMidnightUtc(`${madridParts(now).isoDate.slice(0, 7)}-01`)
}

/**
 * A user's estimated spend so far this calendar month (Europe/Madrid), in EUR,
 * across every paid feature billed to them in the ledger (chat, WhatsApp,
 * voice, transcription, recipe import/extraction, images, templates).
 * Unpriced events count as 0. Indexed by (user_id, created_at).
 */
export async function getUserMonthlySpendEur(userId: string, now: Date = new Date(), db: Db = defaultDb): Promise<number> {
  const res = await db.execute(sql`
    SELECT COALESCE(SUM(cost_micros), 0)::bigint AS micros
      FROM cost_events
     WHERE user_id = ${userId}::uuid AND created_at >= ${madridMonthStartUtc(now)}
  `)
  const micros = Number((res.rows[0] as { micros?: string | number } | undefined)?.micros ?? 0)
  return micros / 1_000_000
}
