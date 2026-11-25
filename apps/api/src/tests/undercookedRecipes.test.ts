/**
 * PRO-1181 (D-1009, seguridad de la dieta): runny yolk and pink mince never
 * reach a household with someone aged 0 to 2, and their steps tell everyone
 * how to cook them through («Para embarazo o bebés: …»).
 */
import { describe, expect, it, vi } from 'vitest'
import {
  LIQUID_YOLK_TAG,
  SAFETY_PREFIX,
  UNDERCOOKED_MINCE_TAG,
  UNDERCOOKED_RECIPES,
  hasBabyAtHome,
  notForBabies,
  safetyStepIndex,
  applyUndercookedMarks,
  undercookedEntryFor,
} from '../services/undercookedRecipes.js'
import { fichaMenuConstraints } from '../services/profile/reader.js'
import { normalizeRecipeName } from '../services/catalogSourceLinks.js'

vi.mock('../services/recipeVisibility.js', () => ({
  visibleAuthorIds: async (userId: string) => [userId],
  visibleRecipeWhere: () => undefined,
}))

const { loadMatchableRecipes } = await import('../services/matchableRecipes.js')

describe('Cocina’s list (COC-510, auditoría up to 2026-11-12, and PRO-1231 up to 2026-11-17)', () => {
  it('has the 37 runny or raw yolk recipes and the 5 pink or raw meat ones', () => {
    expect(UNDERCOOKED_RECIPES.filter((u) => u.tag === LIQUID_YOLK_TAG)).toHaveLength(37)
    expect(UNDERCOOKED_RECIPES.filter((u) => u.tag === UNDERCOOKED_MINCE_TAG)).toHaveLength(5)
  })

  it('names and ids are never repeated', () => {
    const ids = UNDERCOOKED_RECIPES.flatMap((u) => (u.id ? [u.id] : []))
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(UNDERCOOKED_RECIPES.map((u) => normalizeRecipeName(u.name))).size).toBe(UNDERCOOKED_RECIPES.length)
  })

  it('every line starts with «Para embarazo o bebés:» and Miguel’s line is the default', () => {
    for (const u of UNDERCOOKED_RECIPES) expect(u.line.startsWith(SAFETY_PREFIX), u.name).toBe(true)
    expect(undercookedEntryFor({ id: 'x', name: 'Shakshuka' })?.line).toBe('Para embarazo o bebés: tapa 4 minutos más, hasta que la yema esté firme.')
  })

  it('finds a recipe by its production id, or by name without accents, case or a trailing «(…)»', () => {
    expect(undercookedEntryFor({ id: '79e6992c-5135-4110-b4c9-966c27dc9418', name: 'Otro nombre' })?.tag).toBe(UNDERCOOKED_MINCE_TAG)
    expect(undercookedEntryFor({ id: 'staging-id', name: 'ensalada cesar' })?.name).toBe('Ensalada César')
    expect(undercookedEntryFor({ id: 'staging-id', name: 'Brick de huevo' })?.tag).toBe(LIQUID_YOLK_TAG)
    expect(undercookedEntryFor({ id: 'staging-id', name: 'Tortilla de patatas' })).toBeNull()
  })
})

describe('safetyStepIndex', () => {
  it('goes in the last step that names the egg (or the meat), else the last one', () => {
    expect(safetyStepIndex(['Sofríe la cebolla.', 'Casca los huevos encima y tapa 4 minutos.', 'Sirve con pan.'], LIQUID_YOLK_TAG)).toBe(1)
    expect(safetyStepIndex(['Saltea el cordero picado 2 minutos.', 'Sirve sobre el hummus.'], UNDERCOOKED_MINCE_TAG)).toBe(0)
    expect(safetyStepIndex(['Mezcla la carne picada con las especias.', 'Hornea 10 minutos, un poco rosado por dentro.'], UNDERCOOKED_MINCE_TAG)).toBe(1)
    expect(safetyStepIndex(['Mezcla todo.', 'Sirve.'], LIQUID_YOLK_TAG)).toBe(1)
  })

  it('never twice, and not in a recipe without steps', () => {
    expect(safetyStepIndex(['Casca los huevos. Para embarazo o bebés: tapa 4 minutos más.'], LIQUID_YOLK_TAG)).toBe(-1)
    expect(safetyStepIndex([], LIQUID_YOLK_TAG)).toBe(-1)
  })
})

describe('who counts as a baby', () => {
  it('a person of the ficha aged 0 to 2, nobody else', () => {
    expect(hasBabyAtHome([{ ageBand: 'adulto' }, { ageBand: '0-2' }])).toBe(true)
    expect(hasBabyAtHome([{ ageBand: '3-5' }, { ageBand: 'adulto' }])).toBe(false)
    expect(hasBabyAtHome(null)).toBe(false)
    expect(fichaMenuConstraints({ householdId: 'h1', portrait: null, persons: [{ id: 'p1', alias: 'el bebé', ageBand: '0-2' }], facts: [] }).babyAtHome).toBe(true)
    expect(notForBabies(['tipo:huevos', LIQUID_YOLK_TAG])).toBe(true)
    expect(notForBabies(['compartida'])).toBe(false)
  })
})

/** Drizzle-like chain whose awaited queries return `responses` in order. */
function makeDb(...responses: any[]) {
  const queue = [...responses]
  const node: any = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === 'then') {
          return (resolve: any, reject?: any) =>
            queue.length === 0 ? Promise.reject(new Error('mockDb: queue empty')) : Promise.resolve(queue.shift()).then(resolve, reject)
        }
        return () => node
      },
    },
  )
  return node
}

const recipe = (id: string, name: string, internalTags: string[] = []) => ({ id, name, authorId: null, servings: 2, course: 'main', meals: ['lunch', 'dinner'], seasons: [], internalTags })
const shakshuka = recipe('r-s', 'Shakshuka', [LIQUID_YOLK_TAG])
const kawarma = recipe('r-k', 'Hummus kawarma', [UNDERCOOKED_MINCE_TAG])
const lentejas = recipe('r-l', 'Lentejas estofadas')
/** The ficha reads: the user's household, its active facts, its persons, its portrait. */
const ficha = (persons: unknown[]) => [[{ householdId: 'h1' }], [], persons, []]
const person = (ageBand: string) => ({ id: `p-${ageBand}`, alias: 'alguien', ageBand })
/** Ingredient lines, steps and PRO-1142's reads (no household, no «Me apetece»). */
const rest = [[], [], [], []]

describe('loadMatchableRecipes — a household with a baby', () => {
  it('never gets a recipe with runny yolk or pink mince', async () => {
    const pool = await loadMatchableRecipes('u-1', makeDb([shakshuka, kawarma, lentejas], ...ficha([person('adulto'), person('0-2')]), ...rest))
    expect(pool.map((r) => r.name)).toEqual(['Lentejas estofadas'])
  })

  it('a household without one (adults, children from 3) still gets them', async () => {
    const pool = await loadMatchableRecipes('u-2', makeDb([shakshuka, kawarma, lentejas], ...ficha([person('adulto'), person('3-5')]), ...rest))
    expect(pool.map((r) => r.name)).toEqual(['Shakshuka', 'Hummus kawarma', 'Lentejas estofadas'])
  })
})

/** PRO-1231: Cocina's audits of 13 to 17-nov, as the catalogue names them. */
const PRO_1231 = [
  ['7a9325f5-cb93-45af-906e-5c72bebc6e06', 'Paté de bacalao'],
  ['189c06fe-cda9-487d-a207-cc1ac687b2c9', 'Tortilla de patatas chips'],
  ['7a6809f7-5eea-4a33-9fae-21ce97e49d59', 'Huevo frito con espárragos'],
  ['3301ea31-425a-4699-b876-4fb707444f6d', 'Mousse de chocolate con avellanas garrapiñadas'],
  ['10fe4f3b-40ce-4b88-9146-a70a4b117921', 'Arroz al caldero'],
  ['6b4e52e7-e930-4951-abe8-17658d48277c', 'Steak tartar'],
  ['c9b12dc8-09f4-4f2b-8456-cac36ca0fe3f', 'Salmón marinado'],
  ['4448dfcd-5865-4cc8-8478-4d38329b1e16', 'Mousse de turrón'],
  ['8bbb6c26-69c3-409b-9889-1c2dfd8a9465', 'Tarta de galletas'],
  ['bc2ba880-d2fc-42ee-8f7c-2bae2183b29f', 'Helado de sabayón'],
  ['253cb93c-9400-4872-9611-5c862cc7dc13', 'Arroz a la cubana'],
  ['aba51442-4e48-4220-9fa6-1a033e599dfd', 'Pisto con huevo frito a la Thermomix'],
  ['9fe881bf-138e-4d73-9f91-810b1659a9c6', 'Huevos rotos con patatas y jamón'],
  ['0fe687f5-fcd3-452c-ac94-a65f7840cf1c', 'Sopa castellana'],
  ['a0ac0405-6839-4b87-82e2-46979fb95aa1', 'Mousse de higos'],
  ['42aedb25-abd8-41c0-b2c4-398f4c9159dd', 'Suquet de caballa'],
  ['0dbae611-91f9-43e2-ad3c-00c076ffac50', 'Pasta carbonara'],
  ['a3e9d08a-a96e-4eda-805b-75865471f7b9', 'Tostadas con aguacate y huevo'],
  ['bb99c444-4701-4351-8115-bec7fe11e15c', 'Revuelto de calabacín'],
  ['cb246da9-eb0e-4cc2-90dc-22416fe95c0e', "Kofta b'siniyah (kofta de cordero y ternera con salsa de tahini)"],
] as const

/**
 * A db for `applyUndercookedMarks`: the catalogue select returns `catalogue`,
 * each steps select returns `steps`, the copies select nothing; every
 * `update(...).set(v)` is recorded.
 */
function bootDb(catalogue: Array<{ id: string; name: string; internalTags: string[] }>, steps: (recipeIndex: number) => Array<{ id: string; text: string }>) {
  const sets: unknown[] = []
  let selects = 0
  const chain = (result: () => unknown): any =>
    new Proxy(
      {},
      {
        get(_, prop) {
          if (prop === 'then') return (resolve: any) => resolve(result())
          return () => chain(result)
        },
      },
    )
  const db: any = {
    select: () =>
      chain(
        (() => {
          let value: unknown
          return () => {
            if (value !== undefined) return value
            const n = selects++
            value = n === 0 ? catalogue : n <= catalogue.length ? steps(n - 1) : []
            return value
          }
        })(),
      ),
    update: () => ({ set: (v: unknown) => (sets.push(v), chain(() => undefined)) }),
  }
  return { db, sets }
}

describe('applyUndercookedMarks — the 20 of PRO-1231 at API boot', () => {
  it('each one gets its tag and its «Para embarazo o bebés» line in its steps, found by production id', async () => {
    const catalogue = PRO_1231.map(([id, name]) => ({ id, name, internalTags: [] as string[] }))
    const { db, sets } = bootDb(catalogue, (i) => [
      { id: `s-${i}-1`, text: 'Prepara los ingredientes.' },
      { id: `s-${i}-2`, text: 'Sirve.' },
    ])
    const result = await applyUndercookedMarks(db, () => {})
    expect(result.tagged).toBe(20)
    expect(result.stepLines).toBe(20)
    for (const [id, name] of PRO_1231) {
      const entry = undercookedEntryFor({ id, name })!
      expect(entry, name).not.toBeNull()
      expect(sets, name).toContainEqual({ internalTags: [entry.tag] })
      expect(sets, name).toContainEqual({ text: `Sirve. ${entry.line}` })
    }
  })

  it('also by name on staging or a draft, and never twice', async () => {
    const catalogue = PRO_1231.map(([, name], i) => ({ id: `staging-${i}`, name, internalTags: [] as string[] }))
    const first = await applyUndercookedMarks(bootDb(catalogue, () => [{ id: 's', text: 'Casca los huevos.' }]).db, () => {})
    expect(first.stepLines).toBe(20)
    const marked = catalogue.map((r) => ({ ...r, internalTags: [undercookedEntryFor(r)!.tag] }))
    const again = bootDb(marked, (i) => [{ id: 's', text: `Casca los huevos. ${undercookedEntryFor(marked[i])!.line}` }])
    expect(await applyUndercookedMarks(again.db, () => {})).toMatchObject({ tagged: 0, stepLines: 0 })
    expect(again.sets).toEqual([])
  })

  it('the six «de diario» with a runny yolk are on the list (before PRO-1200)', () => {
    for (const name of ['Arroz a la cubana', 'Huevos rotos con patatas y jamón', 'Pisto con huevo frito a la Thermomix', 'Pasta carbonara', 'Tostadas con aguacate y huevo', 'Revuelto de calabacín'])
      expect(undercookedEntryFor({ id: 'x', name })?.tag, name).toBe(LIQUID_YOLK_TAG)
  })
})
