/**
 * "Cómo se compra" (specs/shop-orders.md → Buy rules). The fixture is
 * Miguel's first real order (2026-10-08): every line that went out wrong
 * ("Ajo: 25 g", "Jamón serrano: 1 unidad", "Pescado entero fresco (dorada,
 * lubina, gallo, etc.): 2 unidades"…) with the text a shop understands.
 *
 * Run: pnpm --filter @ona/api test src/tests/buyRules.test.ts
 */
import { describe, it, expect } from 'vitest'
import { toOrderQty, splitCompound, resolveBuyRule, weightPhrase, type OrderQtyInput } from '@ona/shared'

const q = (name: string, quantity: number, unit: OrderQtyInput['unit'], extra: Partial<OrderQtyInput> = {}) =>
  toOrderQty({ name, quantity, unit, ...extra })
const manual = (name: string) => q(name, 1, 'u', { quantitySource: 'default' })

describe("Miguel's first real order, line by line", () => {
  it.each([
    // frutería
    ['tomate', 3, 'u', '3 tomates de ensalada', 'fruteria'],
    ['zanahoria', 150, 'g', '2 zanahorias', 'fruteria'],
    ['cebolla', 225, 'g', '2 cebollas', 'fruteria'],
    ['ajo', 25, 'g', '1 cabeza de ajos', 'fruteria'],
    ['pepino', 1, 'u', '1 pepino', 'fruteria'],
    ['pimiento verde', 1, 'u', '1 pimiento verde italiano', 'fruteria'],
    ['cebolla morada', 2, 'u', '2 cebollas moradas', 'fruteria'],
    ['limón', 5, 'u', '5 limones', 'fruteria'],
    // fresh peas out of season → frozen, at the súper
    ['guisantes', 300, 'g', '1 bolsa de guisantes congelados (400 g)', 'supermercado'],
    // súper by pack
    ['feta', 200, 'g', '2 paquetes de queso feta (150 g)', 'supermercado'],
    ['aceitunas negras', 22, 'u', '1 lata de aceitunas negras sin hueso (150 g)', 'supermercado'],
    ['alcaparras', 50, 'g', '1 frasco de alcaparras (80 g)', 'supermercado'],
    ['lentejas', 400, 'g', '1 paquete de lentejas (1 kg)', 'supermercado'],
    ['harina de fuerza', 150, 'g', '1 paquete de harina de fuerza (1 kg)', 'supermercado'],
  ] as const)('%s %s %s → "%s"', (name, quantity, unit, text, shop) => {
    const r = q(name, quantity, unit)
    expect(r.text).toBe(text)
    expect(r.shop).toBe(shop)
  })

  it('whole fish names one species with an alternative, never the generic', () => {
    const r = q('pescado entero fresco (dorada, lubina, gallo, etc.)', 2, 'u')
    expect(r.text).toBe('2 doradas de ración, limpias para el horno (o lubinas, la que esté mejor hoy)')
    expect(r.shop).toBe('pescaderia')
    expect(r.volatile).toBe(false) // "gallo" in the name no longer flags it as lonja fish
  })

  it('jamón goes by grams and must say which — the recipe 50 g waits for serrano/ibérico', () => {
    const r = q('jamon', 50, 'g')
    expect(r.text).toBe('100 g de jamón, loncheado fino — ¿serrano o ibérico?')
    expect(r.needsChoice?.options).toEqual(['serrano', 'ibérico'])
    expect(q('jamon', 50, 'g', { choice: 'serrano' }).text).toBe('100 g de jamón serrano, loncheado fino')
  })

  it('jamón typed without an amount asks how much (never "1 unidad")', () => {
    const serrano = manual('Jamón serrano')
    expect(serrano.text).toBe('jamón serrano, loncheado fino — ¿cuánto?')
    expect(serrano.needsQuantity).toEqual({ suggestion: '100 g', grams: 100 })
    const york = manual('Jamón york')
    expect(york.text).toBe('jamón cocido extra, en lonchas — ¿cuánto?')
    expect(york.needsQuantity?.suggestion).toBe('150 g')
  })

  it('fridge staples in tiny amounts are offered as "probablemente lo tienes"', () => {
    const butter = q('mantequilla', 25, 'g')
    expect(butter.text).toBe('1 tarrina de mantequilla (250 g)')
    expect(butter.maybeHave).toBe(true)
    expect(q('leche entera', 50, 'ml').maybeHave).toBe(true)
    expect(q('leche entera', 2000, 'ml')).toMatchObject({ text: '2 briks de leche entera (1 l)', maybeHave: false })
    const yolk = q('yema de huevo', 1, 'u')
    expect(yolk).toMatchObject({ text: 'media docena de huevos', maybeHave: true })
  })

  it('things typed by hand without amount: one unit or one pack, the right product', () => {
    expect(manual('calabacín')).toMatchObject({ text: '1 calabacín', shop: 'fruteria' })
    expect(manual('Leche avena')).toMatchObject({ text: '1 brik de bebida de avena (1 l)', eci: 'bebida de avena' })
    expect(manual('leche').text).toBe('1 brik de leche entera (1 l)')
    expect(manual('Queso rallado').text).toBe('1 bolsa de queso rallado (200 g)')
    expect(manual('Queso sandwich').text).toBe('1 paquete de queso en lonchas (200 g)')
    expect(manual('Yogur').text).toBe('1 pack de 4 yogures naturales')
    expect(manual('Queso').needsChoice?.question).toBe('¿Qué queso?')
    expect(manual('pan').text).toBe('1 pan — ¿de molde, de hogaza o en barra?')
    expect(manual('Harina')).toMatchObject({ shop: 'despensa', text: '1 paquete de harina de trigo (1 kg)' })
    expect(manual('Galletas daniela').ruleKey).toBeNull() // no rule: name only
  })

  it('compound "Fruta (…)" / "hierbas aromáticas (…)" split into products', () => {
    expect(splitCompound('Fruta (fresas, plátanos, naranjas, mandarinas, mango, melón)')).toEqual(['fresas', 'platanos', 'naranjas', 'mandarinas', 'mango', 'melon'])
    expect(splitCompound('hierbas aromáticas (romero, tomillo)')).toEqual(['romero', 'tomillo'])
    expect(splitCompound('pescado entero fresco (dorada, lubina, gallo, etc.)')).toBeNull() // a choice, not a family
    expect(manual('fresas').text).toBe('1 bandeja de fresas')
    expect(manual('plátanos').text).toBe('6 plátanos de Canarias')
    expect(manual('naranjas').text).toBe('1 kg de naranjas de zumo')
    expect(manual('mango').text).toBe('1 mango')
    expect(manual('melón').text).toBe('1 melón')
    expect(manual('romero').text).toBe('1 manojo de romero')
  })
})

describe('converter rules', () => {
  it('rounds pieces up, with a 15 % tolerance and a minimum of one', () => {
    expect(q('cebolla', 320, 'g').text).toBe('2 cebollas')
    expect(q('cebolla', 360, 'g').text).toBe('3 cebollas')
    expect(q('ajo', 8, 'g').text).toBe('1 cabeza de ajos')
    expect(q('ajo', 6, 'u').text).toBe('1 cabeza de ajos') // 6 cloves
    expect(q('perejil', 1, 'cda').text).toBe('1 manojo de perejil')
    expect(q('jengibre fresco', 25, 'g').text).toBe('1 trozo de jengibre')
  })

  it('half pieces only for big pieces, and only when half is enough', () => {
    expect(q('melón', 800, 'g').text).toBe('medio melón')
    expect(q('sandía', 1500, 'g').text).toBe('media sandía')
    expect(q('melón', 1500, 'g').text).toBe('1 melón')
    expect(q('tomate', 50, 'g').text).toBe('1 tomate de ensalada') // no half tomatoes
  })

  it('many small pieces go by weight', () => {
    expect(q('tomate', 1000, 'g').text).toBe('1 kg de tomates de ensalada')
    expect(q('naranja', 1500, 'g').text).toBe('kilo y medio de naranjas de zumo')
  })

  it('meat by quarter kilos, charcutería by 50 g from 100 g', () => {
    expect(q('ternera', 450, 'g', { notes: ['picada'] }).text).toBe('medio kilo de carne picada de ternera')
    expect(q('carne picada', 300, 'g').text).toBe('medio kilo de carne picada mixta')
    expect(q('ternera', 450, 'g').needsChoice?.question).toBe('¿Para qué es la ternera?')
    expect(q('costillas de cerdo', 800, 'g').text).toBe('1 kg de costillas de cerdo')
    expect(q('jamon cocido', 220, 'g').text).toBe('250 g de jamón cocido extra, en lonchas')
  })

  it('recipe notes choose the product or carry the shop prep', () => {
    expect(q('cebolla', 150, 'g', { notes: ['morada en juliana fina'] }).text).toBe('1 cebolla morada')
    expect(q('tomate', 250, 'g', { notes: ['cherry partido'] }).text).toBe('1 tarrina de tomates cherry')
    expect(q('pollo', 800, 'g', { notes: ['pechuga'] }).text).toBe('4 pechugas de pollo')
    expect(q('merluza', 400, 'g').text).toBe('medio kilo de merluza, en lomos sin piel')
    expect(q('pollo', 800, 'g').text).toBe('1 kg de pollo troceado para guisar')
  })

  it('cuts read naturally once chosen', () => {
    expect(q('cerdo', 450, 'g', { notes: ['en filetes'], choice: 'lomo' }).text).toBe('medio kilo de lomo de cerdo, en filetes')
    expect(q('cordero', 1000, 'g', { choice: 'chuletillas' }).text).toBe('1 kg de chuletillas de cordero')
    expect(q('cerdo', 450, 'g').text).toBe('medio kilo de de cerdo — ¿lomo, secreto o carne para guisar?'.replace('de de', 'de'))
  })

  it('household preferences fill the choice next time', () => {
    expect(toOrderQty({ name: 'jamon', quantity: 50, unit: 'g' }, { jamon: 'ibérico' }).text).toBe('100 g de jamón ibérico, loncheado fino')
  })

  it("ignores the list's \"· varias presentaciones\" suffix", () => {
    expect(resolveBuyRule('sal · varias presentaciones')?.rule.key).toBe('sal')
  })

  it('canned or processed forms never take a fresh rule', () => {
    expect(resolveBuyRule('pollo en lata')).toBeNull()
    expect(resolveBuyRule('cebolleta encurtida')).toBeNull()
    expect(resolveBuyRule('atun')?.rule.shop).toBe('supermercado')
  })

  it('weights read the way they are said', () => {
    expect(weightPhrase(250)).toBe('un cuarto de kilo')
    expect(weightPhrase(500)).toBe('medio kilo')
    expect(weightPhrase(750)).toBe('tres cuartos de kilo')
    expect(weightPhrase(1000)).toBe('1 kg')
    expect(weightPhrase(1500)).toBe('kilo y medio')
    expect(weightPhrase(2250)).toBe('2,25 kg')
  })
})
