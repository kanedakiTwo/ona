/**
 * Mimo's brain overhaul (2026-10-12), after the diagnosis of 2026-10-11:
 * replaying 9 real WhatsApp turns, Haiku 4.5 failed 7. Pins the pieces that
 * aren't the model itself: prep alerts checked before they go out, dishes
 * matched by all their words, memory lists merged, tools per channel, a trace
 * of what each tool did in history, the review seeing that trace, and a
 * cacheable prompt.
 */
import { describe, expect, it } from 'vitest'
import { parsePrepKey, prepAlertStaleReason } from '../services/notificationScheduler.js'
import { namesAllWords, mergeMemoryFacts, toolsFor, recipeDetailsSummary } from '../services/assistant/skills.js'
import { buildChatHistory, traceLine } from '../services/whatsapp/history.js'
import { buildTranscripts } from '../services/whatsapp/reviewer.js'
import { buildSystemParts } from '../services/assistant/systemPrompt.js'

const MENU = '7975e19a-ef82-4733-a548-9fbc836e736d'
const ING = '11111111-2222-3333-4444-555555555555'
const KEY = `menu:${MENU}:day:5:meal:dinner:ing:${ING}:method:thaw_24h`
const days = (dinnerRecipe: string | null) => {
  const d: any[] = [{}, {}, {}, {}, {}, {}, {}]
  if (dinnerRecipe) d[5] = { dinner: { dishes: [{ kind: 'recipe', recipeId: dinnerRecipe, recipeName: 'Gambas al ajillo' }] } }
  return d
}

describe('prep alerts are checked against the current menu before they go out', () => {
  it('parses the prep key and ignores other alerts', () => {
    expect(parsePrepKey(KEY)).toEqual({ menuId: MENU, dayIndex: 5, meal: 'dinner', ingredientId: ING })
    expect(parsePrepKey('whatsapp:daily_brief:2026-10-12')).toBeNull()
  })

  it('still valid: same menu, dish still there and uses the ingredient', () => {
    expect(prepAlertStaleReason(parsePrepKey(KEY)!, { latestMenuId: MENU, days: days('r-gambas'), skippedDays: [], recipeIdsWithIngredient: new Set(['r-gambas']) })).toBeNull()
  })

  it('cancelled when the week was regenerated (2026-10-11 «atún» for a menu replaced the day before)', () => {
    expect(prepAlertStaleReason(parsePrepKey(KEY)!, { latestMenuId: 'otro-menu', days: days('r-gambas'), skippedDays: [], recipeIdsWithIngredient: new Set(['r-gambas']) }))
      .toMatch(/vuelto a generar/)
  })

  it('cancelled when the day is marked sin cocinar (2026-10-10 «costillas» on a skipped Sunday)', () => {
    expect(prepAlertStaleReason(parsePrepKey(KEY)!, { latestMenuId: MENU, days: days('r-gambas'), skippedDays: [5], recipeIdsWithIngredient: new Set(['r-gambas']) }))
      .toMatch(/sin cocinar/)
  })

  it('cancelled when the dish was swapped, moved or turned into a note', () => {
    expect(prepAlertStaleReason(parsePrepKey(KEY)!, { latestMenuId: MENU, days: days('r-otra'), skippedDays: [], recipeIdsWithIngredient: new Set() }))
      .toMatch(/ya no está/)
    expect(prepAlertStaleReason(parsePrepKey(KEY)!, { latestMenuId: MENU, days: days(null), skippedDays: [], recipeIdsWithIngredient: new Set() }))
      .toMatch(/ya no está/)
  })

  it('cancelled when the menu is gone', () => {
    expect(prepAlertStaleReason(parsePrepKey(KEY)!, { latestMenuId: null, days: [], skippedDays: [], recipeIdsWithIngredient: new Set() })).toMatch(/no existe/)
  })
})

describe('swap_meal: a recipe that contains every word the user said is THE recipe', () => {
  it('matches all meaningful words, singular or plural', () => {
    expect(namesAllWords('Hamburguesa perfecta de Gipsy Chef', 'hamburguesa Gipsy Chef')).toBe(true)
    expect(namesAllWords('Lentejas estofadas', 'las lentejas')).toBe(true)
    expect(namesAllWords('Tomates rellenos', 'tomate relleno')).toBe(true)
    expect(namesAllWords('Entrecot a la plancha', 'filete de vaca')).toBe(false)
    expect(namesAllWords('Hamburguesa de pollo', 'hamburguesa Gipsy Chef')).toBe(false)
  })
})

describe('update_memory merges lists and respects what the user set by hand', () => {
  it('adds to a stored list instead of replacing it, without duplicates', () => {
    const r = mergeMemoryFacts({ dislikes: { value: ['cilantro', 'hígado'], source: 'inferred' } }, [{ key: 'dislikes', value: ['coles de Bruselas', 'Cilantro'] }])
    expect(r.facts).toEqual([{ key: 'dislikes', value: ['cilantro', 'hígado', 'coles de Bruselas'], confidence: 0.8 }])
  })

  it('removes items only when asked (2026-10-06: «yo sí como vacuno»)', () => {
    const r = mergeMemoryFacts({ dislikes: { value: ['vacuno', 'cilantro'], source: 'inferred' } }, [{ key: 'dislikes', value: [], remove: ['Vacuno'], confidence: 1 }])
    expect(r.facts[0].value).toEqual(['cilantro'])
  })

  it('replace: true rebuilds the list', () => {
    const r = mergeMemoryFacts({ notes: { value: ['a', 'b'], source: 'inferred' } }, [{ key: 'notes', value: ['c'], replace: true }])
    expect(r.facts[0].value).toEqual(['c'])
  })

  it('an inference never overwrites a fact the user set by hand; an explicit request does', () => {
    const current = { weekly_budget_eur: { value: 120, source: 'manual' } }
    expect(mergeMemoryFacts(current, [{ key: 'weekly_budget_eur', value: 80 }])).toEqual({ facts: [], keptManual: ['weekly_budget_eur'] })
    expect(mergeMemoryFacts(current, [{ key: 'weekly_budget_eur', value: 80, confidence: 1 }]).facts).toEqual([{ key: 'weekly_budget_eur', value: 80, confidence: 1 }])
  })
})

describe('tools per channel', () => {
  const names = (opts: Parameters<typeof toolsFor>[0]) => toolsFor(opts).map((t) => t.name)
  it('hides the in-app cooking controls on WhatsApp and the sign-up tool once onboarded', () => {
    expect(names({ mode: 'whatsapp' })).not.toContain('set_timer')
    expect(names({ mode: 'whatsapp' })).not.toContain('cooking_step')
    expect(names({ mode: 'whatsapp' })).not.toContain('complete_onboarding')
    expect(names({ mode: 'whatsapp', onboarding: true })).toContain('complete_onboarding')
    expect(names({ mode: 'text' })).toContain('set_timer')
    expect(names({ mode: 'whatsapp' })).toContain('get_recipe_details')
  })
})

describe('get_recipe_details text', () => {
  it('stays bounded for very long recipes', () => {
    const s = recipeDetailsSummary({ name: 'Larga', ingredients: [], steps: Array.from({ length: 40 }, (_, i) => `Paso largo ${i} `.repeat(30)) })
    expect(s.length).toBeLessThanOrEqual(4000)
  })
})

describe('history carries what each tool did (⟦hecho: …⟧)', () => {
  const at = (m: number) => new Date(Date.UTC(2026, 9, 10, 8, m))
  const trace = [{ name: 'swap_meal', input: '{"dayIndex":2,"meal":"dinner","recipeName":"Ceviche"}', summary: 'Hecho. He puesto "Ceviche" en la cena del miércoles.' }]

  it('puts the trace of a user turn in front of the reply it produced', () => {
    const h = buildChatHistory(
      [
        { direction: 'in', kind: 'audio', body: 'En vez de tortilla pon ceviche', status: 'processed', createdAt: at(0), meta: { toolTrace: trace } },
        { direction: 'out', kind: 'reply', body: 'Hecho:\n- Miércoles cena: Ceviche', status: 'sent', createdAt: at(1) },
      ],
      at(5),
    )
    expect(h[1].content).toMatch(/^⟦hecho: swap_meal .*Ceviche.*⟧\nHecho:/s)
  })

  it('no trace, no mark; proactive messages never get one', () => {
    expect(traceLine({ tools: [] })).toBeNull()
    expect(traceLine(null)).toBeNull()
    const h = buildChatHistory(
      [
        { direction: 'out', kind: 'daily_brief', body: 'Buenos días. Hoy toca lentejas', status: 'sent', createdAt: at(0) },
        { direction: 'in', kind: 'text', body: 'vale', status: 'processed', createdAt: at(1), meta: { toolTrace: [] } },
        { direction: 'out', kind: 'reply', body: 'Perfecto', status: 'sent', createdAt: at(2) },
      ],
      at(5),
    )
    expect(h.map((m) => m.content).join('\n')).not.toContain('⟦')
  })

  it('stays bounded however many tools ran', () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ name: `tool_${i}`, input: '{}', summary: 'x'.repeat(400) }))
    expect(traceLine({ toolTrace: many })!.length).toBeLessThanOrEqual(1300)
  })
})

describe('daily review sees what tools got and returned', () => {
  it('lists each tool step under the turn', () => {
    const [t] = buildTranscripts([
      { phone: '34600000000', userId: 'u1', username: 'miguel', direction: 'in', kind: 'text', body: 'el de catálogo está bien', status: 'processed', errorMessage: null, createdAt: new Date('2026-10-10T08:40:45Z'), meta: { tools: ['swap_meal'], ms: 1400, toolTrace: [{ name: 'swap_meal', input: '{"recipeName":"Ceviche"}', summary: 'Hecho. He puesto "Ceviche"' }] } } as any,
    ])
    expect(t).toContain('· swap_meal {"recipeName":"Ceviche"} → Hecho. He puesto "Ceviche"')
  })
})

describe('the prompt is split so the instructions can be cached', () => {
  it('keeps the per-user data (date, time, menu) out of the cached instructions', () => {
    const { instructions, context } = buildSystemParts('Hoy es lunes 2026-10-12 (dayIndex 0), son las 20:43 en Madrid.', 'whatsapp')
    expect(instructions).not.toContain('20:43')
    expect(context).toContain('20:43')
    expect(buildSystemParts('otra hora 09:00', 'whatsapp').instructions).toBe(instructions)
  })
})
