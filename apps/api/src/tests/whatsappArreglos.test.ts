/**
 * 18-nov (three weeks of WhatsApp reviewed): the pure pieces of the fixes —
 * the shopping list's real shape, ONE question in «¿hiciste la cena?», true
 * hours and minutes in «hora de cocinar», the check-in buttons, the 80 %
 * notice and no button avisos with the cap used up.
 */
import { describe, expect, it } from 'vitest'
import { shoppingItemsOf, isShoppingItemList } from '../services/shoppingText.js'
import { validateGuided, clockTimesOf, minuteCountsOf } from '../services/whatsapp/guided.js'
import { cookingReminderGuide, dinnerCheckinGuide, formatDinnerCheckin, withoutMimoButtonAvisos, type PlannedMessage } from '../services/whatsapp/proactive.js'
import { checkinAnswerOf, checkinConfirmation } from '../services/whatsapp/checkinButtons.js'
import { crossesBudgetWarning } from '../services/advisorBudget.js'

describe('shoppingItemsOf', () => {
  const items = [{ id: 'a', name: 'Pan', aisle: 'panaderia', quantity: 1, unit: 'u', checked: false, inStock: false }]
  it('takes get_shopping_list data ({ listId, items }) as well as the bare array', () => {
    expect(shoppingItemsOf({ listId: 'L1', items })).toEqual(items)
    expect(shoppingItemsOf(items)).toEqual(items)
    expect(isShoppingItemList({ listId: 'L1', items })).toBe(false)
  })
  it('anything else is not a list', () => {
    expect(shoppingItemsOf({ listId: 'x' })).toBeNull()
    expect(shoppingItemsOf({ items: [{ id: 'm1', days: [] }] })).toBeNull()
    expect(shoppingItemsOf(null)).toBeNull()
  })
})

describe('«¿hiciste la cena?»: one question', () => {
  const name = 'Merluza en salsa'
  it('the fixed text asks one thing and no longer repeats «no vuelve a salir sola»', () => {
    const m = formatDinnerCheckin(name)
    expect(m.text.match(/\?/g)).toHaveLength(1)
    expect(m.text).not.toMatch(/no vuelve a salir/)
    expect(dinnerCheckinGuide(name).facts.join(' ')).not.toMatch(/no vuelve a salir sola/)
  })
  it('a written check-in with more than one «?» goes out as the fixed text', () => {
    const spec = dinnerCheckinGuide(name)
    expect(validateGuided(`¿Hiciste hoy la ${name}? ¿Qué tal estuvo?`, spec, 'x')).toEqual({ ok: false, reason: 'too_many_questions' })
    expect(validateGuided(`¿Salió hoy la ${name}? Así lo apunto.`, spec, 'x')).toEqual({ ok: true })
  })
})

describe('«hora de cocinar»: the real hours and minutes', () => {
  // Dinner 21:30, 80 min of cooking → start 20:00; the message goes out at 19:56.
  const spec = cookingReminderGuide('Lasaña', 80, '21:30', { hour: 19, minute: 56 })
  const name = 'Lasaña'

  it('the writer gets the time it goes out, when to start and the minutes left', () => {
    const facts = spec.facts.join('\n')
    expect(facts).toContain('Hora a la que sale este mensaje: 19:56')
    expect(facts).toContain('Empieza a cocinar a las 20:00 (dentro de 4 min)')
    expect(facts).toContain('Hora de la cena: 21:30 (faltan 94 min)')
    expect(spec.allowedTimes).toEqual(['19:56', '20:00', '21:30'])
    expect(spec.allowedMinutes).toEqual([80, 94, 10, 4])
  })

  it('says the 10 min of margin, so «en 7 min» + the dish adds up to dinner (reviewer, 20-nov)', () => {
    // 19-nov: 19:55, Sepia 48 min, dinner 21:00 → «en 7 min» read as a wrong sum (it is 48 + 10 of margin).
    const s = cookingReminderGuide('Sepia con guisantes', 48, '21:00', { hour: 19, minute: 55 })
    const facts = s.facts.join('\n')
    expect(facts).toContain('dentro de 7 min')
    expect(facts).toContain('10 min de margen')
    expect(validateGuided('En 7 min toca la Sepia con guisantes: unos 48 min y 10 de margen, para cenar a las 21:00.', s, 'x')).toEqual({ ok: true })
  })

  it('a made-up hour or minute count is rejected (the cases the review found)', () => {
    expect(validateGuided(`Son casi las 20:12: toca la ${name} para cenar a las 21:30 (unos 80 min).`, spec, 'x')).toEqual({ ok: false, reason: 'wrong_time' })
    expect(validateGuided(`Tienes 83 min por delante: ${name} a las 21:30, lleva unos 80 min.`, spec, 'x')).toEqual({ ok: false, reason: 'wrong_minutes' })
    expect(validateGuided(`A las 20:00 empieza con la ${name} (unos 80 min) y cenáis a las 21:30.`, spec, 'x')).toEqual({ ok: true })
  })

  it('reads times and minute counts in their usual forms', () => {
    expect(clockTimesOf('a las 8:05, a las 20.30 o 21h00')).toEqual(['08:05', '20:30', '21:00'])
    expect(minuteCountsOf('unos 45 minutos, 10 min, 1 minuto')).toEqual([45, 10, 1])
  })
})

describe('check-in buttons', () => {
  it('each id says what it answers', () => {
    expect(checkinAnswerOf('checkin:yes:5')).toEqual({ cooked: true, rating: 5 })
    expect(checkinAnswerOf('checkin:yes:3')).toEqual({ cooked: true, rating: 3 })
    expect(checkinAnswerOf('checkin:yes')).toEqual({ cooked: true, rating: null })
    expect(checkinAnswerOf('checkin:no')).toEqual({ cooked: false, rating: null })
    expect(checkinAnswerOf('nudge:yes')).toBeNull()
    expect(checkinAnswerOf(null)).toBeNull()
  })
  it('the confirmation is one short line', () => {
    expect(checkinConfirmation({ cooked: true, rating: 5 }, 'Lasaña')).toBe('Apuntada la cena: *Lasaña*, y que es para repetir.')
    expect(checkinConfirmation({ cooked: false, rating: null }, 'Lasaña')).toBe('Vale, no la apunto.')
  })
})

describe('Mimo\'s monthly cap', () => {
  it('the 80 % notice: only the turn that crosses the line', () => {
    expect(crossesBudgetWarning(4_700_000, 200_000, 6_000_000)).toBe(true)
    expect(crossesBudgetWarning(4_800_000, 200_000, 6_000_000)).toBe(false)
    expect(crossesBudgetWarning(1_000_000, 200_000, 6_000_000)).toBe(false)
    expect(crossesBudgetWarning(4_700_000, 2_000_000, 6_000_000)).toBe(true)
    expect(crossesBudgetWarning(4_700_000, 0, 6_000_000)).toBe(false)
  })

  it('with the cap used up, avisos whose buttons need Mimo do not go; the check-in and the rest do', () => {
    const p = (kind: PlannedMessage['kind']): PlannedMessage => ({ kind, messages: [{ type: 'text', text: kind }] })
    const planned = [p('weekly_nudge'), p('freezer_review'), p('dinner_checkin'), p('shopping_reminder')]
    expect(withoutMimoButtonAvisos(planned, true).map((x) => x.kind)).toEqual(['dinner_checkin', 'shopping_reminder'])
    expect(withoutMimoButtonAvisos(planned, false)).toEqual(planned)
  })
})
