/**
 * «Semana tipo» fase 4 (D-182 §4): the sign-up's «¿Algo más? Cuéntanos tu
 * caso» is read by the same AI call as before, which now also returns the
 * habits of a day and a meal. They go into the household's week type with
 * the function behind the PUT route, and the sign-up shows them in «Así lo
 * he entendido» (with the slots as they were, for «Corregir»). The model is
 * simulated here.
 */
import { describe, expect, it } from 'vitest'
import { fullWeekTypeDays, type WeekTypeDays } from '@ona/shared'
import {
  analyzeOnboardingIntoMemory,
  ANALYSIS_SYSTEM_PROMPT,
  habitDaysLabel,
  parseWeekTypeHabits,
  understoodWeekType,
  weekTypeHabitChanges,
  type AnalysisDeps,
} from '../services/onboardingMemoryAnalysis.js'
import type { SlotChange } from '../services/weekType.js'

const USER = '11111111-1111-4111-8111-111111111111'
const WEDNESDAY = new Date('2026-11-11T10:00:00Z')
const MONDAY = '2026-11-09'

function fakeModel(input: Record<string, unknown>) {
  const calls: any[] = []
  const create = async (params: any) => {
    calls.push(params)
    return {
      content: [{ type: 'tool_use', id: 't1', name: 'update_memory', input: { facts: [], ...input } }] as any,
      usage: { input_tokens: 900, output_tokens: 120 } as any,
    }
  }
  return { create, calls }
}

/** An in-memory household week type, written the way `saveWeekTypeSlots` does (whole slots). */
function weekTypeStore(start: WeekTypeDays = fullWeekTypeDays(), householdId: string | null = 'h1') {
  let days = structuredClone(start)
  const saved: SlotChange[] = []
  const deps: AnalysisDeps = {
    readMemory: async () => ({}),
    writeMemory: async () => undefined,
    loadRecipes: async () => [],
    loadWeekType: async () => ({ householdId, days: structuredClone(days) }),
    saveWeekTypeSlots: async (_h, _u, changes) => {
      days = structuredClone(days)
      for (const c of changes) days[c.day][c.meal] = { ...c.slot }
      saved.push(...changes)
    },
    now: WEDNESDAY,
  }
  return { deps, saved, days: () => days }
}

async function analyse(note: string, weekType: unknown[], start?: WeekTypeDays) {
  const { create, calls } = fakeModel({ week_type: weekType })
  const store = weekTypeStore(start)
  const result = await analyzeOnboardingIntoMemory(USER, { adults: 2, kidsCount: 0, cookingStyle: 'daily', cookingNote: note }, { ...store.deps, create })
  return { result, calls, store }
}

describe('«Cuéntanos tu caso» → the semana tipo (D-182 fase 4)', () => {
  it('«los viernes por la noche, pizza» → Friday dinner, pizza every week', async () => {
    const { result, calls, store } = await analyse('los viernes por la noche, pizza', [{ days: [4], meal: 'dinner', dishes: ['Pizza'] }])

    // Same call as before (no new one), with the habits in its tool and its prompt.
    expect(calls).toHaveLength(1)
    expect(calls[0].messages[0].content).toContain('los viernes por la noche, pizza')
    expect(calls[0].tools[0].input_schema.properties.week_type).toBeDefined()
    expect(ANALYSIS_SYSTEM_PROMPT).toContain('pescado una semana sí y otra no')

    expect(store.saved).toEqual([{ day: 4, meal: 'dinner', slot: { options: [{ kind: 'type', type: 'pizza' }], since: MONDAY } }])
    expect(result.keys).toContain('week_type')
    expect(result.weekType).toEqual({
      rows: [{ icon: '🍕', what: 'Pizza', when: 'Viernes · cena · cada semana' }],
      undo: [{ day: 4, meal: 'dinner', slot: {} }],
    })
  })

  it('«legumbres el sábado cada dos semanas» → Saturday lunch, legumbres then any recipe', async () => {
    const { result, store } = await analyse('legumbres el sábado cada dos semanas', [{ days: [5], meal: 'lunch', dishes: ['Legumbres'], every: 2 }])
    expect(store.days()[5].lunch).toEqual({ options: [{ kind: 'type', type: 'legumbres' }, { kind: 'any' }], since: MONDAY })
    expect(result.weekType?.rows).toEqual([{ icon: '🫘', what: 'Legumbres', when: 'Sábado · comida · cada 2 semanas' }])
  })

  it('«la cena del sábado fuera» → no hay cena on Saturday', async () => {
    const { result, store } = await analyse('la cena del sábado fuera', [{ days: [5], meal: 'dinner', off: true }])
    expect(store.days()[5].dinner).toEqual({ off: true })
    expect(result.weekType).toEqual({
      rows: [{ icon: '✕', what: 'No hay', when: 'Sábado · cena' }],
      undo: [{ day: 5, meal: 'dinner', slot: {} }],
    })
  })

  it('a dish that is no type and no recipe is written by its name; turns, together and weekdays read as one row each', async () => {
    const { result, store } = await analyse('varias cosas', [
      { days: [6], meal: 'dinner', dishes: ['sándwich mixto'] },
      { days: [3], meal: 'dinner', dishes: ['Ceviche', 'Carpaccio y tartar'] },
      { days: [0, 1, 2, 3, 4], meal: 'lunch', dishes: ['Pasta', 'Ensaladas'], mode: 'together' },
      { days: [6], meal: 'breakfast', dishes: ['Tostadas'] },
    ])
    expect(store.days()[6].dinner?.options).toEqual([{ kind: 'fixed', label: 'Sándwich mixto', items: [] }])
    // Breakfast was «no hay»: the habit turns it on, and only while it lasts.
    expect(store.days()[6].breakfast).toEqual({ options: [{ kind: 'type', type: 'tostadas' }], since: MONDAY, offWhenFree: true })
    expect(store.days()[0].lunch?.together).toBe(true)
    expect(result.weekType?.rows).toEqual([
      { icon: '🍝', what: 'Pasta + Ensaladas', when: 'De lunes a viernes · comida · en la misma comida' },
      { icon: '🍋', what: 'Ceviche / Carpaccio y tartar', when: 'Jueves · cena · por turnos, una cada semana' },
      { icon: '🍞', what: 'Tostadas', when: 'Domingo · desayuno · cada semana' },
      { icon: '🍽️', what: 'Sándwich mixto', when: 'Domingo · cena · cada semana' },
    ])
    // «Corregir» puts every slot back as it was.
    expect(result.weekType?.undo).toHaveLength(8)
    expect(result.weekType?.undo.find((u) => u.day === 6 && u.meal === 'breakfast')?.slot).toEqual({ off: true })
  })

  it('nothing said with a day and a meal → the week type is never written and there is nothing to show', async () => {
    const { result, store } = await analyse('nos encanta la pizza', [])
    expect(store.saved).toEqual([])
    expect(result.weekType).toBeNull()
  })

  it('without a household nothing is written', async () => {
    const { create } = fakeModel({ week_type: [{ days: [4], meal: 'dinner', dishes: ['Pizza'] }] })
    const store = weekTypeStore(fullWeekTypeDays(), null)
    const result = await analyzeOnboardingIntoMemory(USER, { adults: 1, kidsCount: 0 }, { ...store.deps, create })
    expect(store.saved).toEqual([])
    expect(result.weekType).toBeNull()
  })
})

describe('the habits, pure', () => {
  it('drops malformed habits and keeps the rest', () => {
    expect(
      parseWeekTypeHabits([
        { days: [9], meal: 'dinner', dishes: ['Pizza'] },
        { days: [4], meal: 'brunch', dishes: ['Pizza'] },
        { days: [4], meal: 'dinner' },
        { days: [4, 4, 1], meal: 'dinner', dishes: ['Pizza', ' '], every: 2 },
        { days: [5], meal: 'lunch', dishes: ['A', 'B'], every: 3, mode: 'together' },
        { days: [6], meal: 'dinner', dishes: ['Pizza'], off: true },
      ]),
    ).toEqual([
      { days: [1, 4], meal: 'dinner', dishes: ['Pizza'], together: false, every: 2, off: false },
      { days: [5], meal: 'lunch', dishes: ['A', 'B'], together: true, every: 1, off: false },
      { days: [6], meal: 'dinner', dishes: [], together: false, every: 1, off: true },
    ])
  })

  it('a táper where it cannot go is left out', () => {
    const changes = weekTypeHabitChanges(fullWeekTypeDays(), [{ days: [0], meal: 'lunch', dishes: ['x'], together: false, every: 1, off: false }], () => ({ kind: 'taper' }), MONDAY)
    expect(changes).toEqual([])
  })

  it('diners lowered by «who is away» read as a row too', () => {
    const before = fullWeekTypeDays()
    const after = structuredClone(before)
    for (const d of [0, 1, 2, 3, 4]) after[d].lunch = { diners: 1 }
    expect(understoodWeekType(before, after).rows).toEqual([{ icon: '👥', what: 'Para 1 persona', when: 'De lunes a viernes · comida' }])
  })

  it('days read in Spanish', () => {
    expect(habitDaysLabel([5, 6])).toBe('Sábado y domingo')
    expect(habitDaysLabel([0, 1, 2, 3, 4, 5, 6])).toBe('Todos los días')
    expect(habitDaysLabel([2])).toBe('Miércoles')
  })
})
