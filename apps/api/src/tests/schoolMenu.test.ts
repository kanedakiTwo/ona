/**
 * PRO-224: menú del comedor escolar. The reader with an invented sample menu
 * (no real school nor child), the groups, and the generator: a Monday with
 * lentejas at school → that dinner is not a pulse.
 */
import { describe, expect, it } from 'vitest'
import { dishFoodGroup, recipeFoodGroup, schoolMenuSaveSchema, NotASchoolMenuError } from '@ona/shared'
import { parseSchoolMenuAnswer, readSchoolMenu, schoolDinnerAvoidGroups, schoolMenuPrompt, withoutFoodGroup, SCHOOL_MENU_MODEL } from '../services/schoolMenu.js'
import { buildRandomMenu, defaultTemplate } from '../services/menuGenerator.js'
import { parseWebhookPayload } from '../services/whatsapp/webhookParser.js'
import { schoolMenuIntent, schoolMenuReply } from '../services/whatsapp/inbound.js'
import type { RecipeWithCourse } from '../services/matchableRecipes.js'

// An invented school menu for November 2026 (what the model would answer).
const SAMPLE_ANSWER = {
  days: [
    { date: '2026-11-02', dish: 'Lentejas con verduras · Tortilla de patatas', group: 'huevo' },
    { date: '2026-11-03', dish: 'Macarrones con tomate', group: 'pasta_arroz' },
    { date: '2026-11-04', dish: 'Merluza al horno con patatas', group: 'pescado' },
    { date: '2026-11-05', dish: 'Pollo asado con ensalada', group: 'carne' },
    { date: '2026-11-06', dish: 'Crema de calabacín', group: 'cosa-rara' }, // unknown group → from the dish
    { date: '2026-11-06', dish: 'Repetido', group: 'carne' }, // same date twice: first one wins
    { date: '2026-11-07', dish: 'Sábado: no hay cole', group: 'carne' }, // weekend: dropped
    { date: '2026-11-31', dish: 'Fecha imposible', group: 'carne' },
    { date: '2026-11-09', dish: 'Garbanzos con espinacas', group: null },
    { date: '2026-11-10', dish: '   ', group: 'carne' },
  ],
}

describe('the reader', () => {
  it('cleans the model’s answer for an invented sample menu', () => {
    expect(parseSchoolMenuAnswer(SAMPLE_ANSWER)).toEqual([
      { date: '2026-11-02', dish: 'Lentejas con verduras · Tortilla de patatas', group: 'huevo' },
      { date: '2026-11-03', dish: 'Macarrones con tomate', group: 'pasta_arroz' },
      { date: '2026-11-04', dish: 'Merluza al horno con patatas', group: 'pescado' },
      { date: '2026-11-05', dish: 'Pollo asado con ensalada', group: 'carne' },
      { date: '2026-11-06', dish: 'Crema de calabacín', group: 'verdura' },
      { date: '2026-11-09', dish: 'Garbanzos con espinacas', group: 'legumbre' },
    ])
  })

  it('not a school menu → NotASchoolMenuError', () => {
    expect(() => parseSchoolMenuAnswer({ error: 'not_a_school_menu' })).toThrow(NotASchoolMenuError)
    expect(() => parseSchoolMenuAnswer({ days: [] })).toThrow(NotASchoolMenuError)
    expect(() => parseSchoolMenuAnswer('nada')).toThrow(NotASchoolMenuError)
  })

  it('readSchoolMenu passes the file and today to the reader (Opus 5.5, D-070) and saves nothing', async () => {
    let seen: { mimeType: string; today: string } | null = null
    const days = await readSchoolMenu({ data: Buffer.from('%PDF-1.4'), mimeType: 'application/pdf' }, '2026-10-19', 'u1', async (file, today) => {
      seen = { mimeType: file.mimeType, today }
      return SAMPLE_ANSWER
    })
    expect(seen).toEqual({ mimeType: 'application/pdf', today: '2026-10-19' })
    expect(days).toHaveLength(6)
    expect(SCHOOL_MENU_MODEL).toBe('claude-opus-5-5')
  })

  it('the prompt asks for the main dish and its group, and nothing about health', () => {
    const p = schoolMenuPrompt('2026-10-19')
    expect(p).toContain('2026-10-19')
    expect(p).toContain('PLATO PRINCIPAL')
    expect(p).not.toMatch(/equilibr|saludable|nutrient/i)
  })

  it('the save schema checks dates and dishes', () => {
    expect(schoolMenuSaveSchema.safeParse({ days: [{ date: '2026-11-02', dish: 'Lentejas', group: 'legumbre' }] }).success).toBe(true)
    expect(schoolMenuSaveSchema.safeParse({ days: [{ date: '2026-02-30', dish: 'Lentejas', group: null }] }).success).toBe(false)
    expect(schoolMenuSaveSchema.safeParse({ days: [{ date: '2026-11-02', dish: '', group: null }] }).success).toBe(false)
    expect(schoolMenuSaveSchema.safeParse({ days: [{ date: '2026-11-02', dish: 'Lentejas', group: 'dulce' }] }).success).toBe(false)
  })
})

describe('groups', () => {
  it.each([
    ['Lentejas estofadas', 'legumbre'],
    ['Alubias blancas con chorizo', 'legumbre'],
    ['Judías verdes con patata', 'verdura'],
    ['Arroz con pollo', 'pasta_arroz'],
    ['Pollo con arroz', 'carne'],
    ['Tortilla de patatas', 'huevo'],
    ['Merluza en salsa verde', 'pescado'],
    ['Espaguetis a la boloñesa', 'pasta_arroz'],
    ['Crema de calabaza', 'verdura'],
    ['Yogur', null],
  ])('%s → %s', (dish, group) => {
    expect(dishFoodGroup(dish)).toBe(group)
  })

  it('a recipe without a telling name goes by its ingredients', () => {
    expect(recipeFoodGroup({ name: 'Guiso de la abuela', ingredients: [{ ingredientName: 'cebolla' }, { ingredientName: 'garbanzo cocido' }] })).toBe('legumbre')
    expect(recipeFoodGroup({ name: 'Plato sorpresa', ingredients: [{ ingredientName: 'cebolla' }] })).toBeNull()
  })

  it('a week’s school days → the group each dinner avoids', () => {
    const lunches = parseSchoolMenuAnswer(SAMPLE_ANSWER)
    expect(schoolDinnerAvoidGroups('2026-11-02', lunches)).toEqual({ 0: 'huevo', 1: 'pasta_arroz', 2: 'pescado', 3: 'carne', 4: 'verdura' })
    expect(schoolDinnerAvoidGroups('2026-11-09', lunches)).toEqual({ 0: 'legumbre' })
    expect(schoolDinnerAvoidGroups('2026-12-14', lunches)).toEqual({}) // no menu (holidays): no rule
  })
})

describe('the generator', () => {
  const recipe = (id: string, name: string, ingredient: string): RecipeWithCourse => ({
    id,
    name,
    meals: ['lunch', 'dinner'],
    seasons: ['spring', 'summer', 'autumn', 'winter'],
    frequency: null,
    tags: [],
    allergens: [],
    course: null,
    ingredients: [{ ingredientId: `i-${id}`, ingredientName: ingredient, quantity: 100, unit: 'g', allergenTags: [] }],
  })
  const pool: RecipeWithCourse[] = [
    ...Array.from({ length: 10 }, (_, i) => recipe(`leg${i}`, `Lentejas estofadas ${i}`, 'lenteja')),
    ...Array.from({ length: 10 }, (_, i) => recipe(`fish${i}`, `Merluza al horno ${i}`, 'merluza')),
  ]
  const dinnerOf = (days: ReturnType<typeof buildRandomMenu>['days'], d: number) =>
    (days[d].dinner?.dishes ?? []).flatMap((x) => (x.kind === 'recipe' ? [x.recipeId] : []))

  it('lentejas at school on Monday → the Monday dinner is never a pulse', () => {
    for (let run = 0; run < 40; run++) {
      const { days } = buildRandomMenu(defaultTemplate(), pool, 'autumn', [], new Set(), {}, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { 0: 'legumbre' })
      const monday = dinnerOf(days, 0)
      expect(monday).toHaveLength(1)
      expect(monday[0].startsWith('leg')).toBe(false)
    }
  })

  it('without a school menu, pulses can come out at dinner', () => {
    const seen = new Set<string>()
    for (let run = 0; run < 40; run++) {
      const { days } = buildRandomMenu(defaultTemplate(), pool, 'autumn', [], new Set(), {})
      for (let d = 0; d < 7; d++) for (const id of dinnerOf(days, d)) seen.add(id.slice(0, 3))
    }
    expect(seen.has('leg')).toBe(true)
  })

  it('withoutFoodGroup keeps recipes of unknown group', () => {
    const mixed = [...pool.slice(0, 2), recipe('x', 'Plato sorpresa', 'cebolla')]
    expect(withoutFoodGroup(mixed, 'legumbre').map((r) => r.id)).toEqual(['x'])
  })
})

describe('WhatsApp', () => {
  const now = new Date('2026-10-19T10:00:00Z')
  it('«menú del cole» in the caption or in a message of the last 30 min', () => {
    expect(schoolMenuIntent('el menú del cole de noviembre', [], now)).toBe(true)
    expect(schoolMenuIntent('Menu del comedor', [], now)).toBe(true)
    expect(schoolMenuIntent('la receta de mi abuela', [], now)).toBe(false)
    const recent = [{ direction: 'in', body: 'te paso el menú del colegio', status: 'processed', createdAt: new Date(now.getTime() - 5 * 60_000) }]
    expect(schoolMenuIntent(null, recent, now)).toBe(true)
    const old = [{ ...recent[0], createdAt: new Date(now.getTime() - 45 * 60_000) }]
    expect(schoolMenuIntent(null, old, now)).toBe(false)
    const done = [{ ...recent[0], body: '[Menú del cole] el menú del cole' }]
    expect(schoolMenuIntent(null, done, now)).toBe(false)
  })

  it('the reply shows what was read, to fix it, and says «no repetirán» (no health claim)', () => {
    const text = schoolMenuReply(parseSchoolMenuAnswer(SAMPLE_ANSWER).slice(0, 2))
    expect(text).toContain('He apuntado el menú del cole (2 días):')
    expect(text).toContain('lunes 2: Lentejas con verduras · Tortilla de patatas (huevo)')
    expect(text).toContain('no repetirán')
    expect(text).not.toMatch(/equilibr|salud/i)
  })

  it('a PDF document is parsed; another file type stays unsupported', () => {
    const payload = (document: Record<string, unknown>) => ({
      object: 'whatsapp_business_account',
      entry: [{ changes: [{ field: 'messages', value: { messages: [{ id: 'w1', from: '34600000000', timestamp: '1', type: 'document', document }] } }] }],
    })
    const [pdf] = parseWebhookPayload(payload({ id: 'm1', mime_type: 'application/pdf', caption: 'menú del cole' }) as any)
    expect(pdf.kind).toBe('document')
    expect(pdf.mediaId).toBe('m1')
    expect(pdf.text).toBe('menú del cole')
    const [doc] = parseWebhookPayload(payload({ id: 'm2', mime_type: 'application/msword' }) as any)
    expect(doc.kind).toBe('unsupported')
  })
})
