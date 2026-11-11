/**
 * «Semana tipo» por Mimo (D-182 fase 3): get_week_type y set_week_type_slot.
 * A fake AppApi serves the household's week type and records the PUTs (one
 * per slot, the same route as the profile); the recipes a dish name is
 * searched in are stubbed (the phase-1 search, `optionForDishName`, runs for real).
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../services/matchableRecipes.js', () => ({
  loadMatchableRecipes: vi.fn(async () => [
    { id: 'r-lent', name: 'Lentejas con chorizo', authorId: null, catalogAuditIssues: null },
    { id: 'r-tor1', name: 'Tortilla de patatas', authorId: null, catalogAuditIssues: null },
    { id: 'r-tor2', name: 'Tortilla de patatas con cebolla', authorId: null, catalogAuditIssues: null },
    { id: 'r-piz', name: 'Pizza margarita', authorId: null, catalogAuditIssues: null },
  ]),
}))

import { fullWeekTypeDays, type WeekTypeDays } from '@ona/shared'
import { weekTypeSkills, describeWeekTypeSlot, dayIndexOf, mealOf } from '../services/assistant/weekTypeSkills.js'
import { daysLabel, nextWeekTypeSlot } from '../services/weekType.js'
import { fichaSkills } from '../services/assistant/fichaSkills.js'
import { skills, toolsFor } from '../services/assistant/skills.js'
import { buildSystemParts, WEEK_TYPE_RULE } from '../services/assistant/systemPrompt.js'
import { AppApiError, type AppApi } from '../services/assistant/appApi.js'
import { MIMO_EVAL_CASES, mimoReplyProblems } from '../services/assistant/mimoEvalCases.js'

const get = (name: string) => weekTypeSkills.find((s) => s.name === name)!

function fakeApi(days: WeekTypeDays = fullWeekTypeDays(), opts: { putError?: Error; noHousehold?: boolean } = {}) {
  const calls: { method: string; path: string; body?: any }[] = []
  const api: AppApi = async (method, path, body) => {
    calls.push({ method, path, body })
    if (method === 'GET' && path === '/households/me/week-type') {
      if (opts.noHousehold) throw new AppApiError(404, 'No household')
      return { days } as any
    }
    if (method === 'PUT' && opts.putError) throw opts.putError
    return {} as any
  }
  return { api, calls, puts: () => calls.filter((c) => c.method === 'PUT') }
}
const ctx = (api: AppApi, channel: 'text' | 'whatsapp' = 'whatsapp') => ({ userId: 'u1', db: null, api, channel })
const set = (p: Record<string, unknown>, api: AppApi) => get('set_week_type_slot').handler(p, ctx(api))

describe('set_week_type_slot: lo que dice el usuario, a un hueco', () => {
  it('«los viernes por la noche, pizza» → viernes, cena, el tipo pizza, y lo confirma en una línea', async () => {
    const f = fakeApi()
    const r = await set({ days: ['viernes'], meal: 'dinner', options: [{ kind: 'type', type: 'pizza' }] }, f.api)
    expect(f.puts()).toEqual([{ method: 'PUT', path: '/households/me/week-type/4/dinner', body: { options: [{ kind: 'type', type: 'pizza' }] } }])
    expect(r.summary).toMatch(/^Hecho, en tu semana tipo: viernes, cena, pizza cada semana\./)
  })

  it('accepts the days with accents and the meal in Spanish («sábado», «la cena»)', async () => {
    const f = fakeApi()
    await set({ days: ['Sábado'], meal: 'la cena', options: [{ kind: 'dish', name: 'pizza' }] }, f.api)
    expect(f.puts()[0].path).toBe('/households/me/week-type/5/dinner')
    expect(dayIndexOf('miércoles')).toBe(2)
    expect(mealOf('comida')).toBe('lunch')
    expect(mealOf('cosa')).toBeNull()
  })

  it('«los jueves, una semana ceviche y otra carpaccio» → by turns, both as dish types', async () => {
    const f = fakeApi()
    const r = await set({ days: ['jueves'], meal: 'dinner', options: [{ kind: 'dish', name: 'ceviche' }, { kind: 'dish', name: 'carpaccio' }] }, f.api)
    expect(f.puts()[0].body).toEqual({ options: [{ kind: 'type', type: 'ceviche' }, { kind: 'type', type: 'carpaccio-tartar' }] })
    expect(r.summary).toContain('jueves, cena, una semana ceviche y otra carpaccio y tartar')
  })

  it('«legumbres el sábado, cada dos semanas» → [legumbres, cualquier receta]', async () => {
    const f = fakeApi()
    const r = await set({ days: ['sabado'], meal: 'lunch', options: [{ kind: 'type', type: 'legumbres' }], every: 2 }, f.api)
    expect(f.puts()[0].body).toEqual({ options: [{ kind: 'type', type: 'legumbres' }, { kind: 'any' }] })
    expect(r.summary).toContain('sábado, comida, legumbres cada 2 semanas')
  })

  it('«juntos»: all the options in the same meal', async () => {
    const f = fakeApi()
    const r = await set({ days: ['domingo'], meal: 'lunch', options: [{ kind: 'type', type: 'pasta' }, { kind: 'type', type: 'ensaladas' }], mode: 'together' }, f.api)
    expect(f.puts()[0].body).toEqual({ options: [{ kind: 'type', type: 'pasta' }, { kind: 'type', type: 'ensaladas' }], together: true })
    expect(r.summary).toContain('pasta y ensaladas, en la misma comida')
  })

  it('a recipe by name: exactly one → that recipe; a type name → the type; several or none → written, and says so', async () => {
    const f = fakeApi()
    await set({ days: ['lunes'], meal: 'lunch', options: [{ kind: 'dish', name: 'lentejas con chorizo' }] }, f.api)
    expect(f.puts()[0].body.options).toEqual([{ kind: 'recipe', recipeId: 'r-lent', name: 'Lentejas con chorizo' }])

    const g = fakeApi()
    await set({ days: ['viernes'], meal: 'dinner', options: [{ kind: 'dish', name: 'pizza' }] }, g.api)
    expect(g.puts()[0].body.options).toEqual([{ kind: 'type', type: 'pizza' }])

    const h = fakeApi()
    const r = await set({ days: ['martes'], meal: 'dinner', options: [{ kind: 'dish', name: 'tortilla de patatas' }] }, h.api)
    expect(h.puts()[0].body.options).toEqual([{ kind: 'fixed', label: 'Tortilla de patatas', items: [] }])
    expect(r.summary).toMatch(/«Tortilla de patatas» no es un tipo de plato ni el nombre de una sola receta: sale escrito/)
  })

  it('something fixed with what it has per person', async () => {
    const f = fakeApi(fullWeekTypeDays())
    const items = [{ name: 'yogur natural', quantity: 1, unit: 'u' }]
    await set({ days: ['lunes', 'martes'], meal: 'breakfast', options: [{ kind: 'fixed', name: 'Yogur con cereales', items }] }, f.api)
    // Breakfast was «no hay»: the fixed one turns it on until it goes.
    expect(f.puts().map((c) => c.body)).toEqual([
      { options: [{ kind: 'fixed', label: 'Yogur con cereales', items }], offWhenFree: true },
      { options: [{ kind: 'fixed', label: 'Yogur con cereales', items }], offWhenFree: true },
    ])
  })

  it('a táper where it doesn\'t go writes nothing, for any of the days', async () => {
    for (const p of [
      { days: ['martes'], meal: 'dinner', options: [{ kind: 'taper' }] },
      { days: ['martes', 'lunes'], meal: 'lunch', options: [{ kind: 'taper' }] },
      { days: ['martes'], meal: 'lunch', options: [{ kind: 'taper' }, { kind: 'type', type: 'pasta' }] },
    ]) {
      const f = fakeApi()
      const r = await set(p, f.api)
      expect(r.summary).toMatch(/^No he cambiado nada: El táper/)
      expect(f.puts()).toEqual([])
    }
    const ok = fakeApi()
    await set({ days: ['martes'], meal: 'lunch', options: [{ kind: 'taper' }] }, ok.api)
    expect(ok.puts()[0].body).toEqual({ options: [{ kind: 'taper' }] })
  })

  it('«quita el desayuno del domingo» → «no hay»; already so → nothing written', async () => {
    const days = fullWeekTypeDays()
    days[6].breakfast = { diners: 2 }
    const f = fakeApi(days)
    const r = await set({ days: ['domingo'], meal: 'breakfast', off: true }, f.api)
    expect(f.puts()).toEqual([{ method: 'PUT', path: '/households/me/week-type/6/breakfast', body: { off: true } }])
    expect(r.summary).toContain('domingo, desayuno, no hay')

    const g = fakeApi()
    const same = await set({ days: ['domingo'], meal: 'breakfast', off: true }, g.api)
    expect(same.summary).toMatch(/^Ya estaba así/)
    expect(g.puts()).toEqual([])
  })

  it('«no hay» keeps the options for when it comes back; off=false turns it on again', async () => {
    const days = fullWeekTypeDays()
    days[4].dinner = { options: [{ kind: 'type', type: 'pizza' }], since: '2026-11-09' }
    const f = fakeApi(days)
    await set({ days: ['viernes'], meal: 'dinner', off: true }, f.api)
    expect(f.puts()[0].body).toEqual({ off: true, options: [{ kind: 'type', type: 'pizza' }] })
    expect(nextWeekTypeSlot({ off: true }, { off: false })).toEqual({})
  })

  it('«quita la pizza del viernes» (cualquier receta) leaves it free, or «no hay» if only that turned it on', async () => {
    const days = fullWeekTypeDays()
    days[4].dinner = { options: [{ kind: 'type', type: 'pizza' }], since: '2026-11-09', diners: 3 }
    days[0].breakfast = { options: [{ kind: 'type', type: 'tostadas' }], offWhenFree: true }
    const f = fakeApi(days)
    await set({ days: ['viernes'], meal: 'dinner', options: [{ kind: 'any' }] }, f.api)
    await set({ days: ['lunes'], meal: 'breakfast', options: [{ kind: 'any' }] }, f.api)
    expect(f.puts().map((c) => c.body)).toEqual([{ diners: 3 }, { off: true }])
  })

  it('diners only, the options and their turn as they were', async () => {
    const days = fullWeekTypeDays()
    days[0].dinner = { options: [{ kind: 'type', type: 'pasta' }], since: '2026-11-02' }
    const f = fakeApi(days)
    const r = await set({ days: ['lunes'], meal: 'dinner', diners: 3 }, f.api)
    // `since` is the route's: same options → it keeps it.
    expect(f.puts()[0].body).toEqual({ options: [{ kind: 'type', type: 'pasta' }], diners: 3 })
    expect(r.summary).toContain('lunes, cena, pasta cada semana, para 3')
  })

  it('missing the meal or the day: asks one thing, reads and writes nothing', async () => {
    const f = fakeApi()
    const noMeal = await set({ days: ['jueves'], options: [{ kind: 'dish', name: 'ceviche' }] }, f.api)
    expect(noMeal.summary).toMatch(/falta la comida\. Pregúntale solo eso/)
    const noDay = await set({ meal: 'dinner', options: [{ kind: 'dish', name: 'ceviche' }] }, f.api)
    expect(noDay.summary).toMatch(/falta el día\. Pregúntale solo eso/)
    expect(f.calls).toEqual([])
  })

  it('refusals of the route come back as «No he cambiado nada»; no household says so', async () => {
    const child = fakeApi(fullWeekTypeDays(), { putError: new AppApiError(403, 'La semana tipo la cambian los adultos de la casa.') })
    const r = await set({ days: ['viernes'], meal: 'dinner', options: [{ kind: 'type', type: 'pizza' }] }, child.api)
    expect(r.summary).toBe('No he cambiado nada: La semana tipo la cambian los adultos de la casa.')
    const none = fakeApi(fullWeekTypeDays(), { noHousehold: true })
    const s = await set({ days: ['viernes'], meal: 'dinner', options: [{ kind: 'type', type: 'pizza' }] }, none.api)
    expect(s.summary).toMatch(/no encuentro su hogar/)
  })

  it('«cada N» only with one option, and at most 4 options', () => {
    expect(nextWeekTypeSlot({}, { options: [{ kind: 'type', type: 'pasta' }, { kind: 'type', type: 'arroz' }], every: 2 })).toEqual({ error: '«Cada N semanas» va con una sola opción.' })
    expect(nextWeekTypeSlot({}, { options: Array.from({ length: 5 }, () => ({ kind: 'type' as const, type: 'pasta' })) })).toHaveProperty('error')
  })
})

describe('get_week_type', () => {
  it('says only what differs from lunch and dinner with any recipe', async () => {
    const days = fullWeekTypeDays()
    days[4].dinner = { options: [{ kind: 'type', type: 'pizza' }], since: '2026-11-09' }
    days[3].dinner = { options: [{ kind: 'type', type: 'ceviche' }, { kind: 'type', type: 'carpaccio-tartar' }], since: '2026-11-09' }
    days[6].dinner = { off: true }
    days[0].breakfast = { diners: 2 }
    const r = await get('get_week_type').handler({}, ctx(fakeApi(days).api))
    expect(r.summary.split('\n').slice(1, -1)).toEqual([
      '- lunes, desayuno: cualquier receta, para 2',
      '- jueves, cena: una semana ceviche y otra carpaccio y tartar',
      '- viernes, cena: pizza cada semana',
      '- domingo, cena: no hay',
    ])
    const empty = await get('get_week_type').handler({}, ctx(fakeApi().api))
    expect(empty.summary).toMatch(/^Su semana tipo está sin tocar/)
  })

  it('describes the slots in a few words', () => {
    expect(describeWeekTypeSlot({ options: [{ kind: 'recipe', recipeId: 'r', name: 'Lentejas con chorizo' }, { kind: 'any' }, { kind: 'any' }] })).toBe('«Lentejas con chorizo» cada 3 semanas')
    expect(describeWeekTypeSlot({ options: [{ kind: 'taper' }] })).toBe('táper de la cena cada semana')
    expect(describeWeekTypeSlot({ options: [{ kind: 'type', type: 'pasta' }, { kind: 'type', type: 'arroz' }, { kind: 'type', type: 'pizza' }] })).toBe('por turnos, pasta, arroz y pizza')
    expect(daysLabel([4, 0, 1, 2, 3])).toBe('de lunes a viernes')
    expect(daysLabel([5, 6])).toBe('sábado y domingo')
  })
})

describe('las herramientas viejas y la ficha (D-182 fase 3)', () => {
  it('both tools are on the web and on WhatsApp', () => {
    for (const mode of ['text', 'whatsapp']) {
      const names = toolsFor({ mode }).map((s) => s.name)
      expect(names).toEqual(expect.arrayContaining(['get_week_type', 'set_week_type_slot']))
    }
    expect(skills.filter((s) => s.name === 'set_week_type_slot')).toHaveLength(1)
  })

  it('update_weekly_template and set_fixed_meal point to set_week_type_slot for habits of a day and a meal', () => {
    for (const name of ['update_weekly_template', 'set_fixed_meal']) {
      expect(skills.find((s) => s.name === name)!.description).toContain('set_week_type_slot')
    }
  })

  it('note_ficha_fact no longer writes skipped_meal: it sends Mimo to the week type', async () => {
    const note = fichaSkills.find((s) => s.name === 'note_ficha_fact')!
    expect(note.parameters.properties.type.enum).not.toContain('skipped_meal')
    expect(note.description).toContain('set_week_type_slot')
    expect(note.description).not.toMatch(/skipped_meal|fixed_dish \{dish, days\?, meal\?\}/)
    const f = fakeApi()
    const r = await note.handler({ type: 'skipped_meal', value: { days: ['domingo'], meal: 'breakfast' }, about: 'household' }, ctx(f.api))
    expect(r.summary).toMatch(/set_week_type_slot/)
    expect(f.calls).toEqual([])
  })

  it('the prompt sends habits to the week type, asks one thing when the meal is missing, and leaves tastes in the ficha', () => {
    for (const mode of ['text', 'whatsapp'] as const) {
      expect(buildSystemParts('', mode).instructions).toContain(WEEK_TYPE_RULE)
    }
    expect(WEEK_TYPE_RULE).toMatch(/set_week_type_slot/)
    expect(WEEK_TYPE_RULE).toMatch(/pregunta solo eso/)
    expect(WEEK_TYPE_RULE).toMatch(/nos gusta mucho la pizza[\s\S]*no va a la semana tipo/)
  })
})

describe('banco de Mimo: casos `semana-tipo`', () => {
  const cases = () => MIMO_EVAL_CASES.filter((c) => c.check === 'semana-tipo')
  const byId = (id: string) => MIMO_EVAL_CASES.find((c) => c.id === id)!

  it('has the six cases of the design', () => {
    expect(cases().map((c) => c.message)).toEqual([
      'los viernes por la noche, pizza',
      'los jueves por la noche, una semana ceviche y otra carpaccio',
      'legumbres el sábado, cada dos semanas',
      'quita el desayuno del domingo',
      'nos gusta mucho la pizza',
      'los jueves ceviche',
    ])
  })

  it('every bad reply fails in CI', () => {
    for (const c of cases()) expect(mimoReplyProblems(c.badReply, c), c.id).not.toEqual([])
  })

  it('the tool\'s own confirmation passes; asking the meal passes', () => {
    for (const c of cases().filter((x) => x.toolResults?.set_week_type_slot)) {
      const line = c.toolResults!.set_week_type_slot.split('.')[0] + '.'
      expect(mimoReplyProblems(line, c), c.id).toEqual([])
    }
    expect(mimoReplyProblems('¿En la comida o en la cena?', byId('semana-tipo-falta-comida'))).toEqual([])
    expect(mimoReplyProblems('Apuntado: os gusta mucho la pizza, lo tendré en cuenta en los menús.', byId('semana-tipo-gusto-a-la-ficha'))).toEqual([])
  })

  it('live: the right tool with the right day, meal and options', () => {
    const c = byId('semana-tipo-legumbres-cada-dos')
    const reply = 'Hecho, en tu semana tipo: sábado, comida, legumbres cada 2 semanas.'
    const good = [{ name: 'set_week_type_slot', input: '{"days":["sabado"],"meal":"lunch","options":[{"kind":"type","type":"legumbres"}],"every":2}' }]
    expect(mimoReplyProblems(reply, c, ['set_week_type_slot'], good)).toEqual([])
    const wrongMeal = [{ name: 'set_week_type_slot', input: '{"days":["sabado"],"meal":"dinner","options":[{"kind":"type","type":"legumbres"}],"every":2}' }]
    expect(mimoReplyProblems(reply, c, ['set_week_type_slot'], wrongMeal)).toEqual(['semana-tipo-mal'])
    expect(mimoReplyProblems(reply, c, ['note_ficha_fact'], [])).toEqual(expect.arrayContaining(['no-guarda', 'herramienta-equivocada', 'semana-tipo-mal']))
    const ask = byId('semana-tipo-falta-comida')
    expect(mimoReplyProblems('¿En la comida o en la cena?', ask, ['set_week_type_slot'], [])).toEqual(['herramienta-equivocada'])
  })
})
