/**
 * PRO-1298: one request, one menu (specs/menus.md, specs/whatsapp.md).
 *
 *   - two requests at once for the same week: one generation, one menu;
 *   - a request sent before the week's menu was made (it waited behind the
 *     slow turn that made it): no second menu, even with replaceExisting;
 *   - a tapped button makes a whole week only if it, or the question it
 *     answered, asks for one.
 *
 * Same mock db as assistant-skills.test.ts: one canned response per query.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { skills } from '../services/assistant/skills.js'
import { askedBeforeMenu, buttonAsksForWeek, claimMenuGeneration } from '../services/menuRequestGuard.js'

vi.mock('../services/menuGenerator.js', () => ({
  generateMenu: vi.fn(async () => ({ days: [{}, {}, {}, {}, {}, {}, {}], warnings: [] })),
}))
vi.mock('../services/calorieCalculator.js', () => ({ calculateMenuCaloriesFromDB: vi.fn(async () => 0) }))
vi.mock('../services/nutrientCalculator.js', () => ({ calculateMenuNutrientsFromDB: vi.fn(async () => ({})) }))
vi.mock('../services/nutrientBalance.js', () => ({ updateBalance: vi.fn(async () => {}) }))
vi.mock('../services/notificationScheduler.js', () => ({ enqueuePrepAlertsForMenu: vi.fn(async () => ({ inserted: 0, skipped: 0 })) }))
vi.mock('../services/userMemoryStore.js', () => ({ getMemoryForUser: vi.fn(async () => ({})) }))
vi.mock('../services/saidRestrictions.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/saidRestrictions.js')>()),
  loadRecentUserTexts: vi.fn(async () => [] as string[]),
}))
vi.mock('../services/menuFit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/menuFit.js')>()),
  evaluateAndSaveMenuFit: vi.fn(async () => null),
}))
vi.mock('../services/scopeResolver.js', () => ({
  resolveScope: vi.fn(async (userId: string) => ({ kind: 'user', value: userId })),
  scopeWhere: vi.fn(() => ({})),
  getPrimaryHouseholdId: vi.fn(async () => null),
}))

const generate = skills.find((s) => s.name === 'generate_weekly_menu')!

/** Proxy db: every awaited query takes the next canned response; `inserts` counts the `.insert(…)` calls. */
function makeDb(...responses: any[]) {
  const queue = [...responses]
  const seen = { inserts: 0 }
  const node: any = new Proxy({}, {
    get(_, prop) {
      if (prop === 'then') {
        return (resolve: any, reject?: any) =>
          queue.length === 0 ? (reject ?? Promise.reject.bind(Promise))(new Error('mockDb: queue empty')) : Promise.resolve(queue.shift()).then(resolve, reject)
      }
      if (prop === 'insert') return () => { seen.inserts++; return node }
      return () => node
    },
  })
  return { db: node, seen }
}

const week = [{ dinner: { dishes: [{ kind: 'recipe', recipeId: 'r-1', recipeName: 'Lentejas' }] } }, {}, {}, {}, {}, {}, {}]

beforeEach(() => vi.clearAllMocks())

describe('one request, one menu (PRO-1298)', () => {
  it('two requests at once for the same week: a single generation and a single menu', async () => {
    const { generateMenu } = await import('../services/menuGenerator.js')
    let finish!: () => void
    vi.mocked(generateMenu).mockImplementationOnce(() => new Promise((resolve) => { finish = () => resolve({ days: week, warnings: [] } as any) }))
    // A's previous week, B's previous week, then A's menu and A's log.
    const { db, seen } = makeDb([], [], [{ id: 'm-1', days: week }], [{ id: 'log-1' }])
    const first = generate.handler({}, { userId: 'u-twice', db, channel: 'whatsapp' })
    await vi.waitFor(() => expect(generateMenu).toHaveBeenCalledTimes(1))
    const second = await generate.handler({}, { userId: 'u-twice', db, channel: 'whatsapp' })
    expect(second.summary).toMatch(/No he lanzado otro: el menu de la semana del .* ya se esta preparando/)
    expect(second.data.replaced).toBe(false)
    finish()
    const done = await first
    expect(done.summary).toContain('Menu generado')
    expect(generateMenu).toHaveBeenCalledTimes(1)
    // Two inserts: the one menu and its log.
    expect(seen.inserts).toBe(2)

    // Once it's done, the week can be asked for again.
    const again = makeDb([], [{ id: 'm-2', days: week }], [{ id: 'log-2' }])
    expect((await generate.handler({}, { userId: 'u-twice', db: again.db })).summary).toContain('Menu generado')
  })

  it('a request sent before the week\'s menu was made gets no second menu, even with replaceExisting', async () => {
    const { generateMenu } = await import('../services/menuGenerator.js')
    const madeAt = new Date('2026-11-23T19:05:00Z')
    const previous = { id: 'm-1', days: week, locked: {}, bannedRecipeIds: [], skippedDays: [], createdAt: madeAt }
    const { db, seen } = makeDb([previous])
    const r = await generate.handler({ replaceExisting: true }, { userId: 'u-repeat', db, channel: 'whatsapp', requestedAt: new Date('2026-11-23T19:02:00Z') })
    expect(r.summary).toMatch(/No he generado otro: el menu de la semana del .* se hizo despues de que escribiera este mensaje/)
    expect(r.data).toMatchObject({ replaced: false, menuId: 'm-1' })
    expect(generateMenu).not.toHaveBeenCalled()
    expect(seen.inserts).toBe(0)

    // Asked after that menu, «rehazla entera» does remake it.
    const later = makeDb([previous], [{ id: 'm-2', days: week }], [{ id: 'log-2' }])
    const remade = await generate.handler({ replaceExisting: true }, { userId: 'u-repeat', db: later.db, channel: 'whatsapp', requestedAt: new Date('2026-11-23T19:30:00Z') })
    expect(remade.summary).toContain('Menu generado')
    expect(generateMenu).toHaveBeenCalledTimes(1)
  })

  it('a button that doesn\'t ask for a week never makes one', async () => {
    const { generateMenu } = await import('../services/menuGenerator.js')
    const { db, seen } = makeDb()
    const r = await generate.handler({ replaceExisting: true }, {
      userId: 'u-button', db, channel: 'whatsapp',
      button: { title: 'No, cenamos otra cosa', asked: 'Tu cena de hoy era *Lentejas*.\n¿La hiciste?' },
    })
    expect(r.summary).toMatch(/Menu NO generado: solo ha pulsado el boton «No, cenamos otra cosa»/)
    expect(generateMenu).not.toHaveBeenCalled()
    expect(seen.inserts).toBe(0)

    // «Sí» under «¿Te preparo el menú de la semana que viene?» does.
    const yes = makeDb([], [{ id: 'm-3', days: week }], [{ id: 'log-3' }])
    const made = await generate.handler({ nextWeek: true }, {
      userId: 'u-button', db: yes.db, channel: 'whatsapp',
      button: { title: 'Sí', asked: '¿Te preparo el menú de la semana que viene?' },
    })
    expect(made.summary).toContain('Menu generado')
  })
})

describe('menuRequestGuard', () => {
  it('claimMenuGeneration: one at a time per person and week, free again after release', () => {
    const a = claimMenuGeneration('u-g', '2026-11-23')
    expect(a).not.toBeNull()
    expect(claimMenuGeneration('u-g', '2026-11-23')).toBeNull()
    expect(claimMenuGeneration('u-g', '2026-11-30')).not.toBeNull()
    expect(claimMenuGeneration('u-other', '2026-11-23')).not.toBeNull()
    a!.release()
    a!.release()
    expect(claimMenuGeneration('u-g', '2026-11-23')).not.toBeNull()
  })

  it('askedBeforeMenu: only a message older than the menu', () => {
    const made = new Date('2026-11-23T19:05:00Z')
    expect(askedBeforeMenu(made, new Date('2026-11-23T19:04:59Z'))).toBe(true)
    expect(askedBeforeMenu(made, new Date('2026-11-23T19:06:00Z'))).toBe(false)
    expect(askedBeforeMenu(undefined, new Date())).toBe(false)
    expect(askedBeforeMenu(made, undefined)).toBe(false)
  })

  it('buttonAsksForWeek: the title or the last line of the question', () => {
    expect(buttonAsksForWeek({ title: 'Prepárame el menú' })).toBe(true)
    expect(buttonAsksForWeek({ title: 'Sí', asked: '¿Te preparo el menú de la semana que viene?' })).toBe(true)
    expect(buttonAsksForWeek({ title: 'Sí', asked: '¿Rehago la semana entera?' })).toBe(true)
    expect(buttonAsksForWeek({ title: 'Sí', asked: '¿Quieres un menú nuevo?' })).toBe(true)
    expect(buttonAsksForWeek({ title: 'Sí', asked: 'Tu menú de la semana que viene está listo.\n¿Te cambio la cena del jueves?' })).toBe(false)
    expect(buttonAsksForWeek({ title: 'Cambia a algo rápido', asked: 'Hoy toca *Lentejas* para cenar.' })).toBe(false)
    expect(buttonAsksForWeek({ title: 'No, cenamos otra cosa', asked: '¿Hiciste la cena?' })).toBe(false)
    expect(buttonAsksForWeek({ title: 'Lo hago' })).toBe(false)
    // As the question sits in the history: with the buttons' mark and the link.
    expect(buttonAsksForWeek({ title: 'Sí', asked: '¿Genero el menú?\n⟦botones: Sí | No⟧' })).toBe(true)
    expect(buttonAsksForWeek({ title: 'Sí', asked: '¿Te preparo la semana que viene?\n\nVer menú: https://mimoia.test/menu' })).toBe(true)
  })
})
