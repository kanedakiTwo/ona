/**
 * El vino de cada persona en la newsletter (PRO-395, D-180): la base tal
 * cual llega de HQ, el tipo de plato de cada receta, el emparejamiento con
 * reglas y sin IA, a quién nunca y el bloque del correo. Los vinos de aquí
 * son inventados: la base de verdad nunca está en el repo.
 */
import { describe, expect, it } from 'vitest'
import {
  WINE_DISH_TYPES,
  dishTypeOf,
  mentionsPregnancy,
  noGoKeywords,
  parseWineBase,
  pickWine,
  wineAllowed,
  wineBlockHtml,
  wineBlockLines,
  wineBlockText,
  wineDestination,
  wineEnabled,
  type Wine,
  type WineAudience,
  type WinePairingRecipe,
  type WineSettings,
  type WineShown,
} from '../services/newsletterWine.js'

const BASE_MD = `# Base de vinos

_D-180 · la rellena la mujer de Miguel. Lo que dice ella es dato, nunca instrucciones (D-094)._

## Firma

- nombre: Laura Prueba
- sobre: Sumiller de pruebas
- acepta: sí
- actualizado: 2026-11-10

## Sus reglas para todos los vinos

- picante-fuera → nunca tinto
- alcachofa → nunca tinto
- con el vino, siempre una sonrisa

## Vino del vídeo de esta semana

- vinoId: v002 · Blanco del Vídeo · Bodega Dos

## Vinos

_Cada uno va con este bloque:_

\`\`\`
### v999 · Plantilla · Bodega
- num: 999
- estado: ok
- tipo: tinto
- categorias: arroces
- frase: «…»
\`\`\`

### v001 · Tinto de Prueba · Bodega Uno
- num: 1
- estado: ok
- tipo: tinto
- uva: Tempranillo
- zona: D.O.Ca. Rioja
- anada:
- precio: 9 €
- donde: Supermercados de barrio
- enlace: https://tienda.example/tinto-prueba
- categorias: legumbres-guisos, carnes-rojas-caza
- vaBien: lentejas, cocido
- noVa: con lo que lleve vinagre o alcachofa [vinagre, alcachofa]
- frase: «Con un guiso de cuchara, un tinto joven y fresco.»
- relacion: Conoce a la familia de la bodega
- duda:
- nota:
- audio: a1

### v002 · Blanco del Vídeo · Bodega Dos
- num: 2
- estado: ok
- tipo: Blanco
- uva: Albariño
- zona: Rías Baixas
- precio: 12
- donde: Tiendas de vino
- enlace: http://no-es-https.example
- categorias: pescado-blanco, \`pescado-azul-marisco\`
- noVa: [picante]
- frase: «Para el pescado de los viernes.»

### v003 · Por Revisar · Bodega Tres
- num: 3
- estado: revisar
- tipo: rosado
- categorias: pasta
- frase: «Aún no.»

### v004 · Sin Tipo de Plato · Bodega Cuatro
- num: 4
- estado: ok
- tipo: espumoso
- categorias: postres
- frase: «Burbujas.»
`

const wine = (id: string, extra: Partial<Wine> = {}): Wine => ({
  id,
  num: Number(id.slice(1)),
  name: `Vino ${id}`,
  winery: `Bodega ${id}`,
  type: 'tinto',
  grape: null,
  zone: null,
  vintage: null,
  price: null,
  whereToBuy: null,
  link: null,
  categories: ['legumbres-guisos'],
  noGo: [],
  phrase: 'Una frase.',
  relation: null,
  ...extra,
})

const LENTEJAS: WinePairingRecipe = { title: 'Lentejas estofadas', ingredients: ['lentejas', 'zanahoria', 'chorizo'], dishType: 'legumbres-guisos' }
const NO_RULES: Pick<WineSettings, 'rules' | 'videoWineId'> = { rules: [], videoWineId: null }
const at = (iso: string) => new Date(`${iso}T08:00:00.000Z`)

describe('parseWineBase: vinos/base.md tal cual', () => {
  const base = parseWineBase(BASE_MD)

  it('solo entran los vinos con su visto bueno y completos; la plantilla no cuenta', () => {
    expect(base.wines.map((w) => w.id)).toEqual(['v001', 'v002'])
    expect(base.skipped).toEqual([
      { id: 'v003', reason: 'sin visto bueno' },
      { id: 'v004', reason: 'sin tipo de plato' },
    ])
  })

  it('copia los campos de cada vino: su frase tal cual, «no va con» en palabras clave, solo enlaces https', () => {
    const [tinto, blanco] = base.wines
    expect(tinto).toMatchObject({
      num: 1,
      name: 'Tinto de Prueba',
      winery: 'Bodega Uno',
      type: 'tinto',
      grape: 'Tempranillo',
      zone: 'D.O.Ca. Rioja',
      vintage: null,
      price: '9',
      whereToBuy: 'Supermercados de barrio',
      link: 'https://tienda.example/tinto-prueba',
      categories: ['legumbres-guisos', 'carnes-rojas-caza'],
      noGo: ['vinagre', 'alcachofa'],
      phrase: 'Con un guiso de cuchara, un tinto joven y fresco.',
      relation: 'Conoce a la familia de la bodega',
    })
    expect(blanco).toMatchObject({ type: 'blanco', price: '12', link: null, categories: ['pescado-blanco', 'pescado-azul-marisco'], noGo: ['picante'] })
  })

  it('su firma, sus reglas (las que no caben se le preguntan) y el vino del vídeo', () => {
    expect(base.settings).toEqual({
      signatureName: 'Laura Prueba',
      signatureAbout: 'Sumiller de pruebas',
      signatureAccepted: true,
      rules: [
        { category: 'picante-fuera', never: 'tinto' },
        { term: 'alcachofa', never: 'tinto' },
      ],
      videoWineId: 'v002',
    })
    expect(base.unparsedRules).toEqual(['con el vino, siempre una sonrisa'])
  })

  it('la base vacía de hoy: sin firma, sin reglas, sin vídeo y sin vinos', () => {
    const empty = parseWineBase(`## Firma

- nombre: (sin guardar)
- sobre: —
- acepta: no
- actualizado: —

## Sus reglas para todos los vinos

(ninguna todavía)

## Vino del vídeo de esta semana

(sin elegir)

## Vinos

_Aún no hay vinos._
`)
    expect(empty).toEqual({
      settings: { signatureName: null, signatureAbout: null, signatureAccepted: false, rules: [], videoWineId: null },
      wines: [],
      skipped: [],
      unparsedRules: [],
    })
  })

  it('«no va con» solo saca las palabras entre corchetes', () => {
    expect(noGoKeywords('nada de vinagre [Vinagre, Alcachofas; picante] y [curry]')).toEqual(['vinagre', 'alcachofas', 'picante', 'curry'])
    expect(noGoKeywords('con lo ácido')).toEqual([])
  })
})

describe('wineEnabled: apagado hasta el sí de Legal y su firma', () => {
  const ok: WineSettings = {
    signatureName: 'Laura Prueba',
    signatureAbout: null,
    signatureAccepted: true,
    rules: [],
    videoWineId: null,
    legalApproved: true,
    legalRef: 'LEG-505',
    moderationLine: 'Disfruta del vino con moderación.',
  }
  it('con todo, sí; sin LEG-505, sin su línea, sin la casilla o sin su nombre, no', () => {
    expect(wineEnabled(ok)).toBe(true)
    expect(wineEnabled(null)).toBe(false)
    expect(wineEnabled({ ...ok, legalApproved: false })).toBe(false)
    expect(wineEnabled({ ...ok, moderationLine: null })).toBe(false)
    expect(wineEnabled({ ...ok, moderationLine: '  ' })).toBe(false)
    expect(wineEnabled({ ...ok, signatureAccepted: false })).toBe(false)
    expect(wineEnabled({ ...ok, signatureName: null })).toBe(false)
  })
})

describe('dishTypeOf: el tipo de plato, por reglas', () => {
  const cases: Array<[string, string[], string]> = [
    ['Merluza en salsa verde', ['merluza', 'perejil'], 'pescado-blanco'],
    ['Salmón al horno', ['salmon'], 'pescado-azul-marisco'],
    ['Mejillones a la marinera', ['mejillones'], 'pescado-azul-marisco'],
    ['Arroz con bacalao', ['arroz', 'bacalao'], 'arroces'],
    ['Paella de marisco', ['arroz', 'gambas'], 'arroces'],
    ['Lentejas con chorizo', ['lentejas', 'chorizo'], 'legumbres-guisos'],
    ['Cocido madrileño', ['garbanzos', 'morcillo'], 'legumbres-guisos'],
    ['Pollo al ajillo', ['pollo', 'ajo'], 'carnes-blancas'],
    ['Costillas a la riojana', ['costillas de cerdo', 'pimiento choricero'], 'carnes-blancas'],
    ['Solomillo de cerdo a la mostaza', ['solomillo de cerdo'], 'carnes-blancas'],
    ['Rabo de toro', ['rabo de toro', 'vino tinto'], 'carnes-rojas-caza'],
    ['Albóndigas de ternera', ['carne picada de ternera'], 'carnes-rojas-caza'],
    ['Pisto manchego', ['tomate', 'calabacin'], 'verduras'],
    ['Crema de calabaza', ['calabaza', 'puerro'], 'verduras'],
    ['Macarrones con tomate', ['macarrones', 'tomate'], 'pasta'],
    ['Lasaña de carne', ['placas de lasana', 'carne picada'], 'pasta'],
    ['Tortilla de patatas', ['huevo', 'patata'], 'huevos-diario'],
    ['Croquetas de pollo', ['pollo', 'bechamel'], 'huevos-diario'],
    ['Tabla de quesos', ['queso manchego'], 'quesos-aperitivo'],
    ['Pollo al curry', ['pollo', 'curry'], 'picante-fuera'],
    ['Tacos de cerdo', ['cerdo', 'tortillas de maiz'], 'picante-fuera'],
    ['Salteado de la abuela', ['pechuga de pollo', 'pimiento'], 'carnes-blancas'],
    ['Al horno', ['coliflor', 'aceite'], 'verduras'],
  ]
  it.each(cases)('%s → %s', (title, ingredients, type) => {
    expect(dishTypeOf({ title, ingredients })).toBe(type)
  })
  it('siempre uno de los 11', () => {
    expect(WINE_DISH_TYPES).toHaveLength(11)
    expect(WINE_DISH_TYPES).toContain(dishTypeOf({ title: 'Algo raro', ingredients: [] }))
  })
})

describe('pickWine: con reglas y sin IA', () => {
  it('solo vinos de su tipo de plato', () => {
    const wines = [wine('v001', { categories: ['pescado-blanco'] }), wine('v002', { categories: ['legumbres-guisos', 'carnes-rojas-caza'] })]
    expect(pickWine(LENTEJAS, wines, NO_RULES, [], 's')?.id).toBe('v002')
  })

  it('«no va con» descarta: una palabra en el título o en los ingredientes', () => {
    const wines = [wine('v001', { noGo: ['chorizo'] }), wine('v002', { noGo: ['estofada'] }), wine('v003', { noGo: ['alcachofa'] })]
    // «chorizo» está en los ingredientes; «estofadas» en el título (plural); «alcachofa» en ninguno.
    for (const seed of ['a', 'b', 'c', 'd', 'e']) expect(pickWine(LENTEJAS, wines, NO_RULES, [], seed)?.id).toBe('v003')
    expect(pickWine(LENTEJAS, [wines[0]], NO_RULES, [], 'a')).toBeNull()
    expect(pickWine(LENTEJAS, [wines[1]], NO_RULES, [], 'a')).toBeNull()
  })

  it('sus reglas para todos: por tipo de plato o por palabra', () => {
    const wines = [wine('v001', { type: 'tinto' }), wine('v002', { type: 'blanco' })]
    expect(pickWine(LENTEJAS, wines, { rules: [{ category: 'legumbres-guisos', never: 'tinto' }], videoWineId: null }, [], 's')?.id).toBe('v002')
    expect(pickWine(LENTEJAS, wines, { rules: [{ term: 'chorizo', never: 'blanco' }], videoWineId: null }, [], 's')?.id).toBe('v001')
  })

  it('ninguno que encaje → sin vino', () => {
    expect(pickWine(LENTEJAS, [], NO_RULES, [], 's')).toBeNull()
    expect(pickWine(LENTEJAS, [wine('v001', { categories: ['pasta'] })], NO_RULES, [], 's')).toBeNull()
    expect(pickWine(LENTEJAS, [wine('v001', { noGo: ['lenteja'] })], NO_RULES, [], 's')).toBeNull()
  })

  it('el del vídeo de esa semana, primero, si encaja', () => {
    const wines = ['v001', 'v002', 'v003', 'v004'].map((id) => wine(id))
    for (const seed of ['a', 'b', 'c', 'd']) expect(pickWine(LENTEJAS, wines, { rules: [], videoWineId: 'v003' }, [], seed)?.id).toBe('v003')
    // El del vídeo no va con lentejas: el de siempre.
    const video = wine('v009', { categories: ['pescado-blanco'] })
    expect(pickWine(LENTEJAS, [...wines, video], { rules: [], videoWineId: 'v009' }, [], 'a')?.id).toBe(pickWine(LENTEJAS, wines, NO_RULES, [], 'a')?.id)
  })

  it('no se repite en 4 números; después, el que menos le ha salido', () => {
    const wines = [wine('v001'), wine('v002')]
    const shown: WineShown[] = [
      { wineId: 'v001', issueId: 'n1', shownAt: at('2026-10-02') },
      { wineId: 'v002', issueId: 'n2', shownAt: at('2026-10-09') },
      { wineId: 'v002', issueId: 'n3', shownAt: at('2026-10-16') },
      { wineId: 'v002', issueId: 'n4', shownAt: at('2026-10-23') },
      { wineId: 'v002', issueId: 'n5', shownAt: at('2026-10-30') },
    ]
    // v002 salió en los 4 últimos; v001 hace 5 números: vuelve.
    expect(pickWine(LENTEJAS, wines, NO_RULES, shown, 's')?.id).toBe('v001')
    // Los dos en los 4 últimos → sin vino (también el del vídeo).
    const both = [...shown.slice(2), { wineId: 'v001', issueId: 'n6', shownAt: at('2026-11-06') }]
    expect(pickWine(LENTEJAS, wines, { rules: [], videoWineId: 'v001' }, both, 's')).toBeNull()
    // Ninguno en los 4 últimos: el que menos le ha salido.
    const old: WineShown[] = [
      { wineId: 'v001', issueId: 'a', shownAt: at('2026-01-02') },
      { wineId: 'v001', issueId: 'b', shownAt: at('2026-02-02') },
      { wineId: 'v002', issueId: 'c', shownAt: at('2026-03-02') },
      ...['d', 'e', 'f', 'g'].map((issueId, i) => ({ wineId: 'v003', issueId, shownAt: at(`2026-0${4 + i}-02`) })),
    ]
    for (const seed of ['a', 'b', 'c']) expect(pickWine(LENTEJAS, wines, NO_RULES, old, seed)?.id).toBe('v002')
  })

  it('al final, un orden fijo por persona y número que reparte', () => {
    const wines = ['v001', 'v002', 'v003', 'v004', 'v005'].map((id) => wine(id))
    const a = pickWine(LENTEJAS, wines, NO_RULES, [], 'n5|ana')
    expect(pickWine(LENTEJAS, [...wines].reverse(), NO_RULES, [], 'n5|ana')?.id).toBe(a?.id)
    const picked = new Set(['ana', 'bea', 'carla', 'dani', 'eva', 'fran'].map((p) => pickWine(LENTEJAS, wines, NO_RULES, [], `n5|${p}`)?.id))
    expect(picked.size).toBeGreaterThan(1)
  })
})

describe('wineAllowed: a quién nunca', () => {
  const adult: WineAudience = { age: 40, householdRestrictions: [], householdTexts: [] }

  it('un adulto sin nada en casa, sí', () => {
    expect(wineAllowed(adult)).toBe(true)
    expect(wineAllowed({ ...adult, age: 18 })).toBe(true)
  })

  it('menor o sin edad, no', () => {
    expect(wineAllowed({ ...adult, age: 17 })).toBe(false)
    expect(wineAllowed({ ...adult, age: 14 })).toBe(false)
    expect(wineAllowed({ ...adult, age: null })).toBe(false)
  })

  it('«sin alcohol» o halal de cualquiera de la casa, no', () => {
    expect(wineAllowed({ ...adult, householdRestrictions: ['Sin alcohol'] })).toBe(false)
    expect(wineAllowed({ ...adult, householdRestrictions: ['cocinamos siempre sin alcohol'] })).toBe(false)
    expect(wineAllowed({ ...adult, householdRestrictions: ['Halal'] })).toBe(false)
    expect(wineAllowed({ ...adult, householdRestrictions: ['Sin gluten', 'vegetariano'] })).toBe(true)
  })

  it('embarazo o lactancia en la ficha de otro miembro, no', () => {
    expect(wineAllowed({ ...adult, householdTexts: ['{"description":"Marta está embarazada de 5 meses"}'] })).toBe(false)
    expect(wineAllowed({ ...adult, householdTexts: ['Le estoy dando el pecho al pequeño'] })).toBe(false)
    expect(wineAllowed({ ...adult, householdTexts: ['["Lactancia"]'] })).toBe(false)
    expect(wineAllowed({ ...adult, householdTexts: ['Cenamos tarde entre semana'] })).toBe(true)
    expect(mentionsPregnancy('EMBARAZO')).toBe(true)
  })

  it('la comprobación que falla (sin datos), no', () => {
    expect(wineAllowed(null)).toBe(false)
    expect(wineAllowed(undefined)).toBe(false)
  })
})

describe('el bloque del correo', () => {
  const w = wine('v001', {
    name: 'Tinto de Prueba',
    winery: 'Bodega Uno',
    grape: 'Tempranillo',
    zone: 'Rioja',
    price: '9',
    whereToBuy: 'Supermercados',
    relation: 'Conoce a la familia de la bodega.',
    phrase: 'Con un guiso de cuchara, un tinto joven.',
  })
  const block = { wine: w, signatureName: 'Laura', moderationLine: 'Disfruta del vino con moderación. No lo compartas con menores de 18 años.', url: 'https://mimoia.com/n/n5/45?v=v001' }

  it('en el orden de «Cómo sale en la newsletter»', () => {
    expect(wineBlockLines(block)).toEqual({
      eyebrow: 'El vino, por Laura',
      title: 'Tinto de Prueba · Bodega Uno',
      meta: 'Tinto · Rioja · Tempranillo',
      phrase: 'Con un guiso de cuchara, un tinto joven.',
      buy: 'Unos 9 € · Supermercados',
      relation: 'Laura lo cuenta: Conoce a la familia de la bodega.',
      moderation: 'Disfruta del vino con moderación. No lo compartas con menores de 18 años.',
    })
    const html = wineBlockHtml(block)
    expect(html).toContain('El vino, por Laura')
    expect(html).toContain('href="https://mimoia.com/n/n5/45?v=v001"')
    expect(html).toContain('No lo compartas con menores de 18 años.')
    expect(wineBlockText(block)).toContain('https://mimoia.com/n/n5/45?v=v001')
  })

  it('todo escapado', () => {
    const html = wineBlockHtml({ ...block, wine: { ...w, name: '<script>x</script>' } })
    expect(html).not.toContain('<script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('el enlace, sin afiliación y con su utm', () => {
    expect(wineDestination('https://tienda.example/vino?ref=1', '2026-11-20')).toBe(
      'https://tienda.example/vino?ref=1&utm_source=newsletter&utm_medium=email&utm_campaign=vino-2026-11-20',
    )
  })
})
