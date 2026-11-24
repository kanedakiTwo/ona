import { env } from '../config/env.js'

/**
 * Per-person monthly caps (Miguel, 2026-11-23): `USER_CAP_OVERRIDES_EUR` holds
 * `<userId>:<euros>` pairs separated by commas. For those users the number
 * replaces both caps, Mimo's (`ADVISOR_MONTHLY_BUDGET_EUR`) and all paid AI
 * (`USER_MONTHLY_SPEND_CAP_EUR`). Pure parse; malformed pairs are skipped.
 */
export function parseCapOverrides(raw: string): Map<string, number> {
  const out = new Map<string, number>()
  for (const part of raw.split(',')) {
    const [id, eur] = part.split(':').map((s) => s.trim())
    const n = Number(eur)
    if (id && /^[0-9a-f-]{36}$/i.test(id) && Number.isFinite(n) && n > 0) out.set(id.toLowerCase(), n)
  }
  return out
}

/** This user's own cap in euros, or undefined when the general caps apply. */
export function capOverrideEur(userId: string | null | undefined, raw: string = env.USER_CAP_OVERRIDES_EUR): number | undefined {
  if (!userId || !raw) return undefined
  return parseCapOverrides(raw).get(userId.toLowerCase())
}
