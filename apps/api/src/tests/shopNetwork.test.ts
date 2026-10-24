/**
 * «Tiendas de Mimoia» (PRO-358, specs/shop-orders.md → «Tiendas de
 * Mimoia»): who a shop of the Red covers, the order the ficha gives
 * (presupuesto, preferencias, cercanía — never payment), the «¿Ya le
 * comprabas?» answer (only «no» counts), the postal code in the ficha and
 * the admin form ↔ schema contract.
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_NETWORK_SHOP_FORM,
  PROFILE_FACT_VALUE_SCHEMAS,
  buildNetworkShopPayload,
  coverageCloseness,
  coverageText,
  networkShopForm,
  networkShopInputSchema,
  parseCoverageText,
  postalCodeSchema,
  preferredFulfilment,
  rankNetworkShops,
  setPostalCodeSchema,
  tierForBudget,
  type NetworkCoverage,
  type NetworkShop,
  type RankableNetworkShop,
} from '@ona/shared'
import { householdShopFromNetwork } from '../services/shopNetwork.js'
import { addNetworkShopSkill, findNetworkShopsSkill, networkShopLine } from '../services/assistant/shopNetworkSkills.js'
import { factSentence, factTopic } from '../services/profile/view.js'

const local: NetworkCoverage = { nationwide: false, areas: [{ label: 'Boadilla del Monte', postalCodes: ['28660', '28669'] }] }
const province: NetworkCoverage = { nationwide: false, areas: [{ label: null, postalCodes: ['28'] }] }
const spain: NetworkCoverage = { nationwide: true, areas: [] }

function shop(over: Partial<NetworkShop> = {}): NetworkShop {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Carnicería de prueba',
    kind: 'carniceria',
    tier: 'medio',
    coverage: local,
    channel: 'whatsapp',
    whatsapp: '34600000099',
    email: null,
    webUrl: null,
    phone: null,
    fulfilment: ['recogida', 'reparto'],
    deliveryMinEur: 20,
    deliveryFeeEur: 3,
    freeDeliveryFromEur: 50,
    notes: 'De martes a sábado, de 9:00 a 14:00',
    status: 'activa',
    createdAt: '2026-10-24T00:00:00.000Z',
    updatedAt: '2026-10-24T00:00:00.000Z',
    ...over,
  }
}

const r = (name: string, over: Partial<RankableNetworkShop> = {}): RankableNetworkShop => ({
  name, kind: 'carniceria', tier: 'medio', coverage: local, fulfilment: ['recogida'], ...over,
})

describe('coverage', () => {
  it('a postal code of the zone is covered; one outside only by the shops that ship to all Spain', () => {
    expect(coverageCloseness(local, '28660')).toBe(0)
    expect(coverageCloseness(local, '28001')).toBeNull()
    expect(coverageCloseness(province, '28001')).toBe(3)
    expect(coverageCloseness(spain, '08001')).toBe(9)
    expect(coverageCloseness({ ...local, nationwide: true }, '28669')).toBe(0)
    expect(coverageCloseness({ ...local, nationwide: true }, '41001')).toBe(9)
  })

  it('without a postal code only nationwide shops cover', () => {
    expect(coverageCloseness(local, null)).toBeNull()
    expect(coverageCloseness(spain, null)).toBe(9)
  })

  it('reads the admin text: municipalities with their codes, bare codes and prefixes', () => {
    const { areas, errors } = parseCoverageText('Boadilla del Monte: 28660, 28669\n28223\n\n286\nPozuelo: calle Mayor')
    expect(areas).toEqual([
      { label: 'Boadilla del Monte', postalCodes: ['28660', '28669'] },
      { label: null, postalCodes: ['28223'] },
      { label: null, postalCodes: ['286'] },
    ])
    expect(errors).toEqual(['Pozuelo: calle Mayor'])
    expect(parseCoverageText(coverageText(areas)).areas).toEqual(areas)
  })
})

describe('order: presupuesto, preferencias, cercanía — never payment', () => {
  it('only the shops that cover the household', () => {
    const out = rankNetworkShops([r('Lejos', { coverage: { nationwide: false, areas: [{ label: null, postalCodes: ['41001'] }] } }), r('Cerca'), r('Envío', { coverage: spain })], { postalCode: '28660', tier: null, fulfilment: null })
    expect(out.map((s) => s.name)).toEqual(['Cerca', 'Envío'])
  })

  it('cercanía: the exact code before the province before all Spain', () => {
    const out = rankNetworkShops([r('A España', { coverage: spain }), r('B Provincia', { coverage: province }), r('C Local')], { postalCode: '28660', tier: null, fulfilment: null })
    expect(out.map((s) => s.name)).toEqual(['C Local', 'B Provincia', 'A España'])
  })

  it('presupuesto goes first: the band nearest to the household, even over a closer shop', () => {
    const shops = [r('Cara y cerca', { tier: 'alto' }), r('Barata en la provincia', { tier: 'bajo', coverage: province }), r('Media y cerca', { tier: 'medio' })]
    expect(rankNetworkShops(shops, { postalCode: '28660', tier: 'bajo', fulfilment: null }).map((s) => s.name))
      .toEqual(['Barata en la provincia', 'Media y cerca', 'Cara y cerca'])
  })

  it('preferencias before cercanía: a household that gets its shopping home sees delivery first', () => {
    const shops = [r('Solo recogida, local'), r('Reparto, provincia', { coverage: province, fulfilment: ['reparto'] }), r('Paquetería', { coverage: spain, fulfilment: ['envio'] })]
    expect(rankNetworkShops(shops, { postalCode: '28660', tier: null, fulfilment: 'reparto' }).map((s) => s.name))
      .toEqual(['Reparto, provincia', 'Paquetería', 'Solo recogida, local'])
  })

  it('ties go by name, whatever the input order: nothing else of a shop moves it', () => {
    const a = [r('Zeta'), r('Alfa'), r('Eme')]
    const ctx = { postalCode: '28660', tier: 'medio' as const, fulfilment: 'recogida' as const }
    expect(rankNetworkShops(a, ctx).map((s) => s.name)).toEqual(['Alfa', 'Eme', 'Zeta'])
    expect(rankNetworkShops([...a].reverse(), ctx).map((s) => s.name)).toEqual(['Alfa', 'Eme', 'Zeta'])
  })

  it('the ficha → band and preference', () => {
    expect(tierForBudget(null, 2)).toBeNull()
    expect(tierForBudget(50, 2)).toBe('bajo')
    expect(tierForBudget(80, 2)).toBe('medio')
    expect(tierForBudget(150, 2)).toBe('alto')
    expect(tierForBudget(40, null)).toBe('medio')
    expect(preferredFulfilment([])).toBeNull()
    expect(preferredFulfilment([{ fulfilment: 'recoger' }])).toBe('recogida')
    expect(preferredFulfilment([{ fulfilment: 'recoger' }, { fulfilment: 'domicilio' }])).toBe('reparto')
  })
})

describe('«¿Ya le comprabas?»', () => {
  it('«no» → the household shop comes from the Red and counts', () => {
    const v = householdShopFromNetwork(shop(), { alreadyCustomer: false, address: null })
    expect(v.origin).toBe('red')
    expect(v.networkShopId).toBe(shop().id)
  })

  it('«sí, ya le compraba» → its own shop: never counts, but remembers where it came from', () => {
    const v = householdShopFromNetwork(shop(), { alreadyCustomer: true, address: null })
    expect(v.origin).toBe('propia')
    expect(v.networkShopId).toBe(shop().id)
  })

  it('copies what orders need: kind, contact, minimum, fee and notes; picks up when it can', () => {
    const v = householdShopFromNetwork(shop(), { alreadyCustomer: false, address: 'Calle Falsa 1' })
    expect(v).toMatchObject({ name: 'Carnicería de prueba', kind: 'carniceria', channel: 'whatsapp', whatsapp: '34600000099', fulfilment: 'recoger', address: null, deliveryMinEur: 20, deliveryFeeEur: 3, notes: 'De martes a sábado, de 9:00 a 14:00' })
  })

  it('a shop that only delivers goes a domicilio, to the address the household already gave', () => {
    expect(householdShopFromNetwork(shop({ fulfilment: ['envio'] }), { alreadyCustomer: false, address: 'Calle Falsa 1' })).toMatchObject({ fulfilment: 'domicilio', address: 'Calle Falsa 1' })
    expect(householdShopFromNetwork(shop({ fulfilment: ['reparto'] }), { alreadyCustomer: false, address: null })).toMatchObject({ fulfilment: 'domicilio', address: null })
  })

  it('Mimo passes the answer as it is', async () => {
    const calls: Array<[string, string, unknown]> = []
    const api = (async (method: string, path: string, body?: unknown) => {
      calls.push([method, path, body])
      return { id: 'x', name: 'Carnicería de prueba', kind: 'carniceria', fulfilment: 'recoger', address: null }
    }) as any
    const out = await addNetworkShopSkill.handler({ shop_id: shop().id, already_customer: true }, { userId: 'u', api } as any)
    expect(calls).toEqual([['POST', `/shop-network/${shop().id}/adopt`, { alreadyCustomer: true }]])
    expect(out.summary).toContain('Carnicería de prueba')
    const none = await addNetworkShopSkill.handler({ shop_id: shop().id }, { userId: 'u', api } as any)
    expect(none.summary).toMatch(/Ya le comprabas/)
  })
})

describe('postal code in the ficha', () => {
  it('5 digits, province 01–52', () => {
    expect(postalCodeSchema.safeParse('28660').success).toBe(true)
    expect(postalCodeSchema.safeParse('08001').success).toBe(true)
    expect(postalCodeSchema.safeParse('53001').success).toBe(false)
    expect(postalCodeSchema.safeParse('00123').success).toBe(false)
    expect(postalCodeSchema.safeParse('2866').success).toBe(false)
    expect(setPostalCodeSchema.safeParse({ postalCode: '28660' }).success).toBe(true)
    expect(PROFILE_FACT_VALUE_SCHEMAS.postal_code.safeParse({ code: '28660' }).success).toBe(true)
  })

  it('reads in «Tu ficha» under La casa', () => {
    expect(factSentence('postal_code', { code: '28660' }, 'casa')).toBe('Código postal: 28660')
    expect(factTopic('postal_code')).toBe('la_casa')
  })

  it('Mimo saves it before listing, and refuses a bad one', async () => {
    const calls: Array<[string, string, unknown]> = []
    const api = (async (method: string, path: string, body?: unknown) => {
      calls.push([method, path, body])
      return method === 'GET' ? { postalCode: '28660', canEdit: true, shops: [shop()] } : { postalCode: '28660', changed: true }
    }) as any
    const out = await findNetworkShopsSkill.handler({ postal_code: '28660' }, { userId: 'u', api } as any)
    expect(calls.map((c) => `${c[0]} ${c[1]}`)).toEqual(['PUT /household/postal-code', 'GET /shop-network'])
    expect(out.summary).toContain('Carnicería de prueba')
    expect(out.summary).toContain('ninguna paga por salir antes')
    const bad = await findNetworkShopsSkill.handler({ postal_code: '2866' }, { userId: 'u', api } as any)
    expect(bad.summary).toMatch(/5 cifras/)
  })

  it('a shop line carries the amounts and its id', () => {
    const line = networkShopLine(shop())
    expect(line).toContain('pedido mínimo 20 €')
    expect(line).toContain('envío 3 €')
    expect(line).toContain('envío gratis desde 50 €')
    expect(line).toContain(`[id ${shop().id}]`)
  })
})

describe('admin form ↔ schema', () => {
  it('the form payload passes the schema', () => {
    const form = { ...EMPTY_NETWORK_SHOP_FORM, name: 'Pescadería de prueba', kind: 'pescaderia' as const, coverageText: 'Boadilla del Monte: 28660, 28669', whatsapp: '600 000 099', deliveryMin: '20', deliveryFee: '2,50', freeDeliveryFrom: '45' }
    const payload = buildNetworkShopPayload(form)
    expect(networkShopInputSchema.safeParse(payload).success).toBe(true)
    expect(payload).toMatchObject({ whatsapp: '34600000099', deliveryMinEur: 20, deliveryFeeEur: 2.5, freeDeliveryFromEur: 45 })
  })

  it('needs a coverage (codes or toda España) and a way to hand over', () => {
    const base = { ...EMPTY_NETWORK_SHOP_FORM, name: 'X', whatsapp: '600000099' }
    expect(networkShopInputSchema.safeParse(buildNetworkShopPayload(base)).success).toBe(false)
    expect(networkShopInputSchema.safeParse(buildNetworkShopPayload({ ...base, nationwide: true })).success).toBe(true)
    expect(networkShopInputSchema.safeParse(buildNetworkShopPayload({ ...base, nationwide: true, fulfilment: [] })).success).toBe(false)
  })

  it('a shop → form → payload keeps it', () => {
    const s = shop()
    const p = buildNetworkShopPayload(networkShopForm(s))
    expect(p).toMatchObject({ name: s.name, kind: s.kind, tier: s.tier, coverage: s.coverage, fulfilment: s.fulfilment, deliveryMinEur: 20, freeDeliveryFromEur: 50, status: 'activa' })
  })
})
