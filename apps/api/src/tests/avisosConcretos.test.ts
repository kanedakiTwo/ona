/**
 * PRO-1337 (D-1029) · Avisos con el plato y una acción corta.
 *
 * Los cuatro avisos que Mimo manda solo (la semana hecha del jueves, ¿toca
 * compra?, ¿hiciste la cena? y el del domingo) nombran lo concreto del hogar
 * —un plato o un día real, nunca «tu menú»— y terminan en una sola acción de
 * un toque: una pregunta que contestan los botones, o un enlace.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, it, expect } from 'vitest'
import { autoplanHighlightLine, autoplanHighlightOf } from '@ona/shared'
import { planProactive, type MadridParts, type ProactiveInput } from '../services/whatsapp/proactive.js'
import { validateGuided } from '../services/whatsapp/guided.js'

const WEB = 'https://ona.test'
const URLS = /https?:\/\/\S+/g
const parts = (over: Partial<MadridParts>): MadridParts => ({ isoDate: '2026-10-11', weekday: 6, hour: 19, minute: 0, ...over })

const base: ProactiveInput = {
  parts: parts({}),
  breakfastTime: null,
  dinnerTime: '20:00',
  prefs: {},
  sentRecently: {},
  todayDay: async () => null,
  todayDinner: async () => ({ names: ['Merluza en salsa verde'], recipeIds: ['r-merluza'], totalMinutes: 30 }),
  cookedToday: async () => false,
  pendingShopping: async () => [
    { name: 'merluza', aisle: 'proteinas' },
    { name: 'calabacín', aisle: 'produce' },
    { name: 'arroz', aisle: 'despensa' },
  ],
  hasNextWeekMenu: async () => false,
  webUrl: WEB,
}

const textOf = (m: { messages: Array<{ type: string; text?: string }> }) => m.messages[0].text ?? ''
const questions = (t: string) => (t.match(/\?/g) ?? []).length

describe('la semana hecha del jueves: un plato real y un solo botón', () => {
  const r = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ kind: 'recipe', recipeId: id, recipeName: name, ...extra })
  const week = [
    { dinner: { dishes: [r('a', 'Tortilla de patatas')] } },
    { lunch: { dishes: [r('b', 'Lentejas estofadas')] }, dinner: { dishes: [r('c', 'Flan de huevo', { course: 'dessert' }), r('d', 'Crema de calabaza')] } },
    { dinner: { dishes: [r('d', 'Crema de calabaza', { variant: 'leftover' })] } },
  ]

  it('nombra la primera cena de un día que se cocina (ni día saltado, ni postre, ni sobras)', () => {
    const h = autoplanHighlightOf(week, [0])
    expect(h).toEqual({ day: 1, meal: 'dinner', recipeId: 'd', name: 'Crema de calabaza' })
    expect(autoplanHighlightLine(h)).toBe('El martes cenáis Crema de calabaza.')
    expect(autoplanHighlightLine({ day: 0, meal: 'lunch', recipeId: 'b', name: 'Lentejas estofadas' })).toBe('El lunes coméis Lentejas estofadas.')
  })

  it('sin plato no inventa nada', () => {
    expect(autoplanHighlightOf([{ dinner: { dishes: [r('d', 'Sobras', { variant: 'leftover' })] } }])).toBeNull()
    expect(autoplanHighlightLine({ day: 0, meal: 'dinner', recipeId: 'x' })).toBeNull()
  })

  it('la tarjeta lleva el plato y una sola acción («Ver la semana, es un momento», o en su semana «Ver la lista»)', () => {
    const card = readFileSync(resolve(__dirname, '../../../web/src/components/menu/AutoplanCard.tsx'), 'utf8')
    expect(card).toContain('autoplanHighlightLine(kept.highlight)')
    expect(card).toContain('Ver la semana, es un momento')
    expect(card).toMatch(/onItsWeek \?[\s\S]*Ver la lista[\s\S]*: \([\s\S]*Ver la semana, es un momento/)
    expect(card).not.toContain('Cambiar algo')
    expect(card).not.toContain('autoplan-open-week')
  })
})

describe('¿toca compra?: el día y lo fresco, y un solo enlace sin preguntas', () => {
  it('el sábado (por defecto)', async () => {
    const [m] = await planProactive({ ...base, parts: parts({ weekday: 5, hour: 10 }) })
    const t = textOf(m)
    expect(m.kind).toBe('shopping_reminder')
    expect(t).toContain('sábado')
    expect(t).toContain('merluza, calabacín')
    expect(t).not.toMatch(/tu menú/i)
    expect(questions(t)).toBe(0)
    expect(t.match(URLS)).toEqual([`${WEB}/shopping`])
    expect(t).toMatch(/es un momento: https:\/\/ona\.test\/shopping$/)
    expect(m.guide?.required).toEqual(expect.arrayContaining(['sábado', 'merluza', 'calabacín', `${WEB}/shopping`]))
  })

  it('el día que el hogar suele comprar', async () => {
    const [m] = await planProactive({ ...base, parts: parts({ weekday: 1, hour: 18 }), shoppingUse: { usedRecently: true, day: 1, hour: 18 } })
    expect(textOf(m)).toContain('Hoy, martes, toca compra.')
  })

  it('un texto escrito con una pregunta sale como el fijo', async () => {
    const [m] = await planProactive({ ...base, parts: parts({ weekday: 5, hour: 10 }) })
    const ok = `Hoy es sábado: de lo fresco te faltan merluza y calabacín. La lista, en un toque: ${WEB}/shopping`
    expect(validateGuided(ok, m.guide!, textOf(m))).toEqual({ ok: true })
    expect(validateGuided(`¿Vas hoy, sábado? Te faltan merluza y calabacín. ${WEB}/shopping`, m.guide!, textOf(m))).toEqual({ ok: false, reason: 'question' })
  })
})

describe('¿hiciste la cena?: el plato y una sola pregunta al final', () => {
  it('nombra la cena de hoy y acaba en la pregunta que responden los botones', async () => {
    const [m] = await planProactive({ ...base, parts: parts({ weekday: 2, hour: 22, minute: 10 }) })
    const t = textOf(m)
    expect(m.kind).toBe('dinner_checkin')
    expect(t).toContain('*Merluza en salsa verde*')
    expect(questions(t)).toBe(1)
    expect(t.trim().endsWith('?')).toBe(true)
    expect(t).toMatch(/un toque/i)
    expect(m.messages[0].type).toBe('buttons')
  })
})

describe('el domingo: la semana por su lunes y una sola pregunta', () => {
  const sunday = { ...base, prefs: { weekly_autoplan: false }, dinnerTime: '23:59', parts: parts({ weekday: 6, hour: 19 }) }

  it('nombra el lunes de la semana que viene y pregunta una sola cosa, con los botones', async () => {
    const [m] = await planProactive(sunday)
    const t = textOf(m)
    expect(m.kind).toBe('weekly_nudge')
    expect(t).toContain('La semana del lunes 12 de octubre')
    expect(t).not.toMatch(/tu menú/i)
    expect(questions(t)).toBe(1)
    expect(t.trim()).toMatch(/¿Te la preparo\? Es un momento\.$/)
    expect(m.messages[0].type === 'buttons' && m.messages[0].buttons.map((b) => b.title)).toEqual(['Sí, prepáralo', 'Ahora no'])
  })

  it('un texto escrito con varias preguntas sale como el fijo', async () => {
    const [m] = await planProactive(sunday)
    const hint = m.guide!.required[1]
    expect(validateGuided(`Para la semana del lunes 12, ${hint} ¿Te la dejo hecha?`, m.guide!, textOf(m))).toEqual({ ok: true })
    expect(validateGuided(`Semana del lunes 12. ${hint} ¿Viene alguien? ¿Te la preparo?`, m.guide!, textOf(m))).toEqual({ ok: false, reason: 'too_many_questions' })
  })
})
