/**
 * PRO-382 (D-158): piloto automático, paso 2 — «vuestra semana ya está
 * hecha». Which channel carries it, the WhatsApp guide (dates, dishes and the
 * question), the email (subject and links) and the reply. specs/notifications.md
 * «La semana, hecha».
 */
import { describe, expect, it } from 'vitest'
import type { DayMenu } from '@ona/shared'
import {
  autoplanChannels,
  autoplanDishes,
  autoplanEmail,
  autoplanEmailSubject,
  autoplanFixedText,
  autoplanGuide,
  autoplanPushPayload,
  autoplanTemplate,
  autoplanWeekLines,
  mainDishOfDay,
  type AutoplanReach,
} from '../services/autoplanNotice.js'
import { MESSAGE_GUIDES, guidedSystemPrompt, validateGuided } from '../services/whatsapp/guided.js'
import { noticePriority } from '../services/notifications/budget.js'
import { deliverInOrder } from '../services/notifications/channels.js'
import { autoplanReplyOutcome } from '../services/weeklyAutoplan.js'
import { askedForFridge } from '../services/whatsapp/inbound.js'

const WEEK = '2026-11-16'
const WEB = 'https://www.mimoia.com'

const recipe = (id: string, recipeName: string) => ({ kind: 'recipe' as const, recipeId: id, recipeName })
const day = (lunch: string | null, dinner: string | null): DayMenu => ({
  ...(lunch ? { lunch: { dishes: [recipe(`l-${lunch}`, lunch)] } } : {}),
  ...(dinner ? { dinner: { dishes: [recipe(`d-${dinner}`, dinner)] } } : {}),
})
const DAYS: DayMenu[] = [
  day('Lentejas estofadas', 'Tortilla de patatas'),
  day('Pollo al horno', 'Crema de calabacín'),
  day('Merluza en salsa verde', null),
  day(null, 'Costillas a la riojana'),
  day('Lentejas estofadas', 'Sopa de fideos'),
  { lunch: { dishes: [{ kind: 'note', text: 'Comemos fuera' } as any] } },
  {},
]

describe('the dishes it names', () => {
  it('takes each day’s main dish: lunch first, then dinner, then a note', () => {
    expect(mainDishOfDay(DAYS[0])).toBe('Lentejas estofadas')
    expect(mainDishOfDay(DAYS[3])).toBe('Costillas a la riojana')
    expect(mainDishOfDay(DAYS[5])).toBe('Comemos fuera')
    expect(mainDishOfDay(DAYS[6])).toBeNull()
  })

  it('names up to 4 different ones, in day order', () => {
    expect(autoplanDishes(DAYS)).toEqual(['Lentejas estofadas', 'Pollo al horno', 'Merluza en salsa verde', 'Costillas a la riojana'])
    expect(autoplanDishes(DAYS, 3)).toHaveLength(3)
  })
})

describe('which channel carries it', () => {
  const reach = (o: Partial<AutoplanReach>): AutoplanReach => ({ whatsapp: true, inWindow: false, template: null, push: true, email: true, ...o })

  it('inside the 24 h window: WhatsApp first, as text', () => {
    expect(autoplanChannels(reach({ inWindow: true }))).toEqual(['whatsapp', 'push', 'email'])
  })

  it('outside the window with its template: WhatsApp (by the template)', () => {
    expect(autoplanChannels(reach({ template: 'mimoia_semana_lista' }))).toEqual(['whatsapp', 'push', 'email'])
  })

  it('outside the window without a template: the phone notification, then email', () => {
    expect(autoplanChannels(reach({}))).toEqual(['push', 'email'])
    expect(autoplanChannels(reach({ push: false }))).toEqual(['email'])
  })

  it('without WhatsApp, with and without the phone notification', () => {
    expect(autoplanChannels(reach({ whatsapp: false, inWindow: true }))).toEqual(['push', 'email'])
    expect(autoplanChannels(reach({ whatsapp: false, push: false }))).toEqual(['email'])
    expect(autoplanChannels(reach({ whatsapp: false, push: false, email: false }))).toEqual([])
  })

  it('only its own template carries it, never the generic one', () => {
    expect(autoplanTemplate({ weekly_autoplan: 'mimoia_semana_lista', daily_brief: 'mimoia_menu_de_hoy' })).toBe('mimoia_semana_lista')
    expect(autoplanTemplate({ daily_brief: 'mimoia_menu_de_hoy' })).toBeNull()
  })

  it('one message: the next channel only when the previous did not get through', async () => {
    const tried: string[] = []
    const send = (ch: string, status: 'ok' | 'skipped' | 'error') => async () => (tried.push(ch), { status })
    const r = await deliverInOrder(['whatsapp', 'push', 'email'] as const, { whatsapp: send('whatsapp', 'error'), push: send('push', 'skipped'), email: send('email', 'ok') })
    expect(r).toMatchObject({ status: 'sent', channel: 'email' })
    expect(tried).toEqual(['whatsapp', 'push', 'email'])
  })

  it('is priority 1: it spends one of the 4 units', () => {
    expect(noticePriority('weekly_autoplan')).toBe(1)
  })
})

describe('the WhatsApp guide (D-065)', () => {
  const copy = { weekStart: WEEK, dishes: autoplanDishes(DAYS), webUrl: WEB }
  const spec = autoplanGuide(copy)
  const fixed = autoplanFixedText(copy)

  it('says what it is for, asks, and stays under 500 characters', () => {
    const g = MESSAGE_GUIDES.weekly_autoplan
    expect(g.purpose).toMatch(/semana que viene ya está hecha/)
    expect(g.mustCarry).toMatch(/fechas/)
    expect(g.mustCarry).toMatch(/«vale»/)
    expect(g.mustCarry).toMatch(/lista/)
    expect(g.tone).toMatch(/jueves tranquilo/)
    expect(g.maxChars).toBe(500)
    expect(g.asks).toBe(true)
    expect(guidedSystemPrompt('weekly_autoplan')).toContain('500 caracteres')
  })

  it('requires the dates, the dishes, «vale» and the week’s link', () => {
    expect(spec.kind).toBe('weekly_autoplan')
    expect(spec.required).toEqual(['del 16 al 22 de noviembre', ...copy.dishes, 'vale', 'mimoia.com/menu?week=2026-11-16'])
    expect(spec.dishes).toEqual(copy.dishes)
  })

  it('the fixed text carries all of it, asks and passes its own check', () => {
    expect(fixed).toContain('del 16 al 22 de noviembre')
    for (const d of copy.dishes) expect(fixed).toContain(d)
    expect(fixed).toMatch(/lista de la compra también está lista/)
    expect(fixed).toContain('¿Te encaja? Contesta «vale»')
    expect(fixed).toContain('cámbiame el jueves')
    expect(fixed.length).toBeLessThanOrEqual(500)
    expect(validateGuided(fixed, spec, fixed)).toEqual({ ok: true })
  })

  it('a written message without the dates, a dish or the question goes back to the fixed text', () => {
    const good =
      'La semana del 16 al 22 de noviembre ya la tienes: Lentejas estofadas, Pollo al horno, Merluza en salsa verde y Costillas a la riojana, y la lista lista. ¿Te vale así? Contesta vale o dime qué cambio. mimoia.com/menu?week=2026-11-16'
    expect(validateGuided(good, spec, fixed)).toEqual({ ok: true })
    expect(validateGuided(good.replace('del 16 al 22 de noviembre', 'que viene'), spec, fixed)).toEqual({ ok: false, reason: 'missing_required' })
    expect(validateGuided(good.replace('Pollo al horno, ', ''), spec, fixed)).toEqual({ ok: false, reason: 'missing_required' })
    expect(validateGuided(good.replace('¿Te vale así? ', ''), spec, fixed)).toEqual({ ok: false, reason: 'no_question' })
    expect(validateGuided(`${good} ${'muy rica '.repeat(40)}`, spec, fixed)).toEqual({ ok: false, reason: 'too_long' })
  })
})

describe('the phone notification', () => {
  it('opens the week, with no links in the text', () => {
    const p = autoplanPushPayload({ weekStart: WEEK, dishes: autoplanDishes(DAYS), webUrl: WEB })
    expect(p).toMatchObject({ title: 'Vuestra semana ya está hecha', url: '/menu?week=2026-11-16', tag: 'weekly_autoplan' })
    expect(p.body).toMatch(/^Del 16 al 22 de noviembre: Lentejas estofadas/)
    expect(p.body).not.toMatch(/https?:/)
  })
})

describe('the email', () => {
  const mail = autoplanEmail({ email: 'hogar@example.com', weekStart: WEEK, days: DAYS, publicUrl: `${WEB}/` })

  it('subject: «Vuestra semana del {día} al {día} ya está hecha»', () => {
    expect(mail.subject).toBe('Vuestra semana del 16 al 22 de noviembre ya está hecha')
    expect(autoplanEmailSubject('2026-11-30')).toBe('Vuestra semana del 30 de noviembre al 6 de diciembre ya está hecha')
    expect(mail.to).toBe('hogar@example.com')
  })

  it('the 7 days with their main dish', () => {
    expect(autoplanWeekLines(WEEK, DAYS)).toEqual([
      { label: 'Lunes 16', value: 'Lentejas estofadas' },
      { label: 'Martes 17', value: 'Pollo al horno' },
      { label: 'Miércoles 18', value: 'Merluza en salsa verde' },
      { label: 'Jueves 19', value: 'Costillas a la riojana' },
      { label: 'Viernes 20', value: 'Lentejas estofadas' },
      { label: 'Sábado 21', value: 'Comemos fuera' },
      { label: 'Domingo 22', value: 'Sin plan' },
    ])
    expect(mail.text).toContain('Jueves 19: Costillas a la riojana')
    expect(mail.html).toContain('Costillas a la riojana')
  })

  it('«Ver la semana» and «Mandar la lista», and how to switch it off', () => {
    expect(mail.html).toContain('href="https://www.mimoia.com/menu?week=2026-11-16"')
    expect(mail.html).toContain('>Ver la semana<')
    expect(mail.html).toContain('href="https://www.mimoia.com/shopping"')
    expect(mail.html).toContain('>Mandar la lista<')
    expect(mail.text).toContain('Ver la semana: https://www.mimoia.com/menu?week=2026-11-16')
    expect(mail.text).toContain('Mandar la lista: https://www.mimoia.com/shopping')
    expect(mail.text).toContain('https://www.mimoia.com/profile/avisos')
    expect(mail.text).toMatch(/Para apagarlo/)
  })

  it('escapes what comes from the menu', () => {
    const m = autoplanEmail({ email: 'a@b.c', weekStart: WEEK, days: [day('Pan <b>con</b> tomate', null)], publicUrl: WEB })
    expect(m.html).not.toContain('<b>con</b>')
    expect(m.html).toContain('Pan &lt;b&gt;con&lt;/b&gt; tomate')
  })
})

describe('the reply', () => {
  it('«vale» or a reply that changes nothing is accepted; a change through Mimo’s tools is a change', () => {
    expect(autoplanReplyOutcome([])).toBe('accepted')
    expect(autoplanReplyOutcome(['get_weekly_menu', 'get_shopping_list'])).toBe('accepted')
    expect(autoplanReplyOutcome(['get_weekly_menu', 'swap_meal'])).toBe('changed')
    expect(autoplanReplyOutcome(['remove_dish'])).toBe('changed')
  })

  it('inbound treats «tu semana ya está hecha» as the Sunday message', () => {
    expect(askedForFridge([{ direction: 'out', kind: 'weekly_autoplan', status: 'sent' }])).toBe(true)
    expect(askedForFridge([{ direction: 'out', kind: 'weekly_nudge', status: 'sent' }])).toBe(true)
    expect(askedForFridge([{ direction: 'out', kind: 'daily_brief', status: 'sent' }])).toBe(false)
  })
})
