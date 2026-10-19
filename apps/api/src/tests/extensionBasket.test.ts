/**
 * La cesta para la extensión del navegador (specs/shop-orders.md): qué
 * artículos de una línea fusionada son productos distintos, la cesta que
 * sale de las líneas del pedido y de qué artículos de la lista viene cada
 * clave.
 *
 * Run: pnpm --filter @ona/api test src/tests/extensionBasket.test.ts
 */
import { describe, it, expect } from 'vitest'
import {
  basketMayBeInCart,
  buildExtensionBasket,
  buyRuleByKey,
  orderMembers,
  orderQtyInGrams,
  sourceItemsForBasketKey,
  toOrderQty,
  type BuyableUnit,
  type ShopOrderLine,
} from '@ona/shared'

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
  it('el grupo se llama como su nombre base más corto (a igual longitud, el primero por localeCompare), venga en el orden que venga', () => {
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
    // Se compara el nombre base, sin « · varias presentaciones» (como los nombres de catálogo de la lista); el grupo conserva el completo.
    const varias = 'Jamón serrano · varias presentaciones'
    expect(orderMembers([m('f', 'jamón serrano fileteado', 100), m('v', varias, 100), m('i', 'jamón ibérico', 50)], 'jamon')?.[0].name).toBe(varias)
    expect(orderMembers([m('v', varias, 100), m('f', 'jamón serrano fileteado', 100), m('i', 'jamón ibérico', 50)], 'jamon')?.[0].name).toBe(varias)
    // Bases distintas de igual longitud: decide la base, no el nombre completo.
    const minuscula = 'jamón serrano · varias presentaciones'
    expect(orderMembers([m('S', 'Jamón serrano', 100), m('v', minuscula, 100), m('i', 'jamón ibérico', 50)], 'jamon')?.[0].name).toBe(minuscula)
    // Con la misma base, el nombre completo que va primero por localeCompare.
    expect(orderMembers([m('v', 'alubias rojas · varias presentaciones', 400), m('r', 'alubias rojas', 400), m('b', 'alubias blancas', 300)], 'alubias')?.[0].name).toBe('alubias rojas')
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

const line = (over: Partial<ShopOrderLine> & { key: string; name: string }): ShopOrderLine => ({
  sourceItemId: null,
  sourceItemIds: [`id-${over.key}`],
  ingredientId: null,
  quantity: 1,
  unit: 'u',
  note: null,
  estimateEur: null,
  estimateSource: null,
  volatile: false,
  quote: null,
  verdict: null,
  reasons: [],
  decision: null,
  ...over,
})

describe('buildExtensionBasket', () => {
  it('con regla: gramos de la regla, piezas si es por pieza, elección y búsqueda', () => {
    const [ajo, jamon] = buildExtensionBasket([
      line({ key: 'l1', name: 'ajo', quantity: 3, unit: 'u', ruleKey: 'ajo', grams: 50 }),
      line({ key: 'l2', name: 'Jamón serrano', quantity: 50, unit: 'g', ruleKey: 'jamon', grams: 100, choice: 'serrano' }),
    ])
    expect(ajo).toEqual({ key: 'l1', name: 'ajo', choice: null, quantity: 3, unit: 'u', grams: 50, piezas: 1, search: 'ajo' })
    expect(jamon).toMatchObject({ key: 'l2', choice: 'serrano', grams: 100, piezas: null, search: 'Jamón serrano' })
  })
  it('la búsqueda añade la elección si el nombre no la lleva ya («jamon» + ibérico)', () => {
    const [jamon] = buildExtensionBasket([line({ key: 'l1', name: 'jamon', quantity: 50, unit: 'g', ruleKey: 'jamon', grams: 100, choice: 'ibérico' })])
    expect(jamon).toMatchObject({ name: 'jamon', choice: 'ibérico', search: 'jamon ibérico' })
  })
  it('sin regla: gramos solo si la unidad es g/ml; sufijo fuera', () => {
    const [kombu, tortillas] = buildExtensionBasket([
      line({ key: 'l1', name: 'kombu · varias presentaciones', quantity: 10, unit: 'g' }),
      line({ key: 'l2', name: 'tortillas de trigo', quantity: 8, unit: 'u' }),
    ])
    expect(kombu).toMatchObject({ name: 'kombu', grams: 10, search: 'kombu' })
    expect(tortillas).toMatchObject({ grams: null, quantity: 8, unit: 'u', piezas: null })
  })
  it('deja fuera «probablemente lo tienes» sin marcar; elección pendiente → null; «¿cuánto?» → gramos sugeridos', () => {
    const lines = buildExtensionBasket([
      line({ key: 'l1', name: 'mantequilla', ruleKey: 'mantequilla', grams: 250, included: false }),
      line({ key: 'l2', name: 'jamon', ruleKey: 'jamon', grams: null, choice: 'serrano', needsChoice: { question: '¿Serrano o ibérico?', options: ['serrano', 'ibérico'] } }),
      line({ key: 'l3', name: 'queso', ruleKey: 'queso', grams: null, needsQuantity: { suggestion: '250 g', grams: 250 } }),
    ])
    expect(lines.map((l) => l.key)).toEqual(['l2', 'l3'])
    // Con la elección pendiente no vale la que traiga la línea.
    expect(lines[0]).toMatchObject({ choice: null, search: 'jamon' })
    expect(lines[1].grams).toBe(250)
  })
  it('una línea con members sale como un grupo por producto (l3.1, l3.2)', () => {
    const lines = buildExtensionBasket([
      line({
        key: 'l3', name: 'alubias blancas', quantity: 800, unit: 'g', ruleKey: 'alubias', grams: 1000,
        members: [
          { name: 'alubias blancas', quantity: 400, unit: 'g', sourceItemIds: ['a'] },
          { name: 'alubias rojas', quantity: 400, unit: 'g', sourceItemIds: ['b'] },
        ],
      }),
    ])
    expect(lines).toEqual([
      { key: 'l3.1', name: 'alubias blancas', choice: null, quantity: 400, unit: 'g', grams: 400, piezas: null, search: 'alubias blancas' },
      { key: 'l3.2', name: 'alubias rojas', choice: null, quantity: 400, unit: 'g', grams: 400, piezas: null, search: 'alubias rojas' },
    ])
  })
  it('con los grupos de orderMembers: mezcla de unidades en gramos, nombre sin sufijo y cada clave con sus artículos', () => {
    // 1500 ml de leche (genérico) + 1 u de entera + 1 u de desnatada: el genérico se suma a la entera, que pasa a gramos.
    // La desnatada solo viene con « · varias presentaciones»: el grupo conserva ese nombre y la cesta le quita el sufijo.
    const members = orderMembers(
      [m('g', 'leche', 1500, 'ml'), m('e', 'leche entera', 1, 'u'), m('d', 'leche desnatada · varias presentaciones', 1, 'u')],
      'leche',
    )
    expect(members?.[1].name).toBe('leche desnatada · varias presentaciones')
    const lines = [line({ key: 'l4', name: 'leche', quantity: 1500 + 2 * perUnit('leche'), unit: 'g', ruleKey: 'leche', sourceItemIds: ['g', 'e', 'd'], members })]
    const entera = perUnit('leche') + 1500
    expect(buildExtensionBasket(lines)).toEqual([
      { key: 'l4.1', name: 'leche entera', choice: null, quantity: entera, unit: 'g', grams: entera, piezas: null, search: 'leche entera' },
      { key: 'l4.2', name: 'leche desnatada', choice: null, quantity: 1, unit: 'u', grams: perUnit('leche'), piezas: null, search: 'leche desnatada' },
    ])
    expect(sourceItemsForBasketKey(lines, 'l4.1')).toEqual(['e', 'g'])
    expect(sourceItemsForBasketKey(lines, 'l4.2')).toEqual(['d'])
  })
  it('un grupo en u lleva los gramos de la regla, como una línea (2 u de leche → 2 briks)', () => {
    const [entera] = buildExtensionBasket([
      line({
        key: 'l5', name: 'leche', quantity: 3, unit: 'u', ruleKey: 'leche', grams: 3 * perUnit('leche'),
        members: [
          { name: 'leche entera', quantity: 2, unit: 'u', sourceItemIds: ['e'] },
          { name: 'leche desnatada', quantity: 1, unit: 'u', sourceItemIds: ['d'] },
        ],
      }),
    ])
    expect(entera).toMatchObject({ key: 'l5.1', quantity: 2, unit: 'u', grams: 2 * perUnit('leche'), piezas: null })
  })
  it('un grupo de una regla por pieza da sus piezas, como una línea (ajo: la u es un diente y la pieza, una cabeza)', () => {
    const ajo = buyRuleByKey('ajo')!
    expect(ajo).toMatchObject({ by: 'pieza', g: 50, ug: 5 })
    const [morado, negro] = buildExtensionBasket([
      line({
        key: 'l6', name: 'ajo', quantity: 22, unit: 'u', ruleKey: 'ajo', grams: 150,
        members: [
          { name: 'ajo morado', quantity: 20, unit: 'u', sourceItemIds: ['m'] },
          { name: 'ajo negro', quantity: 2, unit: 'u', sourceItemIds: ['n'] },
        ],
      }),
    ])
    expect(morado).toMatchObject({ key: 'l6.1', quantity: 20, unit: 'u', grams: 100, piezas: 2 })
    expect(negro).toMatchObject({ key: 'l6.2', quantity: 2, unit: 'u', grams: 10, piezas: 1 })
  })
  it('un grupo cuenta sus piezas como el pedido (14 dientes de ajo, 70 g → 2 cabezas; 1,1 tomates → 2)', () => {
    expect(toOrderQty({ name: 'ajo morado', quantity: 14, unit: 'u' }).text).toBe('2 cabezas de ajos')
    expect(toOrderQty({ name: 'tomate pera', quantity: 1.1, unit: 'u' }).text).toBe('2 tomates pera')
    const [ajoMorado, , tomatePera] = buildExtensionBasket([
      line({
        key: 'l8', name: 'ajo', quantity: 16, unit: 'u', ruleKey: 'ajo', grams: 100,
        members: [
          { name: 'ajo morado', quantity: 14, unit: 'u', sourceItemIds: ['m'] },
          { name: 'ajo negro', quantity: 2, unit: 'u', sourceItemIds: ['n'] },
        ],
      }),
      line({
        key: 'l9', name: 'tomate', quantity: 2.1, unit: 'u', ruleKey: 'tomate', grams: 450,
        members: [
          { name: 'tomate pera', quantity: 1.1, unit: 'u', sourceItemIds: ['p'] },
          { name: 'tomate de rama', quantity: 1, unit: 'u', sourceItemIds: ['r'] },
        ],
      }),
    ])
    expect(ajoMorado).toMatchObject({ key: 'l8.1', grams: 70, piezas: 2 })
    expect(tomatePera).toMatchObject({ key: 'l9.1', piezas: 2 })
  })
  it('pescado entero: la línea cuenta piezas enteras y el grupo, gramos limpios, como el pedido', () => {
    const pescado = buyRuleByKey('pescado entero')!
    expect(pescado).toMatchObject({ by: 'pieza', g: 550, edibleG: 300 })
    // El pedido: 400 g limpios de dorada son 2 doradas; la línea guarda los gramos de 2 piezas enteras.
    const pedido = toOrderQty({ name: 'dorada', quantity: 400, unit: 'g' })
    expect(pedido).toMatchObject({ ruleKey: 'pescado entero', grams: 2 * pescado.g! })
    const [linea, dorada, lubina] = buildExtensionBasket([
      line({ key: 'l1', name: 'dorada', quantity: 400, unit: 'g', ruleKey: 'pescado entero', grams: pedido.grams }),
      line({
        key: 'l2', name: 'pescado entero', quantity: 700, unit: 'g', ruleKey: 'pescado entero', grams: 3 * pescado.g!,
        members: [
          { name: 'dorada', quantity: 400, unit: 'g', sourceItemIds: ['d'] },
          { name: 'lubina', quantity: 300, unit: 'g', sourceItemIds: ['l'] },
        ],
      }),
    ])
    expect(linea.piezas).toBe(2) // 1100 g de pieza entera, no 1100 / 300
    expect(dorada).toMatchObject({ key: 'l2.1', grams: 400, piezas: 2 })
    expect(lubina).toMatchObject({ key: 'l2.2', grams: 300, piezas: 1 })
  })
  it('un grupo en u de una regla que no sabe lo que pesa una unidad (jamón) va sin gramos ni piezas', () => {
    const [serrano, iberico] = buildExtensionBasket([
      line({
        key: 'l7', name: 'jamon', quantity: 50, unit: 'g', ruleKey: 'jamon', grams: 100,
        members: [
          { name: 'Jamón serrano', quantity: 1, unit: 'u', sourceItemIds: ['s'] },
          { name: 'jamón ibérico', quantity: 50, unit: 'g', sourceItemIds: ['i'] },
        ],
      }),
    ])
    expect(serrano).toMatchObject({ key: 'l7.1', quantity: 1, unit: 'u', grams: null, piezas: null })
    expect(iberico).toMatchObject({ key: 'l7.2', grams: 50, piezas: null })
  })
})

describe('basketMayBeInCart', () => {
  it('algo entró, o hay líneas sin verificar', () => {
    expect(basketMayBeInCart({ anadidas: 1, lineas: [] })).toBe(true)
    expect(basketMayBeInCart({ anadidas: 0, lineas: [{ key: 'l1', estado: 'no_verificada' }] })).toBe(true)
    expect(basketMayBeInCart({ anadidas: 0, lineas: [{ key: 'l1', estado: 'fallida' }] })).toBe(false)
  })
})

describe('sourceItemsForBasketKey', () => {
  const lines = [
    line({ key: 'l1', name: 'arroz', sourceItemIds: ['x', 'y'] }),
    line({ key: 'l3', name: 'alubias', members: [
      { name: 'alubias blancas', quantity: 400, unit: 'g', sourceItemIds: ['a'] },
      { name: 'alubias rojas', quantity: 400, unit: 'g', sourceItemIds: ['b', 'c'] },
    ] }),
  ]
  it('línea entera, grupo, y claves que no existen', () => {
    expect(sourceItemsForBasketKey(lines, 'l1')).toEqual(['x', 'y'])
    expect(sourceItemsForBasketKey(lines, 'l3.2')).toEqual(['b', 'c'])
    expect(sourceItemsForBasketKey(lines, 'l9')).toEqual([])
    expect(sourceItemsForBasketKey(lines, 'l3.7')).toEqual([])
  })
  it('si la parte de grupo no es un entero ≥ 1 escrito como lo escribe la cesta, la clave no vale: ningún artículo', () => {
    for (const key of ['l3.', 'l3.0', 'l3.x', 'l3.1.2', 'l3.01', 'l1.']) expect(sourceItemsForBasketKey(lines, key), key).toEqual([])
  })
})
