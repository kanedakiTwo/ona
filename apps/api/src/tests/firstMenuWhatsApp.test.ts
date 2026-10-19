/**
 * PRO-244: the WhatsApp sign-up (complete_onboarding) builds the same first
 * menu as the web: it starts today (days already gone are not generated)
 * and, Friday to Sunday, next week comes too (PRO-65 — on 17-oct a Saturday
 * sign-up got only the week of the 12th, Monday to Friday included).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const generateCalls: { weekStart: string; skipped: number[] }[] = []

vi.mock('../services/onboarding.js', () => ({ saveOnboarding: vi.fn(async () => ({ id: 'u1' })) }))
vi.mock('../services/menuGenerator.js', async (orig) => ({
  ...(await orig<any>()),
  generateMenu: vi.fn(async (_u: string, weekStart: string, _t: unknown, _db: unknown, _l: unknown, _d: unknown, _b: unknown, skipped?: Set<number>) => {
    generateCalls.push({ weekStart, skipped: [...(skipped ?? [])].sort() })
    const days = Array.from({ length: 7 }, (_, i) =>
      skipped?.has(i) ? {} : { lunch: { dishes: [{ kind: 'recipe', recipeId: `r${i}`, recipeName: `Plato ${i}` }] } },
    )
    return { days, warnings: [] }
  }),
}))
vi.mock('../services/menuWeek.js', async (orig) => ({
  ...(await orig<any>()),
  loadPreviousWeek: vi.fn(async () => ({ days: undefined, locked: {}, bannedRecipeIds: new Set(), skippedDays: new Set() })),
}))
vi.mock('../services/scopeResolver.js', async (orig) => ({ ...(await orig<any>()), getPrimaryHouseholdId: vi.fn(async () => null) }))
vi.mock('../services/calorieCalculator.js', async (orig) => ({ ...(await orig<any>()), calculateMenuCaloriesFromDB: vi.fn(async () => 0) }))
vi.mock('../services/nutrientCalculator.js', async (orig) => ({ ...(await orig<any>()), calculateMenuNutrientsFromDB: vi.fn(async () => ({})) }))
vi.mock('../services/nutrientBalance.js', async (orig) => ({ ...(await orig<any>()), updateBalance: vi.fn(async () => undefined) }))
vi.mock('../services/notificationScheduler.js', async (orig) => ({ ...(await orig<any>()), enqueuePrepAlertsForMenu: vi.fn(async () => undefined) }))
vi.mock('../services/menuFit.js', async (orig) => ({
  ...(await orig<any>()),
  evaluateAndSaveMenuFit: vi.fn(async () => null),
  menuFitSummary: vi.fn(() => null),
}))

const { skills } = await import('../services/assistant/skills.js')
const completeOnboarding = skills.find((s) => s.name === 'complete_onboarding')!

function fakeDb() {
  const saved: any[] = []
  return {
    saved,
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ onboardingDone: false }] }) }) }),
    insert: () => ({
      values: (row: any) => {
        const p: any = Promise.resolve(undefined)
        p.returning = async () => {
          const menu = { id: `m-${row.weekStart}`, ...row }
          saved.push(menu)
          return [menu]
        }
        return p
      },
    }),
  }
}

const answers = { adults: 2, kidsCount: 0, cookingFreq: 'daily', favoriteDishes: ['lentejas'] }

describe('complete_onboarding — first menu from today (PRO-244)', () => {
  beforeEach(() => {
    generateCalls.length = 0
    vi.useFakeTimers({ toFake: ['Date'] })
  })
  afterEach(() => vi.useRealTimers())

  it('a Wednesday sign-up: this week only, Monday and Tuesday not generated', async () => {
    vi.setSystemTime(new Date('2026-10-14T16:00:00Z')) // miércoles 14, 18:00 Madrid
    const db = fakeDb()
    const r = await completeOnboarding.handler(answers, { userId: 'u1', db } as any)
    expect(generateCalls).toEqual([{ weekStart: '2026-10-12', skipped: [0, 1] }])
    expect(db.saved).toHaveLength(1)
    // Past days are left without dishes, and are NOT stored as «sin cocinar».
    expect(db.saved[0].days[0]).toEqual({})
    expect(db.saved[0].days[2].lunch.dishes).toHaveLength(1)
    expect(db.saved[0].skippedDays).toEqual([])
    expect((r.data as any).weekStart).toBe('2026-10-12')
    expect(r.summary).toMatch(/Empieza hoy \(miercoles\)/)
  })

  it('a Saturday sign-up: Saturday and Sunday of this week, plus the whole next week', async () => {
    vi.setSystemTime(new Date('2026-10-17T09:00:00Z')) // sábado 17, 11:00 Madrid
    const db = fakeDb()
    const r = await completeOnboarding.handler(answers, { userId: 'u1', db } as any)
    expect(generateCalls).toEqual([
      { weekStart: '2026-10-12', skipped: [0, 1, 2, 3, 4] },
      { weekStart: '2026-10-19', skipped: [] },
    ])
    expect(db.saved.map((m) => m.weekStart)).toEqual(['2026-10-12', '2026-10-19'])
    // The reply (and the WhatsApp picture) is this week, from today.
    expect((r.data as any).weekStart).toBe('2026-10-12')
    expect(r.summary).toMatch(/semana que viene/)
  })
})
