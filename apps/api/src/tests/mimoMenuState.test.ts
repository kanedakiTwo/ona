/**
 * PRO-101: Mimo confirms or denies a change by reading the saved menu, not
 * its memory of the turn. The test households (2026-10-14 to 2026-10-17) got
 * «Antes te dije que lo había ajustado, pero este turno no veo que lo
 * guardara», «No hice ningún cambio… me lo inventé», «el menú no me muestra
 * cuántos comensales hay» (with «Solo hoy: 4» in the app) and a Sunday reply
 * that judged next week by this week's menu.
 */
import { describe, expect, it } from 'vitest'
import { buildSystemParts, MENU_STATE_RULE } from '../services/assistant/systemPrompt.js'
import { mealLinesForDay } from '../services/menuText.js'
import { MIMO_EVAL_CASES, mimoReplyProblems } from '../services/assistant/mimoEvalCases.js'

describe('the prompt makes the saved menu the source of truth', () => {
  for (const mode of ['text', 'voice', 'whatsapp'] as const) {
    it(`${mode}: the rule is in the cached instructions, not the user context`, () => {
      const { instructions, context } = buildSystemParts('ctx', mode)
      expect(instructions).toContain(MENU_STATE_RULE)
      expect(context).not.toContain(MENU_STATE_RULE)
    })
  }

  it('says to check the saved menu before confirming, denying or correcting a change', () => {
    expect(MENU_STATE_RULE).toMatch(/lo dice el menu guardado, no tu memoria/)
    expect(MENU_STATE_RULE).toMatch(/Antes de confirmar, negar o corregir un cambio \(de este turno o de antes\)/)
    expect(MENU_STATE_RULE).toMatch(/sin decir que no lo hiciste/)
  })

  it('sends next week to get_weekly_menu / get_todays_menu instead of this week\'s block', () => {
    expect(MENU_STATE_RULE).toMatch(/solo la semana en curso/)
    expect(MENU_STATE_RULE).toMatch(/get_weekly_menu \(nextWeek\)/)
  })
})

describe('the menu Mimo reads shows the diners set by hand', () => {
  it('a slot with servings says [solo hoy: N]; one without, nothing', () => {
    const day = {
      lunch: { servings: 4, dishes: [{ kind: 'recipe' as const, recipeId: 'r1', recipeName: 'Lentejas estofadas' }] },
      dinner: { servings: null, dishes: [{ kind: 'recipe' as const, recipeId: 'r2', recipeName: 'Tortilla de patatas' }] },
    }
    expect(mealLinesForDay(day)).toEqual(['comida [solo hoy: 4]: Lentejas estofadas', 'cena: Tortilla de patatas'])
  })
})

describe('battery: a change from an earlier turn is not taken back', () => {
  it('has the cases of the test households', () => {
    expect(MIMO_EVAL_CASES.filter((c) => c.check === 'menu-guardado').map((c) => c.id)).toEqual([
      'comensales-turno-anterior',
      'semana-que-viene-domingo',
    ])
  })

  it('the earlier turn of the servings case carries the trace of the change and the menu shows it', () => {
    const c = MIMO_EVAL_CASES.find((x) => x.id === 'comensales-turno-anterior')!
    expect(c.history.at(-1)!.content).toMatch(/^⟦hecho: set_meal_servings/)
    expect(c.context).toContain('comida [solo hoy: 4]: Lentejas estofadas')
  })

  for (const c of MIMO_EVAL_CASES.filter((x) => x.check === 'menu-guardado')) {
    it(`${c.id}: the reply Mimo gave fails`, () => {
      expect(mimoReplyProblems(c.badReply, c)).toContain('niega-lo-hecho')
    })
  }

  it('a reply that reads the saved menu passes', () => {
    const [servings, nextWeek] = MIMO_EVAL_CASES
    expect(mimoReplyProblems('Sí, las lentejas del jueves 15 están para 4.', servings)).toEqual([])
    expect(
      mimoReplyProblems('Sí: de lunes 19 a jueves 22 tenéis lentejas estofadas, el lunes recién hechas y el resto en táper.', nextWeek, ['get_weekly_menu']),
    ).toEqual([])
  })

  it('the live eval flags a reply that never looked at next week', () => {
    const nextWeek = MIMO_EVAL_CASES.find((x) => x.id === 'semana-que-viene-domingo')!
    expect(mimoReplyProblems('Sí, tenéis lentejas de lunes a jueves.', nextWeek, [])).toEqual(['no-mira-menu'])
  })
})
