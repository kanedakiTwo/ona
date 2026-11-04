/**
 * Red de tiendas: which Red shop each fresh kind goes to (ona-hq D-165,
 * design §5 with question 0 → a; constitución §7 «Las tiendas del hogar,
 * primero»). Pure. Never by what a shop leaves.
 */
import type { RedKind, RedShopRef } from '@ona/shared'

export interface RedShopLite {
  id: string
  name: string
  kind: string
  postalCode: string
  deliveryPostalCodes: string[]
  status: string
  joinedAt: Date
}

const ref = (s: RedShopLite): RedShopRef => ({ id: s.id, name: s.name })

/** Active Red shops of that kind for a postal code, best first: in it, delivers there, longest in the Red. */
export function redCandidates(kind: RedKind, postalCode: string, shops: RedShopLite[]): RedShopLite[] {
  const score = (s: RedShopLite) => (s.postalCode === postalCode ? 0 : 2) + (s.deliveryPostalCodes.includes(postalCode) ? 0 : 1)
  return shops
    .filter((s) => s.kind === kind && s.status === 'activa' && (s.postalCode === postalCode || s.deliveryPostalCodes.includes(postalCode)))
    .sort((a, b) => score(a) - score(b) || a.joinedAt.getTime() - b.joinedAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
}

export interface PlanInput {
  /** Fresh kinds whose lines have no shop of their kind (they fell back to the súper or to nothing). */
  neededKinds: RedKind[]
  hasSuper: boolean
  superName: string | null
  postalCode: string | null
  /** What the household already answered: keep it at the súper. */
  choices: Partial<Record<RedKind, 'super'>>
  redShops: RedShopLite[]
  halal: boolean
  hasAllergies: boolean
}

export interface RedPlan {
  needsPostalCode: boolean
  assign: Array<{ kind: RedKind; redShop: RedShopLite; alternatives: RedShopRef[] }>
  ask: Array<{ kind: RedKind; redShop: RedShopLite }>
  heldBack: Array<{ kind: RedKind; reason: 'halal' | 'alergias'; candidates: RedShopRef[] }>
  uncovered: RedKind[]
}

export function planRedAssignments(input: PlanInput): RedPlan {
  const plan: RedPlan = { needsPostalCode: false, assign: [], ask: [], heldBack: [], uncovered: [] }
  const kinds = input.neededKinds.filter((k) => input.choices[k] !== 'super')
  if (!kinds.length) return plan
  if (!input.postalCode) {
    plan.needsPostalCode = true
    return plan
  }
  for (const kind of kinds) {
    const candidates = redCandidates(kind, input.postalCode, input.redShops)
    if (!candidates.length) {
      plan.uncovered.push(kind)
      continue
    }
    // Fase 1: halal and allergies don't reach the shop yet, so meat (halal) or meat and fish (allergies) are never assigned on their own.
    const reason = kind === 'carniceria' && input.halal ? 'halal' : (kind === 'carniceria' || kind === 'pescaderia') && input.hasAllergies ? 'alergias' : null
    if (reason) {
      plan.heldBack.push({ kind, reason, candidates: candidates.map(ref) })
      continue
    }
    const [best, ...rest] = candidates
    if (input.hasSuper) plan.ask.push({ kind, redShop: best })
    else plan.assign.push({ kind, redShop: best, alternatives: rest.map(ref) })
  }
  return plan
}
