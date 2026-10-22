/**
 * The week on WhatsApp after the first real feedback (Miguel, 2026-10-15):
 *   1. the model's «Menú de la semana (que viene) listo …» line never stacks
 *      on top of the caption's «Listo: …», in any of its shapes;
 *   2. asking to SEE the week (get_weekly_menu) sends the same picture with a
 *      «Tu menú …» caption instead of the model's long list + recipe links;
 *   3. the household's first 3 generated weeks carry the «efecto bola de
 *      nieve» line above «Listo: …».
 */
import { describe, it, expect, vi } from 'vitest'
import { replyMessages, weekViewOf, withoutMenuReadyLines, WEEK_IMAGE_ALT, type InboundDeps } from '../services/whatsapp/inbound.js'
import { SNOWBALL_LINE, SNOWBALL_WEEKS, generatedMenuThisTurn, showsSnowball, weekMenuCaption, weekMenuDigest, withSnowballLine, type WeekMenuInput } from '../services/menuText.js'
import type { AssistantResponse } from '../services/assistant/types.js'

const WEB = 'https://mimoia.com'
const THU = '2026-10-15'
const r = (id: string, recipeName: string) => ({ kind: 'recipe' as const, recipeId: id, recipeName })
const slot = (...dishes: ReturnType<typeof r>[]) => ({ dishes })
const FULL = Array.from({ length: 7 }, (_, i) => ({ lunch: slot(r(`l${i}`, `Comida ${i}`)), dinner: slot(r(`d${i}`, `Cena ${i}`)) }))
const THIS_WEEK: WeekMenuInput = { weekStart: '2026-10-12', days: FULL }
const NEXT_WEEK: WeekMenuInput = { weekStart: '2026-10-19', days: FULL }
const JPEG = Buffer.from('fake-jpeg')

describe('withoutMenuReadyLines — the model\'s «menú listo» in every shape', () => {
  const gone: string[] = [
    // The real production reply of 2026-10-15:
    'Hecho:\n- Menú de la semana que viene listo (semana del 19 de octubre)',
    'Hecho:\n- Tu primer menú de la semana listo',
    'Hecho:\n- Menu de la semana listo',
    'Hecho: menú de la semana listo.',
    'Hecho:\n• Menú de la semana listo',
    'Hecho:\n- *Menú de la semana que viene listo*',
    '*Hecho:*\n- Menú de esta semana listo',
    'Tu menú de la semana está listo.',
    'Tu menú de la semana ya está listo 🍽️',
    'Tu primer menú de esta semana está listo.',
    'Hecho:\n- Menú para la semana del 19 de octubre listo',
    'Hecho:\n- Menú de la semana del 19 al 25 de octubre generado',
    'Hecho:\n- Menú de la próxima semana listo',
    'Hecho:\n- MENÚ DE LA SEMANA QUE VIENE LISTO',
    'Hecho:\n- Menú de la semana que viene listo (del 19 al 25 de octubre).',
    'Hecho:\n- Menú semanal generado',
    'Listo: tu menú de la semana que viene',
    'Listo, tu menú de esta semana 🍽️',
    'Menú listo.',
    'Hecho:\n\n- Menú de la semana que viene listo (semana del 19 de octubre)\n',
  ]
  it.each(gone)('drops %j entirely', (message) => {
    expect(withoutMenuReadyLines(message)).toBe('')
  })

  const kept: Array<[string, string]> = [
    // Another change of the same turn stays, under its «Hecho:».
    ['Hecho:\n- Menú de la semana que viene listo (semana del 19 de octubre)\n- Sábado 24, cena: comemos fuera',
      'Hecho:\n- Sábado 24, cena: comemos fuera'],
    ['Hecho:\n• Tu primer menú de la semana está listo\n• Jueves 15, comida: Entrecot',
      'Hecho:\n• Jueves 15, comida: Entrecot'],
    // A warning stays; the «Hecho:» left with nothing under it goes.
    ['Hecho:\n- Menú de la semana listo\n\nNo había dorada; he puesto lubina.', 'No había dorada; he puesto lubina.'],
    ['Hecho:\n- Menú de la semana que viene listo (semana del 19 de octubre)\n\nOjo: el lunes no hay nada descongelado.',
      'Ojo: el lunes no hay nada descongelado.'],
    // Lines that only mention the menu are not «menú listo».
    ['Ojo: no queda pescado en el catálogo para el viernes.', 'Ojo: no queda pescado en el catálogo para el viernes.'],
    ['He tenido en cuenta que el menú de la semana no lleve cerdo.', 'He tenido en cuenta que el menú de la semana no lleve cerdo.'],
    ['¿Te preparo la lista de la compra?\n[[opciones: Sí | No]]', '¿Te preparo la lista de la compra?\n[[opciones: Sí | No]]'],
  ]
  it.each(kept)('keeps what else the model says in %j', (message, expected) => {
    expect(withoutMenuReadyLines(message)).toBe(expected)
  })
})

describe('captions (Thursday 15 October 2026)', () => {
  it('generated week 1–2: the snowball line above «Listo: …»', () => {
    for (const generatedWeeks of [1, 2]) {
      expect(weekMenuCaption(NEXT_WEEK, { today: THU, webUrl: WEB, view: 'generated', generatedWeeks })).toBe(
        `${SNOWBALL_LINE}\n\nListo: tu menú de la semana del 19 al 25 de octubre 🍽️\n📖 Recetas y lista de la compra: mimoia.com/menu\n¿Cambio algo? Dímelo, p. ej. «el martes, pescado».`,
      )
    }
    // PRO-170: Marketing's version A, approved 2026-10-17, for the first 2 weeks.
    expect(SNOWBALL_LINE).toBe('Las primeras semanas acertaré menos con los gustos de tu casa. Dime qué cambiarías y lo apunto: así iré acertando cada vez más. Es el efecto bola de nieve ⛄')
    expect(SNOWBALL_WEEKS).toBe(2)
  })

  it('generated week 3 and later (or unknown count): no snowball line', () => {
    for (const generatedWeeks of [3, 4, 20, undefined]) {
      expect(weekMenuCaption(NEXT_WEEK, { today: THU, webUrl: WEB, view: 'generated', generatedWeeks })).toBe(
        'Listo: tu menú de la semana del 19 al 25 de octubre 🍽️\n📖 Recetas y lista de la compra: mimoia.com/menu\n¿Cambio algo? Dímelo, p. ej. «el martes, pescado».',
      )
    }
  })

  it('the text fallback of a generated week 1–2 carries the snowball line too, first', () => {
    const digest = weekMenuDigest(NEXT_WEEK, { today: THU, webUrl: WEB, view: 'generated', generatedWeeks: 2 })
    expect(digest.startsWith(`${SNOWBALL_LINE}\n\nListo: tu menú de la semana del 19 al 25 de octubre 🍽️\n\n*Lunes 19*`)).toBe(true)
    expect(weekMenuDigest(NEXT_WEEK, { today: THU, webUrl: WEB, view: 'generated', generatedWeeks: 3 })).not.toContain('bola de nieve')
  })

  it('viewing this week: «Tu menú de esta semana», never «Listo:» nor the snowball line', () => {
    const caption = weekMenuCaption(THIS_WEEK, { today: THU, webUrl: WEB, view: 'viewing', generatedWeeks: 1 })
    expect(caption).toBe(
      'Tu menú de esta semana 🍽️\n📖 Recetas y lista de la compra: mimoia.com/menu\n¿Cambio algo? Dímelo, p. ej. «el sábado, pescado».',
    )
  })

  it('viewing another week names it', () => {
    expect(weekMenuCaption(NEXT_WEEK, { today: THU, webUrl: WEB, view: 'viewing' }).split('\n')[0]).toBe(
      'Tu menú de la semana del 19 al 25 de octubre 🍽️',
    )
    const digest = weekMenuDigest(THIS_WEEK, { today: THU, webUrl: WEB, view: 'viewing' })
    expect(digest.startsWith('Tu menú de esta semana 🍽️\n\n*Jueves 15 · hoy*')).toBe(true)
  })

  it('showsSnowball: only generated weeks 1–2', () => {
    expect(showsSnowball({ view: 'generated', generatedWeeks: 1 })).toBe(true)
    expect(showsSnowball({ generatedWeeks: 2 })).toBe(true)
    expect(showsSnowball({ view: 'generated', generatedWeeks: 3 })).toBe(false)
    expect(showsSnowball({ view: 'generated', generatedWeeks: 0 })).toBe(false)
    expect(showsSnowball({ view: 'viewing', generatedWeeks: 1 })).toBe(false)
  })
})

describe('replyMessages — viewing the week sends the picture', () => {
  const viewingCaption = weekMenuCaption(THIS_WEEK, { today: THU, webUrl: WEB, view: 'viewing' })
  const viewingDigest = weekMenuDigest(THIS_WEEK, { today: THU, webUrl: WEB, view: 'viewing' })
  // What the model wrote in production: its own day-by-day list.
  const LONG_LIST = 'Tu menú de esta semana:\n\n*Jueves 15*\n- Comida: Comida 3\n- Cena: Cena 3\n\n*Viernes 16*\n- Comida: Comida 4\n- Cena: Cena 4'
  const read = (extra: Partial<AssistantResponse> = {}): AssistantResponse => ({
    message: LONG_LIST,
    actionTaken: true,
    uiHint: 'menu',
    data: { menuId: 'm-1', weekStart: '2026-10-12', days: FULL, skippedDays: [] },
    toolsUsed: ['get_weekly_menu'],
    ...extra,
  })
  const deps = (over: Partial<Pick<InboundDeps, 'menuDigest' | 'menuImage'>> = {}) => {
    const menuDigest = vi.fn<NonNullable<InboundDeps['menuDigest']>>(async () => viewingDigest)
    const menuImage = vi.fn<NonNullable<InboundDeps['menuImage']>>(async () => ({ jpeg: JPEG, caption: viewingCaption }))
    return { webUrl: WEB, menuDigest, menuImage, ...over }
  }

  it('one picture with «Tu menú de esta semana», no model list, no recipe links, no «Ver menú»', async () => {
    const d = deps()
    const out = await replyMessages(read(), 'user-1', d, null)
    expect(d.menuImage).toHaveBeenCalledWith('user-1', 'm-1', 'viewing')
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: 'image', image: JPEG, mimeType: 'image/jpeg', alt: WEEK_IMAGE_ALT, text: viewingCaption })
    const text = out[0].text
    expect(text).not.toMatch(/Listo|Comida 3|Ver menú|\/recipes\//)
    expect(text.match(/\/menu/g)).toHaveLength(1)
    // If the picture's upload fails later, the text digest goes out.
    expect(out[0].type === 'image' && out[0].fallback).toEqual([{ type: 'text', text: viewingDigest }])
  })

  it('drawing the picture throws → the full text digest instead of the model\'s list', async () => {
    const d = deps({ menuImage: vi.fn(async () => { throw new Error('satori exploded') }) })
    const out = await replyMessages(read(), 'user-1', d, null)
    expect(out).toEqual([{ type: 'text', text: viewingDigest }])
  })

  it('nothing to draw (null) → the model\'s words, as before', async () => {
    const d = deps({ menuImage: vi.fn(async () => null) })
    const out = await replyMessages(read({ message: 'Esta semana solo tienes el jueves planificado.' }), 'user-1', d, null)
    expect(out.map((m) => m.type)).toEqual(['text'])
    expect(out[0].text).toContain('Esta semana solo tienes el jueves planificado.')
  })

  it('a week with nothing planned (the tool answers without menu data) is not a week view', async () => {
    const response = read({ message: 'La semana del 19 no tiene nada planificado todavía.', uiHint: 'text', data: null })
    expect(weekViewOf(response)).toBeNull()
    const d = deps()
    const out = await replyMessages(response, 'user-1', d, null)
    expect(d.menuImage).not.toHaveBeenCalled()
    expect(out).toEqual([{ type: 'text', text: 'La semana del 19 no tiene nada planificado todavía.' }])
  })

  it('a change made in the same turn stays above the caption', async () => {
    const d = deps()
    const response = read({ message: 'Hecho:\n- Martes 20, comida: Merluza al horno', toolsUsed: ['swap_meal', 'get_weekly_menu'] })
    const out = await replyMessages(response, 'user-1', d, null)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(`Hecho:\n- Martes 20, comida: Merluza al horno\n\n${viewingCaption}`)
  })

  it('one-day reads stay text with their recipe links (no picture, no digest)', async () => {
    const d = deps()
    const day = { lunch: slot(r('l3', 'Lentejas')), dinner: slot(r('d3', 'Crema')) }
    const response: AssistantResponse = {
      message: 'Hoy toca:\n- Comida: Lentejas\n- Cena: Crema',
      actionTaken: true,
      uiHint: 'menu',
      data: { dayIndex: 3, date: THU, weekStart: '2026-10-12', menuId: 'm-1', day },
      toolsUsed: ['get_todays_menu'],
    }
    expect(weekViewOf(response)).toBeNull()
    const out = await replyMessages(response, 'user-1', d, null)
    expect(d.menuImage).not.toHaveBeenCalled()
    expect(d.menuDigest).not.toHaveBeenCalled()
    expect(out).toEqual([
      {
        type: 'text',
        text: `Hoy toca:\n- Comida: Lentejas\n- Cena: Crema\n\n→ Lentejas: mimoia.com/recipes/l3\n→ Crema: mimoia.com/recipes/d3\nVer menú: ${WEB}/menu`,
      },
    ])
  })
})

describe('replyMessages — a generated week asks for its caption as «generated»', () => {
  it('passes the view, and the production reply loses its «Hecho: - Menú … listo (…)» on top', async () => {
    const caption = weekMenuCaption(NEXT_WEEK, { today: THU, webUrl: WEB, view: 'generated', generatedWeeks: 1 })
    const menuImage = vi.fn<NonNullable<InboundDeps['menuImage']>>(async () => ({ jpeg: JPEG, caption }))
    const menuDigest = vi.fn<NonNullable<InboundDeps['menuDigest']>>(async () => 'digest')
    const out = await replyMessages(
      {
        message: 'Hecho:\n- Menú de la semana que viene listo (semana del 19 de octubre)',
        actionTaken: true,
        uiHint: 'menu',
        data: { id: 'm-2', days: [] },
        toolsUsed: ['generate_weekly_menu'],
      },
      'user-1',
      { webUrl: WEB, menuDigest, menuImage },
      null,
    )
    expect(menuImage).toHaveBeenCalledWith('user-1', 'm-2', 'generated')
    expect(menuDigest).toHaveBeenCalledWith('user-1', 'm-2', 'generated')
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe(caption)
    expect(out[0].text.startsWith(SNOWBALL_LINE)).toBe(true)
    expect(out[0].text).not.toMatch(/Hecho|que viene listo/)
  })
})

// PRO-170: the same line in the web chat, after Mimo generates a menu, in the
// same weeks (routes/assistant.ts).
describe('web chat: the snowball line above Mimo\'s reply after generating', () => {
  const reply = 'Hecho:\n- Menú de la semana listo'
  it('turns that generate a menu: generate_weekly_menu or complete_onboarding', () => {
    expect(generatedMenuThisTurn(['generate_weekly_menu'])).toBe(true)
    expect(generatedMenuThisTurn(['complete_onboarding', 'update_memory'])).toBe(true)
    expect(generatedMenuThisTurn(['swap_meal', 'get_weekly_menu'])).toBe(false)
    expect(generatedMenuThisTurn(undefined)).toBe(false)
  })
  it('weeks 1–2: the line goes first; week 3 or an unknown count: the reply as it was', () => {
    expect(withSnowballLine(reply, 1)).toBe(`${SNOWBALL_LINE}\n\n${reply}`)
    expect(withSnowballLine(reply, 2)).toBe(`${SNOWBALL_LINE}\n\n${reply}`)
    expect(withSnowballLine(reply, 3)).toBe(reply)
    expect(withSnowballLine(reply, undefined)).toBe(reply)
  })
  it('never twice, and an empty reply is just the line', () => {
    expect(withSnowballLine(withSnowballLine(reply, 1), 1)).toBe(`${SNOWBALL_LINE}\n\n${reply}`)
    expect(withSnowballLine('', 1)).toBe(SNOWBALL_LINE)
  })
})

/**
 * PRO-277 (revisor de Mimo, 2026-10-18): generating the menu by WhatsApp sent
 * two messages (the picture and a long «Hecho:»). Mimo's short answer — also
 * to what else was asked, «qué dejo hecho el domingo» — goes in the picture's
 * caption; the caption's fixed lines are dropped before splitting.
 */
describe('replyMessages — generating the menu is ONE message (PRO-277)', () => {
  const caption = weekMenuCaption(NEXT_WEEK, { today: THU, webUrl: WEB, view: 'generated', generatedWeeks: 1 })
  const generated = (message: string): AssistantResponse => ({
    message,
    actionTaken: true,
    uiHint: 'menu',
    data: { id: 'm-2', days: [] },
    toolsUsed: ['generate_weekly_menu'],
  })
  const deps = () => ({
    webUrl: WEB,
    menuDigest: vi.fn<NonNullable<InboundDeps['menuDigest']>>(async () => 'digest'),
    menuImage: vi.fn<NonNullable<InboundDeps['menuImage']>>(async () => ({ jpeg: JPEG, caption })),
  })
  const words = (n: number) => {
    const base = 'El domingo por la tarde deja hechas las lentejas del lunes, el hummus para las cenas y el sofrito del arroz con bacalao. '
    return base.repeat(Math.ceil(n / base.length)).slice(0, n).trim()
  }

  it('a 600-character answer without buttons: exactly one message, the picture with everything in its caption', async () => {
    const answer = words(600)
    expect(answer.length).toBeGreaterThanOrEqual(595)
    const out = await replyMessages(generated(answer), 'user-1', deps(), null)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ type: 'image', image: JPEG })
    expect(out[0].text).toBe(`${answer}\n\n${caption}`)
    expect(out[0].text.length).toBeLessThanOrEqual(1024)
  })

  it('too long with the whole caption: the invite, then the link, go before splitting', async () => {
    const lines = caption.split('\n')
    const invite = lines.find((l) => l.startsWith('¿Cambio algo?'))!
    const link = lines.find((l) => l.startsWith('📖 '))!
    // Fits only without the invite.
    const a = words(1024 - caption.length - 2 + invite.length - 5)
    const outA = await replyMessages(generated(a), 'user-1', deps(), null)
    expect(outA).toHaveLength(1)
    expect(outA[0].text).toContain(link)
    expect(outA[0].text).not.toContain(invite)
    expect(outA[0].text).toContain('Listo: tu menú de la semana del 19 al 25 de octubre')
    expect(outA[0].text).toContain(SNOWBALL_LINE)
    // Fits only without the invite and the link.
    const b = words(1024 - caption.length - 2 + invite.length + link.length - 5)
    const outB = await replyMessages(generated(b), 'user-1', deps(), null)
    expect(outB).toHaveLength(1)
    expect(outB[0].text).not.toContain(link)
    expect(outB[0].text).toContain('Listo: tu menú')
    expect(outB[0].text.length).toBeLessThanOrEqual(1024)
  })

  it('buttons still go in a message of their own after the picture', async () => {
    const out = await replyMessages(generated('¿Te preparo la lista de la compra?\n[[opciones: Sí | No]]'), 'user-1', deps(), null)
    expect(out).toHaveLength(2)
    expect(out[0].text).toBe(caption)
  })
})
