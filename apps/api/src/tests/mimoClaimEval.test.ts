/**
 * PRO-349 · a «Hecho» from Mimo only for what a tool confirmed (test
 * households, 2026-10-22): the three cases of `CLAIM_EVAL_CASES`, one per part. Each
 * literal bad reply must fail its grader and a good reply must pass; the live
 * eval (`scripts/evalHealthAnswers.ts`) grades the fresh replies the same way.
 */
import { describe, expect, it } from 'vitest'
import { CLAIM_EVAL_CASES, claimReplyProblems } from '../services/assistant/mimoClaimEvalCases.js'

const byId = (id: string) => CLAIM_EVAL_CASES.find((c) => c.id === id)!

describe('PRO-349 evaluation cases', () => {
  it('one case per part of the task', () => {
    expect(CLAIM_EVAL_CASES.map((c) => [c.id, c.check])).toEqual([
      ['arroz-dia-sin-cocinar', 'dia-sin-cocinar'],
      ['cilantro-butter-chicken', 'hecho-confirmado'],
      ['pan-receta-de-hoy', 'receta-del-menu'],
    ])
  })

  describe('dia-sin-cocinar (Dani y Sara)', () => {
    const c = byId('arroz-dia-sin-cocinar')
    it('the literal «Hecho» fails: it never says the skipped day is active again', () => {
      expect(claimReplyProblems(c.badReply, c)).toEqual(['sin-reactivar'])
    })
    it('a reply that relays the reactivation passes, and only after a tool put the dish', () => {
      const good = 'Listo: arroz de limpieza para comer el sábado 24. Ese día estaba marcado sin cocinar y ya vuelve a estar activo.'
      expect(claimReplyProblems(good, c, ['swap_meal'])).toEqual([])
      expect(claimReplyProblems(good, c, [])).toEqual(['no-usa-herramienta'])
    })
  })

  describe('hecho-confirmado (Laura)', () => {
    const c = byId('cilantro-butter-chicken')
    it('the literal «Hecho» fails: the recipe tool changed nothing', () => {
      expect(claimReplyProblems(c.badReply, c)).toEqual(['hecho-sin-confirmar'])
    })
    it('passes when it says what was done and what was not, or when the change was confirmed', () => {
      const honest = 'He apuntado que no te gusta el cilantro. El butter chicken es del catálogo y no lo he cambiado: ¿lo copio a tus recetas y le quito el cilantro?'
      expect(claimReplyProblems(honest, c, ['update_memory', 'edit_recipe'], c.badTrace)).toEqual([])
      const fixed = [...c.badTrace!, { name: 'update_recipe_notes', input: '{"recipeName":"butter chicken","substitutions":"sin cilantro"}', summary: 'Hecho: guardado en "Butter chicken" (receta del catalogo de Mimoia) — sustituciones.' }]
      expect(claimReplyProblems('Hecho: apuntado en el butter chicken que va sin cilantro.', c, ['update_recipe_notes'], fixed)).toEqual(
        // edit_recipe failed and nothing fixed edit_recipe itself: the «Hecho» still needs saying what wasn't done.
        ['hecho-sin-confirmar'],
      )
      expect(claimReplyProblems('Hecho: apuntado en el butter chicken que va sin cilantro.', c, ['update_recipe_notes'], fixed.slice(2))).toEqual([])
    })
  })

  describe('receta-del-menu (Carmen y Antonio)', () => {
    const c = byId('pan-receta-de-hoy')
    it('the literal reply fails: it answered from another recipe', () => {
      expect(claimReplyProblems(c.badReply, c)).toEqual(['no-confirma', 'frase-prohibida'])
    })
    it('reading the menu recipe (day/meal or its name) passes; reading another one fails', () => {
      const good = 'Sí, lleva 60 g de pan del día anterior, frito y majado con el ajo. Si no te queda, sirve un puñado de almendras fritas.'
      const byDay = [{ name: 'get_recipe_details', input: '{"day":"hoy","meal":"lunch"}' }]
      const byName = [{ name: 'get_recipe_details', input: '{"recipeName":"Espinacas con garbanzos a la sevillana"}' }]
      const other = [{ name: 'get_recipe_details', input: '{"recipeName":"Garbanzos con espinacas y huevo"}' }]
      expect(claimReplyProblems(good, c, ['get_recipe_details'], byDay)).toEqual([])
      expect(claimReplyProblems(good, c, ['get_recipe_details'], byName)).toEqual([])
      expect(claimReplyProblems(good, c, ['get_recipe_details'], other)).toEqual(['otra-receta'])
      expect(claimReplyProblems(good, c, [], [])).toEqual(['no-usa-herramienta'])
    })
  })
})
