/**
 * The intermediate validation (specs/shop-orders.md → Validation): the
 * shop quotes, ONA sorts each line into ok / revisar / no_hay and the user
 * only decides what's out of range.
 *
 * - ±10 % per line, but only against a precise estimate (the user's own
 *   price or this shop's last €/kg) — national averages are too rough.
 * - Wild fish always goes to the user (daily lonja price).
 * - Substitutes, a different quantity and lines the shop didn't mention: user.
 * - "No hay": dropped, never substituted by default.
 * - Basket over the cap ("hasta X €"): user.
 */

import type { LineQuote, QuoteSummary, ShopOrderLine } from '@ona/shared'

export const LINE_BAND = 0.1

export interface AssessInput {
  totalEur: number | null
  capEur: number | null
  pickupText?: string | null
  paymentText?: string | null
  notes?: string | null
}

export interface Assessment {
  lines: ShopOrderLine[]
  summary: QuoteSummary
}

const round2 = (n: number) => Math.round(n * 100) / 100

function assessLine(line: ShopOrderLine): Pick<ShopOrderLine, 'verdict' | 'reasons' | 'decision'> {
  const q: LineQuote | null = line.quote
  if (!q) return { verdict: 'revisar', reasons: ['La tienda no ha dicho nada de esta línea.'], decision: null }
  if (q.status === 'no_hay') return { verdict: 'no_hay', reasons: ['No hay.'], decision: 'remove' }
  if (q.status === 'sustituto') {
    return { verdict: 'revisar', reasons: [`Propone ${q.substitute ?? 'otra cosa'} en su lugar.`], decision: null }
  }
  if (q.status === 'parcial') {
    return { verdict: 'revisar', reasons: [`Cantidad distinta de la pedida${q.quantityText ? `: ${q.quantityText}` : ''}.`], decision: null }
  }
  const reasons: string[] = []
  if (line.volatile) reasons.push('Pescado de lonja: el precio cambia cada día.')
  const precise = line.estimateSource === 'manual' || line.estimateSource === 'historial'
  if (precise && line.estimateEur && q.lineTotal != null) {
    const dev = q.lineTotal / line.estimateEur - 1
    if (dev > LINE_BAND) reasons.push(`${Math.round(dev * 100)} % más de lo previsto (≈${line.estimateEur} €).`)
  }
  return reasons.length ? { verdict: 'revisar', reasons, decision: null } : { verdict: 'ok', reasons: [], decision: 'keep' }
}

export function assessQuote(lines: ShopOrderLine[], input: AssessInput): Assessment {
  const assessed = lines.map((l) => ({ ...l, ...assessLine(l) }))
  const lineSum = assessed
    .filter((l) => l.verdict !== 'no_hay' && l.quote?.lineTotal != null)
    .reduce((acc, l) => acc + (l.quote!.lineTotal as number), 0)
  const totalEur = input.totalEur ?? (lineSum > 0 ? round2(lineSum) : null)
  const overCap = input.capEur != null && totalEur != null && totalEur > input.capEur
  return {
    lines: assessed,
    summary: {
      totalEur,
      pickupText: input.pickupText ?? null,
      paymentText: input.paymentText ?? null,
      notes: input.notes ?? null,
      overCap,
      needsDecision: overCap || assessed.some((l) => l.verdict === 'revisar'),
    },
  }
}
