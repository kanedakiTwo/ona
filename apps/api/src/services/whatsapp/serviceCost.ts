import { and, eq, gte, sql } from 'drizzle-orm'
import type { CostUnits } from '../../config/pricing.js'
import { db } from '../../db/connection.js'
import { costEvents } from '../../db/schema.js'
import { madridMonthStartUtc, recordCost } from '../costLedger.js'

/**
 * Cost of Mimo's free-form WhatsApp messages ("service" messages: any
 * non-template message, sent inside Meta's 24 h window). Since 2026-10-01
 * Meta gives each business phone number 1,000 free service messages a month
 * (no roll-over) and bills the rest at the Spain rate (€0.0166) — see
 * `meta_whatsapp/service_message` in config/pricing.ts.
 *
 * Every send writes one ledger row: `{ freeMessages: 1 }` (0 €) inside the
 * free tier, `{ messages: 1 }` (priced) from the 1,001st of the month.
 * Mimoia has one number, so the tier is counted over all rows of the
 * feature. The month runs on the Madrid calendar (Meta uses the messaging
 * account's time zone, set to Spain).
 */
export const SERVICE_FEATURE = 'whatsapp_service'
export const SERVICE_MODEL = 'service_message'
export const SERVICE_FREE_TIER_PER_MONTH = 1000

/** Pure: units for the next service message, given how many went out earlier this month. */
export function serviceMessageUnits(sentBeforeThisMonth: number): CostUnits {
  return sentBeforeThisMonth < SERVICE_FREE_TIER_PER_MONTH ? { freeMessages: 1 } : { messages: 1 }
}

async function countServiceMessagesThisMonth(): Promise<number> {
  // Unit tests run without a migrated DB (same rule as the ledger's sink).
  if (process.env.VITEST) return 0
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(costEvents)
    .where(and(eq(costEvents.feature, SERVICE_FEATURE), gte(costEvents.createdAt, madridMonthStartUtc())))
  return Number(row?.n ?? 0)
}

/**
 * Record one delivered service message. Never throws; if the month's count
 * can't be read, the message is recorded as priced (overestimate rather than
 * hide a cost).
 */
export async function recordServiceMessageCost(
  userId: string | null,
  deps: { countThisMonth: () => Promise<number> } = { countThisMonth: countServiceMessagesThisMonth },
): Promise<void> {
  let before = SERVICE_FREE_TIER_PER_MONTH
  try {
    before = await deps.countThisMonth()
  } catch (err: any) {
    console.warn('[whatsapp] service-message count failed, recording as priced:', err?.message ?? err)
  }
  recordCost({ feature: SERVICE_FEATURE, provider: 'meta_whatsapp', model: SERVICE_MODEL, units: serviceMessageUnits(before), userId })
}
