/**
 * La cesta para la extensión del navegador (specs/shop-orders.md): qué
 * artículos de una línea fusionada son productos distintos, la cesta que
 * sale de las líneas del pedido y de qué artículos de la lista viene cada
 * clave.
 *
 * Run: pnpm --filter @ona/api test src/tests/extensionBasket.test.ts
 */
import { describe, it, expect } from 'vitest'
import { buyRuleByKey, orderMembers, orderQtyInGrams, type BuyableUnit } from '@ona/shared'

const m = (id: string, name: string, quantity: number, unit: 'g' | 'ml' | 'u' = 'g') => ({ id, name, quantity, unit })
/** Tecleado sin cantidad: el «1 u» por defecto. */
const p = (id: string, name: string) => ({ id, name, quantity: 1, unit: 'u' as const, placeholder: true })

/** Gramos de una unidad con la regla real (`ug`, si no `g`). */
const perUnit = (ruleKey: string) => {
  const rule = buyRuleByKey(ruleKey)!
  return rule.ug ?? rule.g!
}

/** Lo que pesan juntas unas cantidades, con la regla de la línea. */
const totalGrams = (xs: Array<{ quantity: number; unit: BuyableUnit }>, ruleKey: string) =>
  xs.reduce((sum, x) => sum + orderQtyInGrams(x.quantity, x.unit, ruleKey)!, 0)

describe('orderMembers', () => {
  it('separa productos que la lista separa (alubias blancas + rojas)', () => {
    expect(orderMembers([m('a', 'alubias blancas', 400), m('b', 'alubias rojas', 400)], 'alubias')).toEqual([
      { name: 'alubias blancas', quantity: 400, unit: 'g', sourceItemIds: ['a'] },
      { name: 'alubias rojas', quantity: 400, unit: 'g', sourceItemIds: ['b'] },
    ])
  })
  it('el nombre genérico de la regla se suma al específico (jamón + jamón serrano, leche + leche entera)', () => {
    expect(orderMembers([m('a', 'jamon', 50), m('b', 'Jamón serrano', 1, 'u')], 'jamon')).toBeNull()
    expect(orderMembers([m('a', 'leche', 1, 'u'), m('b', 'leche entera', 50, 'ml')], 'leche')).toBeNull()
    expect(orderMembers([m('a', 'alubias', 1, 'u'), m('b', 'alubias rojas', 400)], 'alubias')).toBeNull()
  })
  it('el mismo producto escrito de dos formas no se separa', () => {
    expect(orderMembers([m('a', 'huevos', 4, 'u'), m('b', 'yema de huevo', 1, 'u')], 'huevos')).toBeNull()
    expect(orderMembers([m('a', 'Tomate', 3, 'u'), m('b', 'Tomate · varias presentaciones', 2, 'u')], 'tomate')).toBeNull()
    // «huevo» no es la clave de la regla (`huevos`): aquí solo los junta el criterio de la lista.
    expect(orderMembers([m('a', 'huevo', 4, 'u'), m('b', 'yema de huevo', 1, 'u')], 'huevos')).toBeNull()
  })
  it('una sola línea o una línea sin regla con un solo nombre: null', () => {
    expect(orderMembers([m('a', 'arroz', 500)], 'arroz')).toBeNull()
    expect(orderMembers([m('a', 'kombu', 10), m('b', 'Kombu', 5)], null)).toBeNull()
  })
  it('el genérico es el grupo de la lista al que va la clave de la regla, en cualquier orden', () => {
    // El catálogo dice «huevo» y la regla se llama `huevos`: es el mismo grupo de la lista.
    expect(orderMembers([m('h', 'huevo', 6, 'u'), m('c', 'Huevos camperos', 1, 'u')], 'huevos')).toBeNull()
    expect(orderMembers([m('t', 'tomates', 4, 'u'), m('p', 'tomate pera', 1, 'u')], 'tomate')).toBeNull()
    expect(orderMembers([m('h', 'huevo', 6, 'u'), m('G', 'huevos', 1, 'u'), m('c', 'Huevos camperos', 1, 'u')], 'huevos')).toBeNull()
  })
  it('el genérico se suma al grupo específico más grande y le pasa sus artículos', () => {
    expect(orderMembers([m('g', 'alubias', 200), m('b', 'alubias blancas', 400), m('r', 'alubias rojas', 300)], 'alubias')).toEqual([
      { name: 'alubias blancas', quantity: 600, unit: 'g', sourceItemIds: ['b', 'g'] },
      { name: 'alubias rojas', quantity: 300, unit: 'g', sourceItemIds: ['r'] },
    ])
  })
  it('el grupo más grande se mide en gramos, no por el número (2 u de alubias pesan más que 100 g)', () => {
    expect(orderMembers([m('g', 'alubias', 1, 'u'), m('b', 'alubias blancas', 2, 'u'), m('r', 'alubias rojas', 100)], 'alubias')).toEqual([
      { name: 'alubias blancas', quantity: 3, unit: 'u', sourceItemIds: ['b', 'g'] },
      { name: 'alubias rojas', quantity: 100, unit: 'g', sourceItemIds: ['r'] },
    ])
  })
  it('con unidades distintas suma en gramos y no se pierde ninguna cantidad', () => {
    // Dentro de un grupo: «alubias rojas» en g y «alubias rojas · varias presentaciones» en u.
    const alubias = [m('r', 'alubias rojas', 400), m('v', 'alubias rojas · varias presentaciones', 2, 'u'), m('b', 'alubias blancas', 300)]
    const a = orderMembers(alubias, 'alubias')
    expect(a).toEqual([
      { name: 'alubias rojas', quantity: 400 + 2 * perUnit('alubias'), unit: 'g', sourceItemIds: ['r', 'v'] },
      { name: 'alubias blancas', quantity: 300, unit: 'g', sourceItemIds: ['b'] },
    ])
    expect(totalGrams(a!, 'alubias')).toBe(totalGrams(alubias, 'alubias'))

    // En la absorción: el genérico (1500 ml) va a un grupo en u. Entera y desnatada pesan lo mismo: gana la primera.
    const leche = [m('g', 'leche', 1500, 'ml'), m('e', 'leche entera', 1, 'u'), m('d', 'leche desnatada', 1, 'u')]
    const l = orderMembers(leche, 'leche')
    expect(l).toEqual([
      { name: 'leche entera', quantity: perUnit('leche') + 1500, unit: 'g', sourceItemIds: ['e', 'g'] },
      { name: 'leche desnatada', quantity: 1, unit: 'u', sourceItemIds: ['d'] },
    ])
    expect(totalGrams(l!, 'leche')).toBe(totalGrams(leche, 'leche'))
  })
  it('si una cantidad no se puede pesar, gana la pesable, venga antes o después (pérdida conocida)', () => {
    // `jamon` se vende al peso y no sabe cuánto pesa 1 u (ver orderQtyInGrams).
    expect(orderMembers([m('s', 'Jamón serrano', 100), m('u', 'Jamón serrano', 1, 'u'), m('i', 'jamón ibérico', 50)], 'jamon')).toEqual([
      { name: 'Jamón serrano', quantity: 100, unit: 'g', sourceItemIds: ['s', 'u'] },
      { name: 'jamón ibérico', quantity: 50, unit: 'g', sourceItemIds: ['i'] },
    ])
    expect(orderMembers([m('u', 'Jamón serrano', 1, 'u'), m('s', 'Jamón serrano', 100), m('i', 'jamón ibérico', 50)], 'jamon')).toEqual([
      { name: 'Jamón serrano', quantity: 100, unit: 'g', sourceItemIds: ['u', 's'] },
      { name: 'jamón ibérico', quantity: 50, unit: 'g', sourceItemIds: ['i'] },
    ])
  })
  it('el grupo se llama como su nombre más corto (a igual longitud, el primero por localeCompare), venga en el orden que venga', () => {
    const serrano = { name: 'Jamón serrano', quantity: 200, unit: 'g' }
    expect(orderMembers([m('f', 'jamón serrano fileteado', 100), m('s', 'Jamón serrano', 100), m('i', 'jamón ibérico', 50)], 'jamon')?.[0]).toEqual({ ...serrano, sourceItemIds: ['f', 's'] })
    expect(orderMembers([m('s', 'Jamón serrano', 100), m('f', 'jamón serrano fileteado', 100), m('i', 'jamón ibérico', 50)], 'jamon')?.[0]).toEqual({ ...serrano, sourceItemIds: ['s', 'f'] })
    expect(orderMembers([m('S', 'Jamón serrano', 100), m('s', 'jamón serrano', 100), m('i', 'jamón ibérico', 50)], 'jamon')?.[0].name).toBe('jamón serrano')
    expect(orderMembers([m('s', 'jamón serrano', 100), m('S', 'Jamón serrano', 100), m('i', 'jamón ibérico', 50)], 'jamon')?.[0].name).toBe('jamón serrano')
    // Gana el más corto aunque vaya detrás por orden alfabético.
    expect(orderMembers([m('t', 'aguja de ternera', 300), m('v', 'aguja de vaca', 200), m('c', 'aguja de cerdo', 400)], 'aguja')?.[0]).toEqual({
      name: 'aguja de vaca',
      quantity: 500,
      unit: 'g',
      sourceItemIds: ['t', 'v'],
    })
  })
  it('lo tecleado sin cantidad solo cuenta si su grupo no tiene ninguna cantidad real, y siempre aporta sus artículos', () => {
    const blancas = { name: 'alubias blancas', quantity: 300, unit: 'g', sourceItemIds: ['b'] }
    expect(orderMembers([p('t', 'alubias rojas'), m('r', 'alubias rojas', 200), m('b', 'alubias blancas', 300)], 'alubias')).toEqual([
      { name: 'alubias rojas', quantity: 200, unit: 'g', sourceItemIds: ['t', 'r'] },
      blancas,
    ])
    expect(orderMembers([m('r', 'alubias rojas', 200), p('t', 'alubias rojas'), m('b', 'alubias blancas', 300)], 'alubias')).toEqual([
      { name: 'alubias rojas', quantity: 200, unit: 'g', sourceItemIds: ['r', 't'] },
      blancas,
    ])
    expect(orderMembers([p('t', 'alubias rojas'), m('b', 'alubias blancas', 300)], 'alubias')).toEqual([
      { name: 'alubias rojas', quantity: 1, unit: 'u', sourceItemIds: ['t'] },
      blancas,
    ])
    // Dos sin cantidad no se suman: se queda 1 u, como el borrador cuando todo va por defecto.
    expect(orderMembers([p('t', 'alubias rojas'), p('t2', 'alubias rojas'), m('b', 'alubias blancas', 300)], 'alubias')).toEqual([
      { name: 'alubias rojas', quantity: 1, unit: 'u', sourceItemIds: ['t', 't2'] },
      blancas,
    ])
  })
  it('un genérico sin cantidad solo aporta sus artículos, y un grupo sin cantidad mide 0 para llevárselo', () => {
    expect(orderMembers([p('G', 'alubias'), m('b', 'alubias blancas', 400), m('r', 'alubias rojas', 300)], 'alubias')).toEqual([
      { name: 'alubias blancas', quantity: 400, unit: 'g', sourceItemIds: ['b', 'G'] },
      { name: 'alubias rojas', quantity: 300, unit: 'g', sourceItemIds: ['r'] },
    ])
    // 1 u de blancas pesaría más que 100 g de rojas, pero va sin cantidad: el genérico va a las rojas.
    expect(orderMembers([m('G', 'alubias', 200), p('t', 'alubias blancas'), m('r', 'alubias rojas', 100)], 'alubias')).toEqual([
      { name: 'alubias blancas', quantity: 1, unit: 'u', sourceItemIds: ['t'] },
      { name: 'alubias rojas', quantity: 300, unit: 'g', sourceItemIds: ['r', 'G'] },
    ])
    // Si ninguno tiene cantidad (empate a 0), el genérico le da la suya al primero.
    expect(orderMembers([m('G', 'alubias', 200), p('t', 'alubias blancas'), p('t2', 'alubias rojas')], 'alubias')).toEqual([
      { name: 'alubias blancas', quantity: 200, unit: 'g', sourceItemIds: ['t', 'G'] },
      { name: 'alubias rojas', quantity: 1, unit: 'u', sourceItemIds: ['t2'] },
    ])
  })
})

describe('orderQtyInGrams', () => {
  it('g y ml tal cual; la cucharada son 15 g y la cucharadita 5 g', () => {
    expect(orderQtyInGrams(250, 'g', null)).toBe(250)
    expect(orderQtyInGrams(330, 'ml', null)).toBe(330)
    expect(orderQtyInGrams(2, 'cda', null)).toBe(30)
    expect(orderQtyInGrams(3, 'cdita', null)).toBe(15)
  })
  it('u: los gramos de una unidad de la regla, `ug` si lo tiene y si no `g`', () => {
    const ajo = buyRuleByKey('ajo')! // ug: un diente; g: la cabeza
    expect(ajo.ug).toBeTruthy()
    expect(ajo.ug).not.toBe(ajo.g)
    expect(orderQtyInGrams(2, 'u', 'ajo')).toBe(2 * ajo.ug!)
    const tomate = buyRuleByKey('tomate')! // solo g
    expect(tomate.ug).toBeUndefined()
    expect(orderQtyInGrams(3, 'u', 'tomate')).toBe(3 * tomate.g!)
  })
  it('u sin regla, o con una regla que no sabe cuánto pesa una unidad: null', () => {
    expect(orderQtyInGrams(1, 'u', null)).toBeNull()
    const jamon = buyRuleByKey('jamon')!
    expect(jamon.ug ?? jamon.g).toBeUndefined()
    expect(orderQtyInGrams(1, 'u', 'jamon')).toBeNull()
  })
  it('sin la guarda de cantidad positiva de toOrderQty: 0 u son 0 g', () => {
    expect(orderQtyInGrams(0, 'u', 'alubias')).toBe(0)
  })
})
