/**
 * PRO-1293 (Mimo's history, 2026-11-23, finding G): when the household said
 * it had eaten, or would eat, something other than the menu's dish, Mimo
 * created one or two estimated recipes and swapped the dish (16–60 s and
 * 0,22–0,33 € a turn); the one time it wrote a note, 9 s and 0,035 €. What
 * was eaten or improvised goes in that meal as text; a recipe only when asked.
 */
import { describe, expect, it } from 'vitest'
import { skills } from '../services/assistant/skills.js'
import { markEatenAsNote } from '../services/assistant/appSkills.js'
import type { AppApi } from '../services/assistant/appApi.js'
import { madridWeekStart } from '../services/madridTime.js'
import { buildSystemParts, IMPROVISED_MEAL_RULE } from '../services/assistant/systemPrompt.js'
import { MIMO_EVAL_CASES, improvisedMealProblems, mimoReplyProblems } from '../services/assistant/mimoEvalCases.js'

const MENU = {
  id: 'm1',
  days: [
    {},
    { dinner: { dishes: [{ kind: 'recipe', recipeId: 'r-mer', recipeName: 'Merluza en salsa verde' }] } },
    {}, {}, {}, {}, {},
  ],
}

function fakeApi() {
  const calls: { method: string; path: string; body?: unknown }[] = []
  const api: AppApi = async (method, path, body) => {
    calls.push({ method, path, body })
    return (method === 'GET' ? MENU : {}) as any
  }
  return { api, calls }
}
const ctx = (api: AppApi) => ({ userId: 'u1', db: null as any, api })
const writes = (calls: { method: string }[]) => calls.filter((c) => c.method !== 'GET')
const markMealEaten = skills.find((s) => s.name === 'mark_meal_eaten')!
const setMealNote = skills.find((s) => s.name === 'set_meal_note')!

describe('mark_meal_eaten takes what they ate instead, as free text', () => {
  it('has a dish parameter and says no recipe is created', () => {
    expect(Object.keys((markMealEaten.parameters as any).properties)).toContain('dish')
    expect(markMealEaten.description).toMatch(/sin crear receta/)
  })

  it('«al final cenamos tortilla»: the dinner becomes a note, marked eaten; the merluza is named as not made', async () => {
    const f = fakeApi()
    const r = await markMealEaten.handler({ dayIndex: 1, meal: 'dinner', eaten: true, dish: 'tortilla de patatas' }, ctx(f.api))
    expect(f.calls[0]).toEqual({ method: 'GET', path: `/menu/u1/${madridWeekStart()}`, body: undefined })
    expect(writes(f.calls)).toEqual([
      { method: 'DELETE', path: '/menu/m1/day/1/meal/dinner', body: undefined },
      { method: 'POST', path: '/menu/m1/day/1/meal/dinner/dish', body: { kind: 'note', text: 'Tortilla de patatas' } },
      { method: 'PATCH', path: '/menu/m1/day/1/meal/dinner', body: { eaten: true } },
    ])
    expect(r.summary).toMatch(/^Hecho: la cena del martes \d+ de \w+ queda como "Tortilla de patatas", marcada como comida\./)
    expect(r.summary).toContain('("Merluza en salsa verde") no se ha hecho: ofrece, en una sola pregunta, ponerlo otro dia.')
  })

  it('an empty slot gets the note too (nothing to delete, nothing to offer)', async () => {
    const f = fakeApi()
    const r = await markEatenAsNote(ctx(f.api), { dayIndex: 2, meal: 'lunch', dish: 'bocadillos' })
    expect(writes(f.calls).map((c) => c.method)).toEqual(['POST', 'PATCH'])
    expect(r.summary).not.toMatch(/no se ha hecho/)
  })

  it('validates the meal and writes nothing', async () => {
    const f = fakeApi()
    const r = await markEatenAsNote(ctx(f.api), { dayIndex: 1, meal: 'brunch', dish: 'pizza' })
    expect(r.summary).toMatch(/meal debe ser/)
    expect(writes(f.calls)).toEqual([])
  })

  it('set_meal_note names the dishes it took off', async () => {
    const f = fakeApi()
    const r = await setMealNote.handler({ dayIndex: 1, meal: 'dinner', text: 'Pizza pedida' }, ctx(f.api))
    expect(r.summary).toMatch(/queda como "Pizza pedida" \(he quitado "Merluza en salsa verde"\)/)
  })
})

describe('the rule: improvised meals as text, a recipe only when asked', () => {
  it('goes in the instructions when mark_meal_eaten or set_meal_note are in the turn', () => {
    const withTools = buildSystemParts('', 'whatsapp', { tools: new Set(['mark_meal_eaten', 'set_meal_note']), about: false }).instructions
    expect(withTools).toContain(IMPROVISED_MEAL_RULE)
    const without = buildSystemParts('', 'whatsapp', { tools: new Set(['get_todays_menu']), about: false }).instructions
    expect(without).not.toContain(IMPROVISED_MEAL_RULE)
  })

  it('says text, no recipe unless asked, and one question to move the dish', () => {
    expect(IMPROVISED_MEAL_RULE).toMatch(/mark_meal_eaten con dish/)
    expect(IMPROVISED_MEAL_RULE).toMatch(/Nunca crees una receta para eso \(ni create_recipe ni newRecipe/)
    expect(IMPROVISED_MEAL_RULE).toMatch(/solo si te piden guardarla/)
    expect(IMPROVISED_MEAL_RULE).toMatch(/otro dia en una sola pregunta/)
  })

  it('the tool descriptions say the same', () => {
    expect(skills.find((s) => s.name === 'create_recipe')!.description).toMatch(/No la uses para lo que ya han comido o improvisan/)
    expect(setMealNote.description).toMatch(/lo que improvisan para hoy/)
  })
})

describe('battery: comida-improvisada (PRO-1293)', () => {
  const cases = MIMO_EVAL_CASES.filter((c) => c.check === 'comida-improvisada')

  it('has the three cases: tortilla and pizza without a recipe, the lentils saved', () => {
    expect(cases.map((c) => c.id)).toEqual(['cenamos-tortilla-nota', 'pedimos-pizza-nota', 'lentejas-guardamela'])
    expect(cases.map((c) => c.keepsRecipe === true)).toEqual([false, false, true])
  })

  for (const c of MIMO_EVAL_CASES.filter((x) => x.check === 'comida-improvisada')) {
    it(`${c.id}: the bad reply fails`, () => {
      expect(mimoReplyProblems(c.badReply, c)).not.toEqual([])
    })
  }

  it('a good reply passes: the note, and one offer of another day', () => {
    const tortilla = cases[0]
    const good = 'Hecho:\n- Martes 24, cena: Tortilla de patatas, apuntada como comida.\n¿Te pongo la merluza en salsa verde otro día? [[opciones: Sí | No]]'
    expect(mimoReplyProblems(good, tortilla)).toEqual([])
    const trace = [{ name: 'mark_meal_eaten', input: '{"day":"hoy","meal":"dinner","eaten":true,"dish":"Tortilla de patatas"}' }]
    expect(mimoReplyProblems(good, tortilla, ['mark_meal_eaten'], trace)).toEqual([])
  })

  it('live: a recipe created (create_recipe or newRecipe) or nothing written fails', () => {
    const good = '¿Pongo la merluza otro día?'
    expect(improvisedMealProblems(good, {}, [{ name: 'create_recipe', input: '{"name":"Pizza"}' }, { name: 'set_meal_note', input: '{}' }])).toEqual(['crea-receta'])
    expect(improvisedMealProblems(good, {}, [{ name: 'swap_meal', input: '{"recipeName":"Pizza","newRecipe":{}}' }])).toEqual(['crea-receta', 'no-apunta'])
    expect(improvisedMealProblems(good, {}, [{ name: 'mark_meal_eaten', input: '{"eaten":true}' }])).toEqual(['no-apunta'])
    expect(improvisedMealProblems('Apuntado. ¿Pongo la merluza otro día? ¿Y el jueves?', {}, [])).toContain('dos-preguntas')
  })

  it('«guárdamela»: create_recipe is due', () => {
    const lentejas = cases[2]
    expect(improvisedMealProblems('Hecho: receta guardada.', lentejas, [{ name: 'create_recipe', input: '{"name":"Lentejas con chorizo"}' }])).toEqual([])
    expect(improvisedMealProblems('Apuntado.', lentejas, [{ name: 'mark_meal_eaten', input: '{"dish":"lentejas"}' }])).toEqual(['no-guarda-receta'])
    expect(mimoReplyProblems('Hecho: he guardado la receta "Lentejas con chorizo" en tus recetas.', lentejas)).toEqual([])
  })
})
