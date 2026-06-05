/**
 * Per-user monthly spend cap for the text advisor.
 *
 * The advisor chat (`POST /assistant/:userId/chat`) calls Claude Haiku 4.5 —
 * up to two requests per turn (one for the tool decision, one after the tool
 * runs). Left unbounded, a chatty user is unbounded cost. This module meters
 * each turn's real token `usage` into a per-user, per-month running total
 * (micro-euros) and lets the route reject further turns once the configured
 * euro budget is spent. The month rolls over implicitly (same stateless
 * pattern as the image-generation quota) — no cron.
 *
 * Pricing is kept in USD (Anthropic's list price, the source of truth) and
 * converted to euros with a single `ADVISOR_EUR_PER_USD` knob, so re-pegging
 * the exchange rate or the budget is an env change, not a code change.
 */
import { eq, sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { users } from '../db/schema.js'
import { env } from '../config/env.js'

type Db = typeof defaultDb

/**
 * Claude Haiku 4.5 list price, USD per million tokens. Source: Anthropic
 * pricing — $1.00 input / $5.00 output; prompt-cache writes bill at 1.25× the
 * input rate (5-minute ephemeral, which `engine.ts` uses) and cache reads at
 * 0.1×. Keep in sync with the model in `services/assistant/engine.ts`.
 */
export const HAIKU_USD_PER_MTOK = {
  input: 1.0,
  output: 5.0,
  cacheWrite: 1.25,
  cacheRead: 0.1,
} as const

/** Normalised token counts pulled from one or more Anthropic responses. */
export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
}

export const EMPTY_USAGE: TokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheWriteTokens: 0,
  cacheReadTokens: 0,
}

/**
 * Fold an Anthropic `message.usage` block into a running `TokenUsage`. The SDK
 * field names are snake_case and cache fields may be absent — coalesce to 0.
 */
export function addAnthropicUsage(
  acc: TokenUsage,
  usage: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number | null
    cache_read_input_tokens?: number | null
  } | null
  | undefined,
): TokenUsage {
  if (!usage) return acc
  return {
    inputTokens: acc.inputTokens + (usage.input_tokens ?? 0),
    outputTokens: acc.outputTokens + (usage.output_tokens ?? 0),
    cacheWriteTokens: acc.cacheWriteTokens + (usage.cache_creation_input_tokens ?? 0),
    cacheReadTokens: acc.cacheReadTokens + (usage.cache_read_input_tokens ?? 0),
  }
}

/** Pure: cost of a usage block in USD (Haiku 4.5 list price). */
export function usageCostUsd(usage: TokenUsage): number {
  return (
    (usage.inputTokens * HAIKU_USD_PER_MTOK.input +
      usage.outputTokens * HAIKU_USD_PER_MTOK.output +
      usage.cacheWriteTokens * HAIKU_USD_PER_MTOK.cacheWrite +
      usage.cacheReadTokens * HAIKU_USD_PER_MTOK.cacheRead) /
    1_000_000
  )
}

/** Pure: cost of a usage block in micro-euros (integer), given the FX rate. */
export function usageCostMicros(usage: TokenUsage, eurPerUsd: number): number {
  return Math.round(usageCostUsd(usage) * eurPerUsd * 1_000_000)
}

/** Current month bucket in `YYYY-MM` (UTC — matches the image-quota key). */
export function currentMonthKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7)
}

/** The configured monthly budget expressed in micro-euros. */
export function budgetMicros(): number {
  return Math.round(env.ADVISOR_MONTHLY_BUDGET_EUR * 1_000_000)
}

/**
 * This user's advisor spend so far this month, in micro-euros. Returns 0 when
 * the stored month key doesn't match the current month (the total has logically
 * reset even though the DB column hasn't been rewritten yet).
 */
export async function getMonthlySpendMicros(
  userId: string,
  db: Db = defaultDb,
  monthKey: string = currentMonthKey(),
): Promise<number> {
  const [row] = await db
    .select({
      key: users.advisorSpendMonthKey,
      micros: users.advisorSpendMicros,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!row || row.key !== monthKey) return 0
  return row.micros ?? 0
}

/**
 * Budget gate for the chat route. `exceeded` is true once the user has already
 * spent at least the monthly budget — the route should 429 before calling the
 * model. (A user just under the line may still run one more turn; the small
 * single-turn overage is acceptable for a soft cap.)
 */
export async function checkAdvisorBudget(
  userId: string,
  db: Db = defaultDb,
): Promise<{ exceeded: boolean; spentMicros: number; budgetMicros: number }> {
  const limit = budgetMicros()
  const spentMicros = await getMonthlySpendMicros(userId, db)
  return { exceeded: spentMicros >= limit, spentMicros, budgetMicros: limit }
}

/**
 * Add one turn's cost to the user's monthly total. Atomic increment-or-reset:
 * if the stored month key is the current month we add to it, otherwise we
 * start a fresh month at this turn's cost. No-op when the turn cost rounds to
 * zero (e.g. a fully cache-read turn on a tiny prompt).
 */
export async function recordAdvisorUsage(
  userId: string,
  usage: TokenUsage,
  db: Db = defaultDb,
): Promise<void> {
  const micros = usageCostMicros(usage, env.ADVISOR_EUR_PER_USD)
  if (micros <= 0) return
  const monthKey = currentMonthKey()
  await db.execute(sql`
    UPDATE users SET
      advisor_spend_micros = CASE
        WHEN advisor_spend_month_key = ${monthKey} THEN advisor_spend_micros + ${micros}
        ELSE ${micros}
      END,
      advisor_spend_month_key = ${monthKey}
    WHERE id = ${userId}::uuid
  `)
}
