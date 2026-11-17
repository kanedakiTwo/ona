/**
 * PRO-1115: one ingredient per line, read without AI — the amount, the unit
 * (vocabulary of `units/`), the name, the note and «(opcional)»; and the
 * same row written back as a line for the editor.
 *
 * Run: pnpm --filter @ona/api test src/tests/ingredientLine.test.ts
 */
import { describe, it, expect } from 'vitest'
import {
  parseIngredientLine,
  ingredientLineToRow,
  formatIngredientLine,
  parseIngredientText,
  formatIngredientText,
  createRecipeSchema,
} from '@ona/shared'

type Expected = {
  quantity: number | null
  unit: string | null
  name: string
  note?: string | null
  optional?: boolean
}

// Lines as people write them (recipe books, blogs, WhatsApp notes).
const LINES: Array<[string, Expected]> = [
  ['200 g de lentejas', { quantity: 200, unit: 'g', name: 'lentejas' }],
  ['1 cebolla', { quantity: 1, unit: null, name: 'cebolla' }],
  ['2 cucharadas de aceite', { quantity: 2, unit: 'cda', name: 'aceite' }],
  ['una pizca de sal', { quantity: 1, unit: 'pizca', name: 'sal' }],
  ['sal', { quantity: null, unit: null, name: 'sal' }],
  ['200 g de bacalao, desalado (opcional)', { quantity: 200, unit: 'g', name: 'bacalao', note: 'desalado', optional: true }],
  ['1,5 kg de patatas', { quantity: 1.5, unit: 'kg', name: 'patatas' }],
  ['1/2 cebolla', { quantity: 0.5, unit: null, name: 'cebolla' }],
  ['1 1/2 tazas de harina', { quantity: 1.5, unit: 'taza', name: 'harina' }],
  ['½ limón', { quantity: 0.5, unit: null, name: 'limón' }],
  ['media cebolla morada', { quantity: 0.5, unit: null, name: 'cebolla morada' }],
  ['pimienta negra al gusto', { quantity: null, unit: 'al gusto', name: 'pimienta negra' }],
  ['un puñado de espinacas frescas', { quantity: 1, unit: 'puñado', name: 'espinacas frescas' }],
  ['2 dientes de ajo', { quantity: 2, unit: 'diente', name: 'ajo' }],
  ['3 huevos', { quantity: 3, unit: null, name: 'huevos' }],
  ['250 ml de leche entera', { quantity: 250, unit: 'ml', name: 'leche entera' }],
  ['1 l de caldo de pollo', { quantity: 1, unit: 'l', name: 'caldo de pollo' }],
  ['300 gr. de arroz bomba', { quantity: 300, unit: 'g', name: 'arroz bomba' }],
  ['400g de garbanzos cocidos', { quantity: 400, unit: 'g', name: 'garbanzos cocidos' }],
  ['2 cdas. de vinagre de Jerez', { quantity: 2, unit: 'cda', name: 'vinagre de Jerez' }],
  ['1 cucharadita de comino molido', { quantity: 1, unit: 'cdita', name: 'comino molido' }],
  ['un chorrito de vino blanco', { quantity: 1, unit: 'chorrito', name: 'vino blanco' }],
  ['4 lonchas de jamón serrano', { quantity: 4, unit: 'loncha', name: 'jamón serrano' }],
  ['2-3 tomates maduros', { quantity: 2, unit: null, name: 'tomates maduros' }],
  ['un par de zanahorias', { quantity: 2, unit: null, name: 'zanahorias' }],
  ['1 lata de atún en aceite', { quantity: 1, unit: 'lata', name: 'atún en aceite' }],
  ['nuez moscada', { quantity: null, unit: null, name: 'nuez moscada' }],
  ['2 hojas de laurel', { quantity: 2, unit: 'hoja', name: 'laurel' }],
  ['- 100 g de mantequilla, a temperatura ambiente', { quantity: 100, unit: 'g', name: 'mantequilla', note: 'a temperatura ambiente' }],
  ['perejil picado, al gusto', { quantity: null, unit: 'al gusto', name: 'perejil picado' }],
  ['500 g de carne picada (mitad cerdo, mitad ternera)', { quantity: 500, unit: 'g', name: 'carne picada', note: 'mitad cerdo, mitad ternera' }],
  ['1 vaso de agua', { quantity: 1, unit: 'vaso', name: 'agua' }],
  ['aceite de oliva virgen extra', { quantity: null, unit: null, name: 'aceite de oliva virgen extra' }],
  ['2 avellanas', { quantity: 2, unit: null, name: 'avellanas' }],
  ['dos pimientos rojos', { quantity: 2, unit: null, name: 'pimientos rojos' }],
  ['1 y medio kg de mejillones', { quantity: 1.5, unit: 'kg', name: 'mejillones' }],
  ['queso rallado (opcional)', { quantity: null, unit: null, name: 'queso rallado', optional: true }],
]

describe('parseIngredientLine', () => {
  it.each(LINES)('«%s»', (line, expected) => {
    const parsed = parseIngredientLine(line)
    expect(parsed).not.toBeNull()
    expect({
      quantity: parsed!.quantity,
      unit: parsed!.unit,
      name: parsed!.name,
      note: parsed!.note,
      optional: parsed!.optional,
    }).toEqual({ note: null, optional: false, ...expected })
  })

  it('has at least 25 real lines', () => {
    expect(LINES.length).toBeGreaterThanOrEqual(25)
  })

  it('a blank line is nothing', () => {
    expect(parseIngredientLine('   ')).toBeNull()
    expect(parseIngredientLine('- ')).toBeNull()
  })
})

describe('ingredientLineToRow', () => {
  const row = (line: string) => ingredientLineToRow(parseIngredientLine(line)!)

  it('keeps the units the recipe stores', () => {
    expect(row('200 g de lentejas')).toEqual({ quantity: 200, unit: 'g' })
    expect(row('2 cucharadas de aceite')).toEqual({ quantity: 2, unit: 'cda' })
    expect(row('1 cucharadita de comino')).toEqual({ quantity: 1, unit: 'cdita' })
    expect(row('una pizca de sal')).toEqual({ quantity: 1, unit: 'pizca' })
    expect(row('1 cebolla')).toEqual({ quantity: 1, unit: 'u' })
  })

  it('no amount is «al gusto»', () => {
    expect(row('sal')).toEqual({ quantity: 0, unit: 'al_gusto' })
    expect(row('pimienta al gusto')).toEqual({ quantity: 0, unit: 'al_gusto' })
  })

  it('kilos and litres become grams and millilitres, and remember how they were written', () => {
    expect(row('1,5 kg de patatas')).toEqual({ quantity: 1500, unit: 'g', displayQuantity: 1.5, displayUnit: 'kg' })
    expect(row('1 l de caldo')).toEqual({ quantity: 1000, unit: 'ml', displayQuantity: 1, displayUnit: 'l' })
  })

  it('kitchen measures convert with the vocabulary', () => {
    expect(row('un puñado de espinacas')).toEqual({ quantity: 30, unit: 'g', displayQuantity: 1, displayUnit: 'puñado' })
    expect(row('1 vaso de agua')).toEqual({ quantity: 200, unit: 'ml', displayQuantity: 1, displayUnit: 'vaso' })
    expect(row('2 dientes de ajo')).toEqual({ quantity: 10, unit: 'g', displayQuantity: 2, displayUnit: 'dientes' })
    expect(row('1 lata de atún')).toEqual({ quantity: 1, unit: 'u', displayQuantity: 1, displayUnit: 'lata' })
  })

  it('every row passes the recipe schema', () => {
    for (const [line] of LINES) {
      const r = row(line)
      const parsed = createRecipeSchema.safeParse({
        name: 'x',
        servings: 2,
        meals: ['lunch'],
        ingredients: [{ ingredientId: '00000000-0000-4000-8000-000000000000', ...r }],
      })
      expect(parsed.success, line).toBe(true)
    }
  })
})

describe('formatIngredientLine', () => {
  const rows = [
    { ingredientName: 'lentejas', quantity: 200, unit: 'g' },
    { ingredientName: 'cebolla', quantity: 1, unit: 'u' },
    { ingredientName: 'cebolla', quantity: 0.5, unit: 'u' },
    { ingredientName: 'aceite de oliva', quantity: 2, unit: 'cda' },
    { ingredientName: 'comino', quantity: 1, unit: 'cdita' },
    { ingredientName: 'sal', quantity: 1, unit: 'pizca' },
    { ingredientName: 'sal', quantity: 0, unit: 'al_gusto' },
    { ingredientName: 'bacalao', quantity: 200, unit: 'g', note: 'desalado', optional: true },
    { ingredientName: 'patatas', quantity: 1500, unit: 'g', displayQuantity: 1.5, displayUnit: 'kg' },
    { ingredientName: 'espinacas', quantity: 30, unit: 'g', displayQuantity: 1, displayUnit: 'puñado' },
    { ingredientName: 'leche', quantity: 250, unit: 'ml' },
    { ingredientName: 'harina', quantity: 12.5, unit: 'g' },
  ]

  it('writes lines people read', () => {
    expect(formatIngredientLine(rows[0])).toBe('200 g de lentejas')
    expect(formatIngredientLine(rows[2])).toBe('1/2 cebolla')
    expect(formatIngredientLine(rows[3])).toBe('2 cucharadas de aceite de oliva')
    expect(formatIngredientLine(rows[5])).toBe('una pizca de sal')
    expect(formatIngredientLine(rows[6])).toBe('sal al gusto')
    expect(formatIngredientLine(rows[7])).toBe('200 g de bacalao, desalado (opcional)')
    expect(formatIngredientLine(rows[8])).toBe('1,5 kg de patatas')
    expect(formatIngredientLine(rows[11])).toBe('12,5 g de harina')
  })

  it.each(rows)('reading the line again gives the same row ($ingredientName)', (r) => {
    const parsed = parseIngredientLine(formatIngredientLine(r))!
    const amount = ingredientLineToRow(parsed)
    expect(parsed.name).toBe(r.ingredientName)
    expect(amount.quantity).toBe(r.quantity)
    expect(amount.unit).toBe(r.unit)
    expect(parsed.note ?? undefined).toBe(r.note)
    expect(parsed.optional).toBe(r.optional ?? false)
  })
})

describe('parseIngredientText / formatIngredientText', () => {
  it('one ingredient per line; a heading ending in «:» starts a section', () => {
    const lines = parseIngredientText('Para la masa:\n250 g de harina\n\n1 huevo\nRelleno:\n200 g de espinacas\n')
    expect(lines.map((l) => [l.section, l.parsed.name])).toEqual([
      ['Para la masa', 'harina'],
      ['Para la masa', 'huevo'],
      ['Relleno', 'espinacas'],
    ])
  })

  it('writes the headings back', () => {
    const text = formatIngredientText([
      { ingredientName: 'harina', quantity: 250, unit: 'g', section: 'Para la masa' },
      { ingredientName: 'huevo', quantity: 1, unit: 'u', section: 'Para la masa' },
      { ingredientName: 'espinacas', quantity: 200, unit: 'g', section: 'Relleno' },
    ])
    expect(text).toBe('Para la masa:\n250 g de harina\n1 huevo\nRelleno:\n200 g de espinacas')
  })
})
