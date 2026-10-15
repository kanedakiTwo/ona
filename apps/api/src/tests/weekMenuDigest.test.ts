/**
 * The week summary WhatsApp sends after generating the menu (Miguel,
 * 2026-10-08: "la respuesta debería incluir un resumen del menú para poder
 * iterar desde WhatsApp sin navegar"). Rewritten 2026-10-15 after the first
 * real feedback («Overwhelming… too much info»): day blocks with a fixed emoji
 * per meal, only the days still to come, one link to the menu, no per-recipe
 * links.
 */
import { describe, it, expect } from 'vitest'
import { weekMenuDigest, weekRangeEs, menuDigestInvite, MEAL_EMOJI } from '../services/menuText.js'

const r = (recipeName: string, recipeId = recipeName.toLowerCase().replace(/\s+/g, '-')) =>
  ({ kind: 'recipe' as const, recipeId, recipeName })
const slot = (...dishes: any[]) => ({ dishes })
const day = (lunch: string, dinner: string) => ({ lunch: slot(r(lunch)), dinner: slot(r(dinner)) })
const WEB = 'https://mimoia.com'

/** Luis's week (generated on Thursday 15 Oct 2026). */
const LUIS_WEEK: any[] = [
  day('Ropa vieja del cocido', 'Onigirazu'),
  day('Lentejas con chorizo', 'Tortilla de patata'),
  day('Arroz al horno', 'Crema de calabacín'),
  day('Pisto con huevo frito a la Thermomix', 'Guisantes lágrima'),
  day('Pollo agridulce', 'Costillas a la riojana'),
  day('Alubias rojas con entraña y embutidos', 'Lentejas guisadas'),
  day('Hamburguesa casera', 'Oreja a la plancha'),
]

describe('weekRangeEs', () => {
  it('names one month when the week stays inside it', () => {
    expect(weekRangeEs('2026-10-12')).toBe('del 12 al 18 de octubre')
  })
  it('names both months when the week crosses one', () => {
    expect(weekRangeEs('2026-09-28')).toBe('del 28 de septiembre al 4 de octubre')
  })
})

describe('weekMenuDigest — generated mid-week (Thursday 15 Oct)', () => {
  const text = weekMenuDigest({ weekStart: '2026-10-12', days: LUIS_WEEK }, { today: '2026-10-15', webUrl: WEB })

  it('is exactly the format Miguel approved', () => {
    expect(text).toBe([
      'Listo: tu menú hasta el domingo 🍽️',
      '',
      '*Jueves 15 · hoy*',
      '☀️ Pisto con huevo frito a la Thermomix',
      '🌙 Guisantes lágrima',
      '',
      '*Viernes 16 · mañana*',
      '☀️ Pollo agridulce',
      '🌙 Costillas a la riojana',
      '',
      '*Sábado 17*',
      '☀️ Alubias rojas con entraña y embutidos',
      '🌙 Lentejas guisadas',
      '',
      '*Domingo 18*',
      '☀️ Hamburguesa casera',
      '🌙 Oreja a la plancha',
      '',
      '📖 Recetas y lista de la compra: mimoia.com/menu',
      '',
      '¿Cambio algo? Dímelo, p. ej. «el sábado, pescado».',
    ].join('\n'))
  })
  it('leaves out the days already gone', () => {
    expect(text).not.toMatch(/Lunes|Martes|Miércoles/)
    expect(text).not.toContain('Ropa vieja')
  })
  it('has no per-recipe links and one menu line', () => {
    expect(text).not.toContain('/recipes/')
    expect(text).not.toContain('→')
    expect(text.match(/\/menu/g)).toHaveLength(1)
  })
  it('stays well inside one WhatsApp message', () => {
    expect(text.length).toBeLessThan(700)
  })
  it('says nothing about health', () => {
    expect(text).not.toMatch(/salud|sano|saludable|nutri|calor/i)
  })
})

describe('weekMenuDigest — a week that has not started', () => {
  const text = weekMenuDigest({ weekStart: '2026-10-19', days: LUIS_WEEK }, { today: '2026-10-15', webUrl: WEB })
  const lines = text.split('\n')

  it('opens with the week range and shows all seven days', () => {
    expect(lines[0]).toBe('Listo: tu menú de la semana del 19 al 25 de octubre 🍽️')
    expect(lines.filter((l) => /^\*(Lunes|Martes|Miércoles|Jueves|Viernes|Sábado|Domingo) \d+\*$/.test(l))).toHaveLength(7)
    expect(lines).toContain('*Lunes 19*')
    expect(text).not.toContain('· hoy')
  })
  it('the invite names a day of that week', () => {
    expect(lines.at(-1)).toBe('¿Cambio algo? Dímelo, p. ej. «el martes, pescado».')
  })
  it('generated on Sunday for next week: Monday is "mañana"', () => {
    const t = weekMenuDigest({ weekStart: '2026-10-19', days: LUIS_WEEK }, { today: '2026-10-18' })
    expect(t).toContain('*Lunes 19 · mañana*')
    expect(t).not.toContain('📖') // no web URL → no menu line
  })
})

describe('weekMenuDigest — shapes of a day', () => {
  const opts = { today: '2026-10-12', webUrl: WEB } // Monday: the whole week is still to come

  it('lunch-only and dinner-only plans: one line per day, with its marker', () => {
    const lunchOnly = weekMenuDigest({ weekStart: '2026-10-12', days: [{ lunch: slot(r('Paella')) }] }, opts)
    expect(lunchOnly).toContain('*Lunes 12 · hoy*\n☀️ Paella\n\n')
    expect(lunchOnly).not.toContain('🌙')
    const dinnerOnly = weekMenuDigest({ weekStart: '2026-10-12', days: [{ dinner: slot(r('Sopa')) }] }, opts)
    expect(dinnerOnly).toContain('*Lunes 12 · hoy*\n🌙 Sopa\n\n')
    expect(dinnerOnly).not.toContain('☀️')
  })
  it('breakfast and snack get their own fixed markers, in meal order', () => {
    const t = weekMenuDigest({
      weekStart: '2026-10-12',
      days: [{ dinner: slot(r('Sopa')), breakfast: slot(r('Tostadas')), snack: slot(r('Yogur')), lunch: slot(r('Paella')) }],
    }, opts)
    expect(t).toContain('*Lunes 12 · hoy*\n☕ Tostadas\n☀️ Paella\n🍎 Yogur\n🌙 Sopa')
    expect(MEAL_EMOJI).toEqual({ breakfast: '☕', lunch: '☀️', snack: '🍎', dinner: '🌙' })
  })
  it('a multi-dish slot joins the dishes with " + "', () => {
    const t = weekMenuDigest({ weekStart: '2026-10-12', days: [{ lunch: slot(r('Dorada'), r('Ensalada verde')) }] }, opts)
    expect(t).toContain('☀️ Dorada + Ensalada verde')
  })
  it('notes as written, leftovers and freezer marked', () => {
    const t = weekMenuDigest({
      weekStart: '2026-10-12',
      days: [{
        lunch: slot({ ...r('Lentejas'), variant: 'leftover' }),
        dinner: slot({ kind: 'note', text: 'Cenamos fuera' }),
      }, {
        lunch: slot({ ...r('Croquetas'), variant: 'freezer' }),
      }],
    }, opts)
    expect(t).toContain('☀️ Lentejas (sobras)\n🌙 Cenamos fuera')
    expect(t).toContain('☀️ Croquetas (del congelador)')
  })
  it('a skipped day reads "Sin cocinar"; a day with nothing is left out', () => {
    const days: any[] = [day('A', 'B'), {}, day('C', 'D'), {}, {}, {}, {}]
    const t = weekMenuDigest({ weekStart: '2026-10-12', days, skippedDays: [4] }, opts)
    expect(t).toContain('*Viernes 16*\nSin cocinar')
    expect(t).not.toContain('Martes')
    expect(t).not.toContain('Jueves')
    // The example skips today and the skipped day: Wednesday is the next to come.
    expect(t.split('\n').at(-1)).toBe('¿Cambio algo? Dímelo, p. ej. «el miércoles, pescado».')
  })
})

describe('weekMenuDigest — edges of "from today on"', () => {
  it('on Sunday: only today, and the invite says "hoy"', () => {
    const t = weekMenuDigest({ weekStart: '2026-10-12', days: LUIS_WEEK }, { today: '2026-10-18' })
    expect(t.split('\n')[0]).toBe('Listo: tu menú de hoy 🍽️')
    expect(t).toContain('*Domingo 18 · hoy*')
    expect(t).not.toContain('Sábado')
    expect(t.split('\n').at(-1)).toBe('¿Cambio algo? Dímelo, p. ej. «hoy, pescado».')
  })
  it('nothing left from today on: the whole week instead of an empty message', () => {
    const days: any[] = [day('A', 'B'), day('C', 'D')]
    const t = weekMenuDigest({ weekStart: '2026-10-12', days }, { today: '2026-10-15' })
    expect(t.split('\n')[0]).toBe('Listo: tu menú de la semana del 12 al 18 de octubre 🍽️')
    expect(t).toContain('*Lunes 12*')
    expect(t).toContain('*Martes 13*')
  })
  it('the invite example picks the second day still to come, or the only one', () => {
    expect(menuDigestInvite([4, 5, 6])).toBe('¿Cambio algo? Dímelo, p. ej. «el sábado, pescado».')
    expect(menuDigestInvite([6])).toBe('¿Cambio algo? Dímelo, p. ej. «el domingo, pescado».')
    expect(menuDigestInvite([])).toBe('¿Cambio algo? Dímelo, p. ej. «hoy, pescado».')
  })
})
