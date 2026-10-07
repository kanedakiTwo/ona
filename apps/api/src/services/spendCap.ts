import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { getUserMonthlySpendEur } from './costLedger.js'

export interface SpendCapStatus {
  exceeded: boolean
  spentEur: number
  capEur: number
}

/**
 * Has this user used up this month's AI allowance? The sum comes from the
 * cost ledger (every paid provider call writes a cost_events row), so one cap
 * covers chat, WhatsApp, voice, transcription, imports, nutrition estimates
 * and images. `capEur <= 0` disables it. Fails open on a ledger error (the
 * per-feature limits still apply): a DB hiccup must not take the app down.
 */
export async function spendCapStatus(
  userId: string,
  opts: { capEur?: number; now?: Date; db?: any; spent?: (userId: string, now: Date) => Promise<number> } = {},
): Promise<SpendCapStatus> {
  const capEur = opts.capEur ?? env.USER_MONTHLY_SPEND_CAP_EUR
  if (!(capEur > 0)) return { exceeded: false, spentEur: 0, capEur }
  const now = opts.now ?? new Date()
  try {
    const spentEur = opts.spent
      ? await opts.spent(userId, now)
      : await getUserMonthlySpendEur(userId, now, opts.db ?? defaultDb)
    return { exceeded: spentEur >= capEur, spentEur, capEur }
  } catch (err) {
    console.warn('[spendCap] ledger read failed, allowing:', (err as Error)?.message ?? err)
    return { exceeded: false, spentEur: 0, capEur }
  }
}

export function spendCapMessage(capEur: number): string {
  return `Has llegado al límite de uso de la IA de este mes (${capEur.toFixed(0)} €). Se renueva el día 1.`
}
