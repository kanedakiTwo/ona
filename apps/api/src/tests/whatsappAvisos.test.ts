/**
 * 19-nov (136 avisos from 28-oct to 18-nov, 13 % answered): the pure pieces
 * of the avisos rework — «hora de cocinar» only for long dishes and with two
 * buttons, «¿qué tal la cena?» never about a dessert, the shopping reminder
 * without «quedan N cosas», only to households that use the list and on their
 * day, and the person's language. The pause after unanswered avisos is
 * avisosPausa.test.ts (PRO-1303).
 */
import { describe, expect, it } from 'vitest'
import {
  COOKING_BUTTONS,
  cookingReminderGuide,
  formatShoppingReminder,
  freshPending,
  isCookingReminderWindow,
  isDessert,
  isShoppingReminderWindow,
  madridParts,
  planProactive,
  shoppingUseFrom,
  todayDinnerOf,
  withoutMimoButtonAvisos,
  type MadridParts,
  type PlannedMessage,
} from '../services/whatsapp/proactive.js'
import { checkinAnswerOf, checkinConfirmation, ratingToSave } from '../services/whatsapp/checkinButtons.js'
import { detectLanguage } from '../services/whatsapp/language.js'
import { guideInLanguage, guidedSystemPrompt } from '../services/whatsapp/guided.js'
import { optOutReasonOf, optOutWithReason } from '../services/whatsapp/optOutReason.js'

const WEB = 'https://mimoia.test'
const parts = (o: Partial<MadridParts>): MadridParts => ({ isoDate: '2026-11-17', weekday: 1, hour: 12, minute: 0, ...o })

describe('«hora de cocinar» (point 1)', () => {
  it('only for dishes of more than 45 min', () => {
    // Dinner 21:00, 45 min → start 20:05; the window is around it.
    expect(isCookingReminderWindow(parts({ hour: 20, minute: 5 }), '21:00', 45)).toBe(false)
    expect(isCookingReminderWindow(parts({ hour: 20, minute: 0 }), '21:00', 50)).toBe(true)
  })

  it('two buttons that fit WhatsApp (≤ 20 chars), and the writer knows them', () => {
    expect(COOKING_BUTTONS.map((b) => b.id)).toEqual(['cooking:ok', 'cooking:swap'])
    for (const b of COOKING_BUTTONS) expect([...b.title].length).toBeLessThanOrEqual(20)
    expect(cookingReminderGuide('Lasaña', 80, '21:30', { hour: 19, minute: 56 }).facts.join(' ')).toContain('«Cambia a algo rápido»')
  })

  it('with the cap used up it still goes, without «Cambia a algo rápido» (that one needs Mimo)', () => {
    const p: PlannedMessage = { kind: 'cooking_reminder', messages: [{ type: 'buttons', text: 'x', buttons: COOKING_BUTTONS.map((b) => ({ ...b })) }] }
    const [out] = withoutMimoButtonAvisos([p], true)
    expect(out.messages[0].type === 'buttons' && out.messages[0].buttons.map((b) => b.id)).toEqual(['cooking:ok'])
  })
})

describe('«¿qué tal la cena?» (point 2)', () => {
  it('👍 / 👎 / «No la hice» are recorded without the model', () => {
    expect(checkinAnswerOf('checkin:up')).toEqual({ cooked: true, rating: 4 })
    expect(checkinAnswerOf('checkin:down')).toEqual({ cooked: true, rating: 1 })
    expect(checkinAnswerOf('checkin:no')).toEqual({ cooked: false, rating: null })
    expect(checkinConfirmation({ cooked: true, rating: 1 }, 'Lasaña')).toBe('Apuntada la cena: *Lasaña*. No la vuelvo a poner sola en el menú.')
  })

  it('a 👍 never lowers a 5 nor rewrites the same rating', () => {
    expect(ratingToSave(5, 4)).toBeNull()
    expect(ratingToSave(4, 4)).toBeNull()
    expect(ratingToSave(null, 4)).toBe(4)
    expect(ratingToSave(1, 4)).toBe(4)
    expect(ratingToSave(5, 1)).toBe(1)
  })

  it('never about a dessert: the dinner is the savoury dishes', () => {
    const rows = [
      { id: 'm', totalTime: 30, prepTime: null, cookTime: null, course: 'main', tags: [], dishTypes: [] },
      { id: 'f', totalTime: 240, prepTime: null, cookTime: null, course: 'dessert', tags: ['postre'], dishTypes: [] },
    ]
    const dishes = [
      { kind: 'recipe', recipeId: 'f', recipeName: 'Flan de huevo' },
      { kind: 'recipe', recipeId: 'm', recipeName: 'Merluza en salsa' },
    ]
    expect(todayDinnerOf(dishes, rows, 'menu-1')).toEqual({ names: ['Merluza en salsa'], recipeIds: ['m'], totalMinutes: 30, menuId: 'menu-1' })
    expect(todayDinnerOf([dishes[0]], rows)).toBeNull()
    expect(isDessert({ tags: ['Dulce'] })).toBe(true)
    expect(isDessert({ dishTypes: ['dulce-finde'] })).toBe(true)
    expect(isDessert({ course: 'main', tags: ['pescado'] })).toBe(false)
  })
})

describe('compra (point 3)', () => {
  const DAY = 24 * 60 * 60 * 1000
  const NOW = new Date('2026-11-21T09:00:00Z') // Saturday 10:00 Madrid

  it('no «quedan N cosas» and no alphabetical list: the link and at most 5 fresh things', () => {
    const items = ['ajo', 'albahaca', 'apio', 'berenjena', 'calabacín', 'merluza'].map((name) => ({ name, aisle: 'produce' }))
    const fresh = freshPending([...items, { name: 'arroz', aisle: 'despensa' }])
    expect(fresh).toHaveLength(5)
    expect(fresh).not.toContain('arroz')
    const text = formatShoppingReminder(fresh, WEB)
    expect(text).not.toMatch(/\d+\s+cosas|quedan|faltan \d/i)
    expect(text).toContain(`${WEB}/shopping`)
  })

  it('only to households that ticked the list in the last 14 days', async () => {
    const unused = shoppingUseFrom([new Date(NOW.getTime() - 20 * DAY)], NOW, madridParts)
    expect(unused.usedRecently).toBe(false)
    const base = {
      parts: madridParts(NOW), breakfastTime: null, dinnerTime: '21:00', prefs: {}, sentRecently: {},
      todayDay: async () => null, todayDinner: async () => null, cookedToday: async () => false, hasNextWeekMenu: async () => true,
      pendingShopping: async () => [{ name: 'tomates', aisle: 'produce' }, { name: 'leche', aisle: 'lacteos' }, { name: 'pan', aisle: 'panaderia' }],
      webUrl: WEB,
    }
    expect(await planProactive({ ...base, shoppingUse: unused })).toEqual([])
    const used = { usedRecently: true, day: null, hour: null }
    expect((await planProactive({ ...base, shoppingUse: used })).map((p) => p.kind)).toEqual(['shopping_reminder'])
  })

  it('on the day the household shops, an hour before it usually starts; else Saturday 10:00', () => {
    // Three Thursdays ticking from ~18:00 Madrid (17:00Z in November).
    const thursdays = [5, 12, 19].map((d) => new Date(`2026-11-${String(d).padStart(2, '0')}T17:10:00Z`))
    const use = shoppingUseFrom(thursdays, new Date('2026-11-20T09:00:00Z'), madridParts)
    expect(use).toEqual({ usedRecently: true, day: 3, hour: 17 })
    expect(isShoppingReminderWindow(parts({ weekday: 3, hour: 17 }), use)).toBe(true)
    expect(isShoppingReminderWindow(parts({ weekday: 5, hour: 10 }), use)).toBe(false)
    // One day only: no habit → Saturday as before.
    const once = shoppingUseFrom([thursdays[2]], new Date('2026-11-20T09:00:00Z'), madridParts)
    expect(once).toEqual({ usedRecently: true, day: null, hour: null })
    expect(isShoppingReminderWindow(parts({ weekday: 5, hour: 10 }), once)).toBe(true)
  })
})

describe('idioma (point 6)', () => {
  it('a household that writes in English gets English; short taps and Spanish stay Spanish', () => {
    expect(detectLanguage(["What's for dinner tonight?", 'Can you swap Thursday for something with chicken please'])).toBe('en')
    expect(detectLanguage(['¿Qué cenamos hoy?', 'Cámbiame el jueves por algo con pollo'])).toBe('es')
    expect(detectLanguage(['Sí, hecho', 'ok'])).toBe('es')
  })

  it('the avisos come out in English: fixed text, buttons and the writer', async () => {
    const r = await planProactive({
      parts: parts({ weekday: 1, hour: 22, minute: 10 }), breakfastTime: null, dinnerTime: '20:00', prefs: {}, sentRecently: {},
      todayDay: async () => null, todayDinner: async () => ({ names: ['Merluza en salsa'], recipeIds: ['m'], totalMinutes: 30 }),
      cookedToday: async () => false, pendingShopping: async () => [], hasNextWeekMenu: async () => true, webUrl: WEB,
      language: async () => 'en',
    })
    expect(r).toHaveLength(1)
    const m = r[0].messages[0]
    expect(m.text).toBe("How did tonight's dinner go (*Merluza en salsa*)? I'll note it down.")
    expect(m.type === 'buttons' && m.buttons.map((b) => b.title)).toEqual(['👍', '👎', "Didn't make it"])
    expect(r[0].guide?.language).toBe('en')
    expect(guidedSystemPrompt('dinner_checkin', 'en')).toContain('en inglés')
  })

  it('an aviso without an English text is written in English, keeping only the data it must carry', () => {
    const spec = { kind: 'weekly_nudge' as const, facts: [], required: ['¿Viene alguien?', `${WEB}/menu`, 'Lentejas'], dishes: ['Lentejas'] }
    expect(guideInLanguage(spec, 'en')).toMatchObject({ language: 'en', required: [`${WEB}/menu`, 'Lentejas'] })
    expect(guideInLanguage(spec, 'es')).toBe(spec)
  })
})

describe('BAJA (point 8)', () => {
  it('the three reasons, as buttons under the confirmation', () => {
    const m = optOutWithReason('Hecho.', 'es')
    expect(m.type === 'buttons' && m.buttons.map((b) => b.id)).toEqual(['baja:demasiados', 'baja:no_sirven', 'baja:otra'])
    for (const b of m.type === 'buttons' ? m.buttons : []) expect([...b.title].length).toBeLessThanOrEqual(20)
    expect(optOutReasonOf('baja:no_sirven')).toBe('no_sirven')
    expect(optOutReasonOf('baja:x')).toBeNull()
  })
})
