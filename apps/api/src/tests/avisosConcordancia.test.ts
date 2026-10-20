/**
 * PRO-274: the avisos Mimo writes by itself agree with the dish (gender and
 * number), speak Spanish from Spain, don't open the same twice in a row and
 * the check-in button carries no gender.
 */
import { describe, expect, it } from 'vitest'
import { agreementFacts, agreementMismatch, dishAgreement } from '../services/whatsapp/dishAgreement.js'
import { composeGuided, guidedUserPrompt, openingOf, validateGuided, type GuidedWriter } from '../services/whatsapp/guided.js'
import { CHECKIN_RATING_BUTTONS, cookingReminderGuide, dinnerCheckinGuide, formatDinnerCheckin } from '../services/whatsapp/proactive.js'

const COSTILLAS = 'Costillas a la riojana'
const SANDWICH = 'Sándwich vegetal'

describe('dishAgreement', () => {
  it('reads gender and number from the head noun', () => {
    expect(dishAgreement(COSTILLAS)).toEqual({ gender: 'f', number: 'pl' })
    expect(dishAgreement(SANDWICH)).toEqual({ gender: 'm', number: 'sg' })
    expect(dishAgreement('Crema de calabaza')).toEqual({ gender: 'f', number: 'sg' })
    expect(dishAgreement('Garbanzos con espinacas')).toEqual({ gender: 'm', number: 'pl' })
    expect(dishAgreement('Macarrones con tomate')).toEqual({ gender: 'm', number: 'pl' })
    expect(dishAgreement('Hummus casero')).toEqual({ gender: 'm', number: 'sg' })
    expect(dishAgreement('Carne guisada')).toEqual({ gender: 'f', number: 'sg' })
    expect(dishAgreement('Arroz al horno')).toEqual({ gender: 'm', number: 'sg' })
  })

  it('tells the writer the agreement of each dish', () => {
    expect(agreementFacts([COSTILLAS, SANDWICH])).toEqual([
      '«Costillas a la riojana» es femenino plural: concuerda artículos, adjetivos y verbo (las Costillas a la riojana, ¿están listas?).',
      '«Sándwich vegetal» es masculino singular: concuerda artículos, adjetivos y verbo (el Sándwich vegetal, ¿está listo?).',
    ])
  })

  it('spots an article or «lista» that does not agree with the dish', () => {
    expect(agreementMismatch('¿Ya está lista la Costillas a la riojana?', [COSTILLAS])).toBe(COSTILLAS)
    expect(agreementMismatch('¿Ya están listas las *Costillas a la riojana*?', [COSTILLAS])).toBeNull()
    expect(agreementMismatch('¿Ya está lista la Sándwich vegetal?', [SANDWICH])).toBe(SANDWICH)
    expect(agreementMismatch('¿Ya está listo el *Sándwich vegetal*?', [SANDWICH])).toBeNull()
    expect(agreementMismatch('¿Ya están listos las Costillas a la riojana?', [COSTILLAS])).toBe(COSTILLAS)
    // «la cena (*X*)»: the article goes with «cena».
    expect(agreementMismatch('¿Hiciste hoy la cena (*Sándwich vegetal*)?', [SANDWICH])).toBeNull()
  })
})

describe('dinner check-in (PRO-274)', () => {
  for (const name of [COSTILLAS, SANDWICH]) {
    it(`«${name}»: the guide carries the agreement and the dish to check`, () => {
      for (const rate of [false, true]) {
        const g = dinnerCheckinGuide(name, rate)
        expect(g.dishes).toEqual([name])
        expect(g.facts.some((f) => f.startsWith(`«${name}» es `))).toBe(true)
      }
      expect(cookingReminderGuide(name, 60, '21:00').dishes).toEqual([name])
    })

    it(`«${name}»: no button carries a gender`, () => {
      for (const rate of [false, true]) {
        const m = formatDinnerCheckin(name, rate)
        expect(m.type).toBe('buttons')
        const titles = m.type === 'buttons' ? m.buttons.map((b) => b.title) : []
        for (const t of titles) expect(t).not.toMatch(/\b(la|lo|las|los)\b|hech[ao]s\b|\bhecha\b/i)
      }
      const plain = formatDinnerCheckin(name, false)
      expect(plain.type === 'buttons' && plain.buttons.map((b) => b.title)).toEqual(['Sí, hecho', 'No'])
    })
  }

  it('the rating buttons are neutral too', () => {
    expect(CHECKIN_RATING_BUTTONS.map((b) => b.title)).toEqual(['Sí, ¡a repetir!', 'Sí, estuvo bien', 'No'])
  })

  it('a written message that does not agree goes out as the fixed text; one that agrees goes out', async () => {
    const cases: Array<[string, string, string]> = [
      [COSTILLAS, '¿Ya está lista la Costillas a la riojana? Dime y lo apunto.', '¿Ya están listas las Costillas a la riojana? Dime y lo apunto.'],
      [SANDWICH, '¿Ya está lista la Sándwich vegetal? Dime y lo apunto.', '¿Ya está listo el Sándwich vegetal? Dime y lo apunto.'],
    ]
    for (const [name, wrong, right] of cases) {
      const fixed = formatDinnerCheckin(name, false)
      const fallback = fixed.type === 'buttons' ? fixed.text : ''
      const spec = dinnerCheckinGuide(name, false)
      const run = (text: string) => {
        const writer: GuidedWriter = async () => ({ text })
        return composeGuided(spec, fallback, { writer, userId: null, overBudget: async () => false, context: async () => ({ memory: [], recent: [], previous: [] }) })
      }
      expect(await run(wrong)).toMatchObject({ source: 'fallback', reason: 'invalid:agreement' })
      expect(await run(right)).toMatchObject({ source: 'guide', text: right })
      // The fixed text agrees too.
      expect(agreementMismatch(fallback, [name])).toBeNull()
    }
  })
})

describe('Spanish from Spain and openings (PRO-274)', () => {
  const spec = dinnerCheckinGuide(SANDWICH, false)

  it('rejects Latin-American expressions', () => {
    expect(validateGuided('¿Te late así? ¿Hiciste el Sándwich vegetal?', spec, 'x')).toEqual({ ok: false, reason: 'banned_word' })
    expect(validateGuided('Ahorita lo apunto: ¿hiciste el Sándwich vegetal?', spec, 'x')).toEqual({ ok: false, reason: 'banned_word' })
  })

  it('openingOf takes the first clause, two words at most', () => {
    expect(openingOf('¡Ey! Hoy toca algo rico.')).toBe('ey')
    expect(openingOf('¡Al lío! Hoy toca algo rico.')).toBe('al lio')
    expect(openingOf('Buenos días, hoy toca...')).toBe('buenos dias')
  })

  it('never opens like the last aviso to that person (any kind)', () => {
    const last = ['¡Ey! Si quieres cenar a las 21:00, toca empezar con *Costillas a la riojana* (unos 90 min).']
    expect(validateGuided('¡Ey! ¿Hiciste hoy el Sándwich vegetal?', spec, 'x', [], last)).toEqual({ ok: false, reason: 'same_opening' })
    expect(validateGuided('Oye, ¿hiciste hoy el Sándwich vegetal?', spec, 'x', [], last)).toEqual({ ok: true })
  })

  it('the writer sees the recent openings', () => {
    const prompt = guidedUserPrompt(spec, { memory: [], recent: [], previous: [], lastAvisos: ['¡Al lío! Toca empezar.', '¡Ey! Buenos días.'] }, 'x')
    expect(prompt).toContain('<aperturas_recientes>')
    expect(prompt).toContain('- al lio')
    expect(prompt).toContain('- ey')
  })
})
