/**
 * Red de tiendas: the Red's step inside «Preparar los pedidos» (design §5).
 * Links the household's own shops that joined, then, for each fresh kind whose
 * lines fell back to the súper or to nothing: asks for the postal code, asks
 * once (household with a súper) or assigns a Red shop (copy in household_shops).
 */
import { isRedKind, type RedPrepareInfo, type RedSettings, type ShopKind } from '@ona/shared'
import { db as defaultDb } from '../../db/connection.js'
import { planRedAssignments } from './assign.js'
import { activeRedShops, assignRedShop, getHouseholdRed, linkOwnShopsToRed, toLite } from './store.js'

type Db = typeof defaultDb

export const emptyRedInfo = (enabled: boolean, discountPct = 5): RedPrepareInfo => ({
  enabled, discountPct, needsPostalCode: false, questions: [], assigned: [], heldBack: [], uncovered: [],
})

export async function prepareRedShops(
  input: {
    householdId: string
    /** The household's shops, by position. */
    shops: Array<{ kind: string; name: string }>
    fellBack: ShopKind[]
    diet: { halal: boolean; hasAllergies: boolean }
    terms: RedSettings
  },
  db: Db = defaultDb,
): Promise<{ info: RedPrepareInfo; shopsChanged: boolean }> {
  const info = emptyRedInfo(true, input.terms.discountPct)
  const red = await activeRedShops(db)
  const linked = await linkOwnShopsToRed(input.householdId, red, db)
  const { postalCode, choices } = await getHouseholdRed(input.householdId, db)
  const superShop = input.shops.find((s) => s.kind === 'supermercado') ?? null
  const plan = planRedAssignments({
    neededKinds: input.fellBack.filter(isRedKind),
    hasSuper: !!superShop,
    superName: superShop?.name ?? null,
    postalCode,
    choices,
    redShops: red.map(toLite),
    ...input.diet,
  })
  info.needsPostalCode = plan.needsPostalCode
  info.uncovered = plan.uncovered
  info.heldBack = plan.heldBack
  info.questions = plan.ask.map((a) => ({ kind: a.kind, redShop: { id: a.redShop.id, name: a.redShop.name }, superName: superShop!.name }))
  for (const a of plan.assign) {
    const row = red.find((r) => r.id === a.redShop.id)!
    const shopId = await assignRedShop(input.householdId, row, postalCode!, db)
    if (shopId) info.assigned.push({ kind: a.kind, shopId, name: row.name, alternatives: a.alternatives })
  }
  return { info, shopsChanged: linked > 0 || info.assigned.length > 0 }
}
