/**
 * PRO-244: the WhatsApp sign-up (complete_onboarding) builds the same first
 * menu as the web: it starts today (days already gone are not generated)
 * and, Friday to Sunday, next week comes too (PRO-65 — on 17-oct a Saturday
 * sign-up got only the week of the 12th, Monday to Friday included).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const generateCalls: { weekStart: string; skipped: number[] }[] = []

vi.mock('../services/onboarding.js', () => ({ saveOnboarding: vi.fn(async () => ({ id: 'u1' })) }))
vi.mock('../services/shopperInvite.js', () => ({
  shopperInviteForSignUp: vi.fn(async () => ({
    url: 'https://mimoia.com/invites/abc',
    message: 'Te he metido en nuestra casa de Mimoia: ahí tendrás el menú y la lista de la compra de cada semana. Entra aquí: https://mimoia.com/invites/abc',
  })),
}))
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
// 19-nov: the dishes said in the sign-up are looked up in the household's recipes and the catalogue.
const POOL = [
  { id: 'salmon', name: 'Salmón al horno con patatas', meals: ['dinner'], allergens: ['pescado'], ingredients: [] },
  { id: 'pollo', name: 'Pollo a la plancha con brócoli', meals: ['lunch', 'dinner'], allergens: [], ingredients: [] },
  { id: 'bravas', name: 'Patatas bravas', meals: ['lunch'], allergens: [], ingredients: [] },
  { id: 'macarrones', name: 'Macarrones con tomate', meals: ['lunch', 'dinner'], allergens: ['gluten'], ingredients: [] },
]
vi.mock('../services/matchableRecipes.js', async (orig) => ({ ...(await orig<any>()), loadMatchableRecipes: vi.fn(async () => POOL) }))
vi.mock('../services/weekType.js', async (orig) => ({ ...(await orig<any>()), saveWeekTypeSlots: vi.fn(async () => []) }))
vi.mock('../services/userMemoryStore.js', async (orig) => ({
  ...(await orig<any>()),
  getMemoryForUser: vi.fn(async () => ({ dislikes: { value: ['casqueria'] } })),
  setMemoryBatch: vi.fn(async () => undefined),
}))
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
const { saveOnboarding } = await import('../services/onboarding.js')
const { saveWeekTypeSlots } = await import('../services/weekType.js')
const { setMemoryBatch } = await import('../services/userMemoryStore.js')
const { getPrimaryHouseholdId } = await import('../services/scopeResolver.js')
const { shopperInviteForSignUp } = await import('../services/shopperInvite.js')
const completeOnboarding = skills.find((s) => s.name === 'complete_onboarding')!

function fakeDb(user: Record<string, unknown> = {}) {
  const saved: any[] = []
  return {
    saved,
    select: () => ({ from: () => ({ where: () => ({ limit: async () => [{ onboardingDone: false, ...user }] }) }) }),
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
    vi.setSystemTime(new Date('2026-10-14T10:00:00Z')) // miércoles 14, 12:00 Madrid
    const db = fakeDb()
    const r = await completeOnboarding.handler(answers, { userId: 'u1', db } as any)
    expect(generateCalls).toEqual([{ weekStart: '2026-10-12', skipped: [0, 1] }])
    expect(db.saved).toHaveLength(1)
    // Past days are left without dishes, and are NOT stored as «sin cocinar».
    expect(db.saved[0].days[0]).toEqual({})
    expect(db.saved[0].days[2].lunch.dishes).toHaveLength(1)
    expect(db.saved[0].skippedDays).toEqual([])
    expect((r.data as any).weekStart).toBe('2026-10-12')
    // 19-nov: at 12:00 only breakfast is gone; the menu starts with today's lunch.
    expect(r.summary).toMatch(/Empieza con la comida de hoy \(miercoles\)/)
  })

  it('19-nov: a 22:00 sign-up starts tomorrow, and Mimo is told not to talk about today', async () => {
    vi.setSystemTime(new Date('2026-11-18T21:00:00Z')) // miércoles 18, 22:00 Madrid
    const db = fakeDb()
    const r = await completeOnboarding.handler(answers, { userId: 'u1', db } as any)
    expect(generateCalls).toEqual([{ weekStart: '2026-11-16', skipped: [0, 1, 2] }])
    expect(db.saved[0].days[2]).toEqual({})
    expect(db.saved[0].days[3].lunch.dishes).toHaveLength(1)
    expect(r.summary).toMatch(/Empieza mañana \(jueves\)/)
    expect(r.summary).toMatch(/No hables de comidas de hoy/)
  })

  it('19-nov: a 15:00 sign-up starts with tonight\'s dinner (today\'s lunch is left empty)', async () => {
    vi.setSystemTime(new Date('2026-11-18T14:00:00Z')) // miércoles 18, 15:00 Madrid
    const db = fakeDb()
    const r = await completeOnboarding.handler(answers, { userId: 'u1', db } as any)
    expect(generateCalls).toEqual([{ weekStart: '2026-11-16', skipped: [0, 1] }])
    expect(db.saved[0].days[2].lunch).toBeUndefined()
    expect(db.saved[0].days[3].lunch.dishes).toHaveLength(1)
    expect(r.summary).toMatch(/Empieza con la cena de hoy \(miercoles\)/)
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

describe('complete_onboarding — the four questions to the ficha and the first menu (19-nov)', () => {
  beforeEach(() => {
    generateCalls.length = 0
    vi.mocked(saveOnboarding).mockClear()
    vi.mocked(saveWeekTypeSlots).mockClear()
    vi.mocked(setMemoryBatch).mockClear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-17T08:00:00Z')) // martes 17, 09:00 Madrid
  })
  afterEach(() => vi.useRealTimers())

  it('the dishes they make often are in the first menu: the catalogue\'s when it has them, a note to make the household\'s recipe when not', async () => {
    const db = fakeDb()
    const r = await completeOnboarding.handler(
      { adults: 2, kidsCount: 0, dinners: 6, lunches: 1, favoriteDishes: ['salmón al horno con patatas', 'pollo a la plancha con brócoli', 'tortilla de mi abuela'] },
      { userId: 'u1', db } as any,
    )
    const dishes = db.saved[0].days.flatMap((d: any) => Object.values(d).flatMap((slot: any) => slot.dishes))
    expect(dishes).toContainEqual(expect.objectContaining({ kind: 'recipe', recipeId: 'salmon' }))
    expect(dishes).toContainEqual(expect.objectContaining({ kind: 'recipe', recipeId: 'pollo' }))
    expect(dishes).toContainEqual({ kind: 'note', text: 'tortilla de mi abuela' })
    // «patatas» alone is not «salmón al horno con patatas».
    expect(dishes).not.toContainEqual(expect.objectContaining({ recipeId: 'bravas' }))
    expect(r.summary).toMatch(/Sus platos de siempre, en este menu: salmón al horno con patatas \(Salmón al horno con patatas/)
    expect(r.summary).toMatch(/«tortilla de mi abuela» no esta en el catalogo[\s\S]*swap_meal \(day "2026-11-\d\d", meal "lunch", recipeName "tortilla de mi abuela" y newRecipe/)
    // The first menu never carries the fit line («no me he acercado»…).
    expect(r.summary).not.toMatch(/Acierto con sus gustos/)
  })

  it('«6 cenas y 1 comida» → the week type (no lunch Monday to Saturday, no dinner on Saturday) and how often they cook', async () => {
    vi.mocked(getPrimaryHouseholdId).mockResolvedValueOnce('h1')
    await completeOnboarding.handler({ adults: 2, kidsCount: 0, dinners: 6, lunches: 1 }, { userId: 'u1', db: fakeDb() } as any)
    expect(vi.mocked(saveOnboarding).mock.calls[0][1]).toMatchObject({ cookingFreq: 'daily', cookingStyle: undefined })
    const [householdId, changes] = vi.mocked(saveWeekTypeSlots).mock.calls[0]
    expect(householdId).toBe('h1')
    const off = (changes as any[]).filter((c) => c.slot.off).map((c) => `${c.meal}:${c.day}`)
    expect(off.sort()).toEqual(['dinner:5', 'lunch:0', 'lunch:1', 'lunch:2', 'lunch:3', 'lunch:4', 'lunch:5'])
  })

  it('what doesn\'t go in joins the dislikes the menu reads', async () => {
    await completeOnboarding.handler({ adults: 1, kidsCount: 0, dinners: 7, lunches: 7, dislikes: ['picante', 'legumbres'] }, { userId: 'u1', db: fakeDb() } as any)
    expect(vi.mocked(setMemoryBatch)).toHaveBeenCalledWith('u1', [{ key: 'dislikes', value: ['casqueria', 'picante', 'legumbres'] }], 'inferred', { signal: 'whatsapp' })
    // Seven and seven: the week type stays as it is.
    expect(saveWeekTypeSlots).not.toHaveBeenCalled()
  })
})

describe('complete_onboarding — their dishes never bring what the household can\'t eat (PRO-1041 + the sign-up\'s dishes of 19-nov)', () => {
  beforeEach(() => {
    generateCalls.length = 0
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-11-17T08:00:00Z')) // martes 17, 09:00 Madrid
  })
  afterEach(() => vi.useRealTimers())

  const dishesOf = (db: ReturnType<typeof fakeDb>) => db.saved[0].days.flatMap((d: any) => Object.values(d).flatMap((slot: any) => slot.dishes))
  const answers = {
    adults: 2, kidsCount: 0, dinners: 7, lunches: 7,
    favoriteDishes: ['macarrones con tomate', 'pollo a la plancha con brócoli', 'tortilla de mi abuela'],
  }

  it('with no allergy said or saved, the catalogue\'s recipe goes in as before', async () => {
    const db = fakeDb()
    const r = await completeOnboarding.handler(answers, { userId: 'u1', db, channel: 'whatsapp' } as any)
    expect(dishesOf(db)).toContainEqual(expect.objectContaining({ kind: 'recipe', recipeId: 'macarrones' }))
    expect(r.summary).not.toMatch(/No he puesto/)
    expect(r.summary).not.toMatch(/Aplicado solo a este menu/)
    expect(r.summary).not.toMatch(/tienen que respetarlo tambien/)
  })

  it('«soy celíaca» said to Mimo: the dish whose recipe has gluten is left out (not even as a note to turn into a recipe) and Mimo is told; the rest go in', async () => {
    const db = fakeDb()
    const r = await completeOnboarding.handler({ ...answers, restrictions_said: ['celiaca'] }, { userId: 'u1', db, channel: 'whatsapp' } as any)
    const dishes = dishesOf(db)
    expect(dishes).not.toContainEqual(expect.objectContaining({ recipeId: 'macarrones' }))
    expect(dishes).not.toContainEqual({ kind: 'note', text: 'macarrones con tomate' })
    expect(r.summary).toMatch(/No he puesto «macarrones con tomate»: su receta lleva algo que en casa no pueden comer\. No lo pongas tu con swap_meal; diselo en una linea\./)
    expect(r.summary).not.toMatch(/«macarrones con tomate» no esta en el catalogo/)
    // What they can eat still comes in: the catalogue's recipe, and the note for the dish the catalogue doesn't have.
    expect(dishes).toContainEqual(expect.objectContaining({ kind: 'recipe', recipeId: 'pollo' }))
    expect(dishes).toContainEqual({ kind: 'note', text: 'tortilla de mi abuela' })
    expect(r.summary).toMatch(/Aplicado solo a este menu \(no esta guardado\): sin gluten/)
    expect(r.summary).toContain('/profile/casa/alergias?next=%2Fmenu#marcar=sin%20gluten')
    // The household's recipe Mimo writes for that note can't have it either.
    expect(r.summary).toMatch(/Las recetas de la casa que crees en este turno tienen que respetarlo tambien \(sin gluten\)\./)
    // The tool's result carries nothing of the placement's bookkeeping.
    expect(r).not.toHaveProperty('left')
  })

  it('an allergy already saved in the household leaves the dish out the same way (nothing «said» to tell)', async () => {
    const db = fakeDb({ restrictions: ['sin gluten'] })
    const r = await completeOnboarding.handler(answers, { userId: 'u1', db, channel: 'whatsapp' } as any)
    const dishes = dishesOf(db)
    expect(dishes).not.toContainEqual(expect.objectContaining({ recipeId: 'macarrones' }))
    expect(dishes).toContainEqual(expect.objectContaining({ kind: 'recipe', recipeId: 'pollo' }))
    expect(r.summary).toMatch(/No he puesto «macarrones con tomate»/)
    expect(r.summary).not.toMatch(/Aplicado solo a este menu/)
  })
})

describe('complete_onboarding — how they cook (2026-11-03)', () => {
  beforeEach(() => {
    generateCalls.length = 0
    vi.mocked(saveOnboarding).mockClear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T16:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('saves the web\'s «¿Cómo cocináis en casa?» answer, with no priority when none was said', async () => {
    await completeOnboarding.handler({ adults: 2, kidsCount: 1, cookingStyle: 'batch' }, { userId: 'u1', db: fakeDb() } as any)
    expect(vi.mocked(saveOnboarding).mock.calls[0][1]).toEqual({
      adults: 2, kidsCount: 1, cookingStyle: 'batch', cookingFreq: undefined, favoriteDishes: [], priority: undefined, shopper: undefined, via: 'whatsapp',
    })
  })

  it('a «poco» that fits no way of cooking goes as how often; with a style, the style wins', async () => {
    await completeOnboarding.handler({ adults: 1, kidsCount: 0, cookingFreq: 'rarely' }, { userId: 'u1', db: fakeDb() } as any)
    expect(vi.mocked(saveOnboarding).mock.calls[0][1]).toMatchObject({ cookingStyle: undefined, cookingFreq: 'rarely' })
    await completeOnboarding.handler({ adults: 1, kidsCount: 0, cookingStyle: 'daily', cookingFreq: 'rarely' }, { userId: 'u1', db: fakeDb() } as any)
    expect(vi.mocked(saveOnboarding).mock.calls[1][1]).toMatchObject({ cookingStyle: 'daily', cookingFreq: undefined })
  })

  it('the dishes asked when «Afina tu menú» got no «Me apetece» go in', async () => {
    await completeOnboarding.handler(
      { adults: 2, kidsCount: 0, cookingStyle: 'improvise', favoriteDishes: [' lentejas ', 'tortilla de patatas', ''] },
      { userId: 'u1', db: fakeDb() } as any,
    )
    expect(vi.mocked(saveOnboarding).mock.calls[0][1].favoriteDishes).toEqual(['lentejas', 'tortilla de patatas'])
  })
})

describe('complete_onboarding — «¿Quién hace la compra?» (PRO-383)', () => {
  beforeEach(() => {
    generateCalls.length = 0
    vi.mocked(saveOnboarding).mockClear()
    vi.mocked(shopperInviteForSignUp).mockClear()
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-14T16:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('the tool takes the three answers', () => {
    expect((completeOnboarding.parameters as any).properties.shopper.enum).toEqual(['me', 'other', 'shared'])
  })

  it('«Otra persona de casa» with 2 adults: saved, and the reply carries the same invitation as the web', async () => {
    const r = await completeOnboarding.handler({ adults: 2, kidsCount: 0, cookingStyle: 'daily', shopper: 'other' }, { userId: 'u1', db: fakeDb() } as any)
    expect(vi.mocked(saveOnboarding).mock.calls[0][1]).toMatchObject({ shopper: 'other', via: 'whatsapp' })
    expect(shopperInviteForSignUp).toHaveBeenCalledWith('u1')
    expect(r.summary).toContain('Te he metido en nuestra casa de Mimoia')
    expect(r.summary).toContain('https://mimoia.com/invites/abc')
  })

  it('«Nos turnamos» also invites; «Yo» saves the answer and invites nobody', async () => {
    await completeOnboarding.handler({ adults: 3, kidsCount: 1, cookingStyle: 'batch', shopper: 'shared' }, { userId: 'u1', db: fakeDb() } as any)
    expect(shopperInviteForSignUp).toHaveBeenCalledTimes(1)
    const r = await completeOnboarding.handler({ adults: 2, kidsCount: 0, cookingStyle: 'batch', shopper: 'me' }, { userId: 'u1', db: fakeDb() } as any)
    expect(vi.mocked(saveOnboarding).mock.calls[1][1]).toMatchObject({ shopper: 'me' })
    expect(shopperInviteForSignUp).toHaveBeenCalledTimes(1)
    expect(r.summary).not.toContain('invites/')
  })

  it('with 1 adult the answer is not kept and nobody is invited', async () => {
    const r = await completeOnboarding.handler({ adults: 1, kidsCount: 0, cookingStyle: 'daily', shopper: 'other' }, { userId: 'u1', db: fakeDb() } as any)
    expect(vi.mocked(saveOnboarding).mock.calls[0][1]).toMatchObject({ shopper: undefined })
    expect(shopperInviteForSignUp).not.toHaveBeenCalled()
    expect(r.summary).not.toContain('invites/')
  })

  it('an answer outside the three is dropped; a failed invitation leaves the sign-up done', async () => {
    await completeOnboarding.handler({ adults: 2, kidsCount: 0, cookingStyle: 'daily', shopper: 'mi pareja' }, { userId: 'u1', db: fakeDb() } as any)
    expect(vi.mocked(saveOnboarding).mock.calls[0][1]).toMatchObject({ shopper: undefined })
    vi.mocked(shopperInviteForSignUp).mockRejectedValueOnce(new Error('boom'))
    const r = await completeOnboarding.handler({ adults: 2, kidsCount: 0, cookingStyle: 'daily', shopper: 'other' }, { userId: 'u1', db: fakeDb() } as any)
    expect(r.summary).toMatch(/Primeros pasos guardados/)
    expect(r.summary).not.toContain('invites/')
  })
})
