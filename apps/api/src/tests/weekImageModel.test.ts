/**
 * The layout model of the WhatsApp week image (2026-10-15): which format
 * (A: comida + cena, one dish each; B: anything richer), which columns, what
 * each cell shows, and which rows are today / past / skipped / empty.
 */
import { describe, it, expect } from 'vitest'
import { buildWeekImageModel, photoRecipeIds, stripEmoji } from '../services/weekImage/model.js'
import { weekMenuCaption, weekMenuDigest } from '../services/menuText.js'

const r = (recipeName: string, extra: Record<string, unknown> = {}) =>
  ({ kind: 'recipe' as const, recipeId: `id-${recipeName}`, recipeName, ...extra })
const note = (text: string) => ({ kind: 'note' as const, text })
const slot = (...dishes: any[]) => ({ dishes })
const week = (days: any[], skippedDays?: number[]) => ({ weekStart: '2026-10-12', days, skippedDays })
const THU = { today: '2026-10-15' }

const LUIS = Array.from({ length: 7 }, (_, i) => ({ lunch: slot(r(`Comida ${i}`)), dinner: slot(r(`Cena ${i}`)) }))

describe('buildWeekImageModel — format', () => {
  it('A for comida + cena with one dish each', () => {
    const m = buildWeekImageModel(week(LUIS), THU)!
    expect(m.format).toBe('A')
    expect(m.columns.map((c) => c.label)).toEqual(['Comida', 'Cena'])
    expect(m.columns.map((c) => c.icon)).toEqual(['lunch', 'dinner'])
    expect(m.subtitle).toBe('Del 12 al 18 de octubre · comida y cena')
  })

  it('A for a single meal column too', () => {
    const m = buildWeekImageModel(week([{ dinner: slot(r('Sopa')) }]), THU)!
    expect(m.format).toBe('A')
    expect(m.subtitle).toBe('Del 12 al 18 de octubre · cena')
  })

  it('B as soon as one slot has two dishes', () => {
    const days = [...LUIS]
    days[5] = { lunch: slot(r('Dorada'), r('Ensalada verde')), dinner: slot(r('Sopa')) }
    expect(buildWeekImageModel(week(days), THU)!.format).toBe('B')
  })

  it('B with a third meal column, columns in meal order whatever the JSON order', () => {
    const m = buildWeekImageModel(week([{ dinner: slot(r('Sopa')), lunch: slot(r('Paella')), breakfast: slot(r('Tostadas')) }]), THU)!
    expect(m.format).toBe('B')
    expect(m.columns.map((c) => c.meal)).toEqual(['breakfast', 'lunch', 'dinner'])
    expect(m.subtitle).toBe('Del 12 al 18 de octubre · desayuno, comida y cena')
  })

  it('four columns with merienda; never more than four', () => {
    const m = buildWeekImageModel(
      week([{ breakfast: slot(r('A')), lunch: slot(r('B')), snack: slot(r('C')), dinner: slot(r('D')), brunch: slot(r('E')) }]),
      THU,
    )!
    expect(m.columns.map((c) => c.label)).toEqual(['Desayuno', 'Comida', 'Merienda', 'Cena'])
    expect(m.columns.map((c) => c.icon)).toEqual(['breakfast', 'lunch', 'snack', 'dinner'])
  })

  it('a meal no day uses gets no column', () => {
    const m = buildWeekImageModel(week([{ lunch: slot(r('Paella')), dinner: slot() }]), THU)!
    expect(m.columns.map((c) => c.meal)).toEqual(['lunch'])
  })
})

describe('buildWeekImageModel — cells', () => {
  it('shows two dishes and counts the rest as «+N más»', () => {
    const m = buildWeekImageModel(week([{ dinner: slot(r('Sopa'), r('Tortilla'), r('Ensalada'), r('Pan')) }]), THU)!
    const cell = m.rows[0].cells[0]
    expect(cell.dishes.map((d) => d.name)).toEqual(['Sopa', 'Tortilla'])
    expect(cell.more).toBe(2)
  })

  it('notes have no photo; leftovers and freezer dishes say so', () => {
    const m = buildWeekImageModel(
      week([{ lunch: slot(note('Comida fuera')), dinner: slot(r('Lentejas', { variant: 'leftover' })) }, { dinner: slot(r('Cocido', { variant: 'freezer' })) }]),
      THU,
    )!
    expect(m.rows[0].cells[0].dishes[0]).toEqual({ name: 'Comida fuera', recipeId: null })
    expect(m.rows[0].cells[1].dishes[0]).toEqual({ name: 'Lentejas (sobras)', recipeId: 'id-Lentejas' })
    expect(m.rows[1].cells[1].dishes[0].name).toBe('Cocido (del congelador)')
  })

  it('drops emoji from names (the fonts have none) and empty notes', () => {
    expect(stripEmoji('Pizza 🍕 casera')).toBe('Pizza casera')
    const m = buildWeekImageModel(week([{ lunch: slot(note('🍕'), note('Pizza 🍕')) }]), THU)!
    expect(m.rows[0].cells[0].dishes.map((d) => d.name)).toEqual(['Pizza'])
  })

  it('a day without one of the meals keeps an empty cell in that column', () => {
    const m = buildWeekImageModel(week([{ lunch: slot(r('Paella')), dinner: slot(r('Sopa')) }, { dinner: slot(r('Tortilla')) }]), THU)!
    expect(m.rows[1].kind).toBe('menu')
    expect(m.rows[1].cells[0].dishes).toEqual([])
    expect(m.rows[1].cells[1].dishes[0].name).toBe('Tortilla')
  })

  it('photos: the first dish of each cell, once per recipe, never notes', () => {
    const m = buildWeekImageModel(
      week([{ lunch: slot(r('Paella'), r('Ensalada')), dinner: slot(note('Fuera')) }, { lunch: slot(r('Paella')) }]),
      THU,
    )!
    expect(photoRecipeIds(m)).toEqual(['id-Paella'])
  })
})

describe('buildWeekImageModel — rows', () => {
  it('seven rows with short day names and dates; today flagged, earlier days past (Europe/Madrid date)', () => {
    const m = buildWeekImageModel(week(LUIS), THU)!
    expect(m.rows.map((x) => `${x.dayShort} ${x.dateLabel}`)).toEqual([
      'Lun 12 oct', 'Mar 13 oct', 'Mié 14 oct', 'Jue 15 oct', 'Vie 16 oct', 'Sáb 17 oct', 'Dom 18 oct',
    ])
    expect(m.rows.map((x) => x.isToday)).toEqual([false, false, false, true, false, false, false])
    expect(m.rows.map((x) => x.isPast)).toEqual([true, true, true, false, false, false, false])
  })

  it('a week that has not started: no today, nothing past', () => {
    const m = buildWeekImageModel({ weekStart: '2026-10-19', days: LUIS }, THU)!
    expect(m.rows.some((x) => x.isToday || x.isPast)).toBe(false)
    expect(m.subtitle.startsWith('Del 19 al 25 de octubre')).toBe(true)
  })

  it('a week across two months', () => {
    const m = buildWeekImageModel({ weekStart: '2026-09-28', days: LUIS }, THU)!
    expect(m.rows[6].dateLabel).toBe('4 oct')
    expect(m.subtitle.startsWith('Del 28 de septiembre al 4 de octubre')).toBe(true)
  })

  it('skipped days read «Sin cocinar»; days with nothing are empty rows', () => {
    const days = [...LUIS]
    days[2] = {}
    days[6] = null as any
    days[5] = {}
    const m = buildWeekImageModel(week(days, [4]), THU)!
    const rowOf = (i: number) => m.rows.find((x) => x.dayIndex === i)
    expect(rowOf(4)).toMatchObject({ kind: 'skipped', cells: [] })
    expect(rowOf(5)).toMatchObject({ kind: 'empty', cells: [] })
    expect(rowOf(6)?.kind).toBe('empty')
    expect(rowOf(0)?.kind).toBe('menu')
  })

  it('a day already gone with nothing on it is left out: a first menu made mid-week starts today (PRO-244)', () => {
    // Sign-up on Thursday: Monday to Wednesday were not generated.
    const days = [{}, {}, {}, ...LUIS.slice(3)]
    const m = buildWeekImageModel(week(days), THU)!
    expect(m.rows.map((x) => x.dayShort)).toEqual(['Jue', 'Vie', 'Sáb', 'Dom'])
    expect(m.rows[0].isToday).toBe(true)
    // A past day that does have dishes stays (faded).
    const full = buildWeekImageModel(week(LUIS), THU)!
    expect(full.rows).toHaveLength(7)
  })

  it('a skipped day does not add columns of its own', () => {
    const days = [{ lunch: slot(r('Paella')) }, { breakfast: slot(r('Tostadas')) }]
    const m = buildWeekImageModel(week(days, [1]), THU)!
    expect(m.columns.map((c) => c.meal)).toEqual(['lunch'])
  })

  it('null when there is nothing to draw', () => {
    expect(buildWeekImageModel(week([]), THU)).toBeNull()
    expect(buildWeekImageModel(week([{}, { lunch: slot() }]), THU)).toBeNull()
    expect(buildWeekImageModel({ weekStart: '2026-10-12', days: null }, THU)).toBeNull()
  })

  it('a week where every day is skipped still draws (the rows say «Sin cocinar»)', () => {
    const m = buildWeekImageModel(week([], [0, 1, 2, 3, 4, 5, 6]), THU)!
    expect(m.columns).toEqual([])
    expect(m.rows.every((x) => x.kind === 'skipped')).toBe(true)
  })
})

describe('weekMenuCaption — the text that goes with the image', () => {
  it("is the digest's opener, link and invite, without the day blocks (Luis's case)", () => {
    const caption = weekMenuCaption(week(LUIS), { today: '2026-10-15', webUrl: 'https://mimoia.com' })
    expect(caption).toBe(
      'Listo: tu menú hasta el domingo 🍽️\n📖 Recetas y lista de la compra: mimoia.com/menu\n¿Cambio algo? Dímelo, p. ej. «el sábado, pescado».',
    )
    const digest = weekMenuDigest(week(LUIS), { today: '2026-10-15', webUrl: 'https://mimoia.com' })
    for (const line of caption.split('\n')) expect(digest).toContain(line)
  })

  it('a week that has not started names its dates', () => {
    const caption = weekMenuCaption({ weekStart: '2026-10-19', days: LUIS }, { today: '2026-10-15', webUrl: 'https://mimoia.com' })
    expect(caption.split('\n')[0]).toBe('Listo: tu menú de la semana del 19 al 25 de octubre 🍽️')
  })

  it('stays far below WhatsApp’s 1024-character caption limit', () => {
    expect(weekMenuCaption(week(LUIS), { today: '2026-10-15', webUrl: 'https://www.mimoia.com' }).length).toBeLessThan(300)
  })
})
