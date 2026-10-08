/**
 * Rough € estimate per order line (specs/shop-orders.md → Validation).
 *
 * Precedence: the price the user typed on the list (`manual`), then the €/kg
 * this shop quoted last time (`historial`), then a national average for the
 * shop kind (`referencia`, MAPA "Informe del Consumo Alimentario 2025",
 * traditional-shop €/kg). Only the first two are precise enough to flag a
 * quote as out of band; the reference only sizes the basket cap.
 */

import type { BuyableUnit, EstimateSource, ShopKind } from '@ona/shared'
import { wholeWeightGrams } from './fish.js'

/** €/kg (or €/l) by shop kind — MAPA 2025, tienda tradicional. */
const REFERENCE_EUR_PER_KG: Partial<Record<ShopKind, number>> = {
  fruteria: 2.3,
  carniceria: 10,
  pescaderia: 11.6,
}

/** € per piece for produce sold by unit (calabacín, lechuga…) — rough. */
const REFERENCE_EUR_PER_UNIT: Partial<Record<ShopKind, number>> = {
  fruteria: 0.6,
}

export interface PriceMemoryEntry {
  pricePerKg: number
  at: string
}
export type PriceMemory = Record<string, PriceMemoryEntry>

export interface EstimateInput {
  ingredientId: string | null
  name: string
  quantity: number
  unit: BuyableUnit
  pricePerUnit: number | null | undefined
  /** Grams actually bought after the buy rules (whole pieces, packs) — beats the recipe quantity. */
  grams?: number | null
  /** Buy rule, for a closer reference €/kg than the shop-kind average. */
  ruleKey?: string | null
}

/** €/kg references closer than the kind average for products far from it (MAPA / shop listings, est.). */
const REFERENCE_BY_RULE: Record<string, number> = {
  jamon: 25,
  'jamon cocido': 14,
  'panceta curada': 14,
  gambas: 18,
  merluza: 14,
  salmon: 18,
  'pescado entero': 13,
  mejillones: 5,
  'carne picada': 9,
}

export interface Estimate {
  eur: number | null
  source: EstimateSource | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Weight the shop will actually weigh (whole fish for a pescadería), in kg. */
function chargedKg(input: EstimateInput, kind: ShopKind): number | null {
  if (input.grams != null && input.grams > 0) return input.grams / 1000
  if (input.unit !== 'g' && input.unit !== 'ml') return null
  const grams = kind === 'pescaderia' ? wholeWeightGrams(input.name, input.quantity) ?? input.quantity : input.quantity
  return grams / 1000
}

export function estimateLine(input: EstimateInput, kind: ShopKind, memory: PriceMemory): Estimate {
  if (input.pricePerUnit != null && input.pricePerUnit > 0) {
    return { eur: round2(input.quantity * input.pricePerUnit), source: 'manual' }
  }
  const kg = chargedKg(input, kind)
  const remembered = input.ingredientId ? memory[input.ingredientId] : undefined
  if (remembered && kg != null) return { eur: round2(kg * remembered.pricePerKg), source: 'historial' }
  const ref = (input.ruleKey ? REFERENCE_BY_RULE[input.ruleKey] : undefined) ?? REFERENCE_EUR_PER_KG[kind]
  if (ref != null && kg != null) return { eur: round2(kg * ref), source: 'referencia' }
  const perUnit = REFERENCE_EUR_PER_UNIT[kind]
  if (perUnit != null && input.unit === 'u') return { eur: round2(input.quantity * perUnit), source: 'referencia' }
  return { eur: null, source: null }
}

/** "Hasta X €": estimate +10 % (+20 % with wild fish), rounded up to the euro. */
export function defaultCap(estimateEur: number | null, hasVolatile: boolean): number | null {
  if (!estimateEur || estimateEur <= 0) return null
  return Math.ceil(round2(estimateEur * (hasVolatile ? 1.2 : 1.1)))
}
