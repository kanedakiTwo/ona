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
  undercookedEntryFor,
} from '../services/undercookedRecipes.js'
import { fichaMenuConstraints } from '../services/profile/reader.js'

vi.mock('../services/recipeVisibility.js', () => ({
  visibleAuthorIds: async (userId: string) => [userId],
  visibleRecipeWhere: () => undefined,
}))

const { loadMatchableRecipes } = await import('../services/matchableRecipes.js')

describe('Cocina’s list (COC-510, auditoría up to 2026-11-12)', () => {
  it('has the 19 runny or raw yolk recipes and the 3 pink mince ones', () => {
    expect(UNDERCOOKED_RECIPES.filter((u) => u.tag === LIQUID_YOLK_TAG)).toHaveLength(19)
    expect(UNDERCOOKED_RECIPES.filter((u) => u.tag === UNDERCOOKED_MINCE_TAG)).toHaveLength(3)
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
