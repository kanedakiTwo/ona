/**
 * PRO-271 (Seguridad): who in the household has said their allergies and
 * diet. «No ha contestado» (nothing saved, no consent) is not «contestó que
 * ninguna» (consent in force, nothing saved), and the weekly menu reads every
 * member's restrictions, not only the generating user's.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { allergiesAnswered, householdAllergiesStatus, unionMemberRestrictions, withHouseholdRestrictions, type AllergyMember } from '../services/householdAllergies.js'
import { findRecipeForSlot, type RecipeWithIngredients } from '../services/recipeMatcher.js'
import { findForCourse } from '../services/courseAwareMatcher.js'
import { compileRestrictions } from '../services/dietaryRestrictions.js'

const member = (over: Partial<AllergyMember>): AllergyMember => ({
  userId: 'u',
  username: 'u',
  restrictions: [],
  memoryRestrictions: undefined,
  consentAt: null,
  withdrawnAt: null,
  ...over,
})

describe('allergiesAnswered', () => {
  it('nothing saved and no consent → has not answered', () => {
    expect(allergiesAnswered(member({}))).toBe(false)
  })
  it('consent in force with nothing saved → answered «ninguna»', () => {
    expect(allergiesAnswered(member({ consentAt: '2026-10-20T10:00:00Z' }))).toBe(true)
  })
  it('consent withdrawn afterwards → not answered any more', () => {
    expect(allergiesAnswered(member({ consentAt: '2026-10-01T10:00:00Z', withdrawnAt: '2026-10-10T10:00:00Z' }))).toBe(false)
  })
  it('restrictions in the profile or in Mimo’s memory → answered', () => {
    expect(allergiesAnswered(member({ restrictions: ['marisco'] }))).toBe(true)
    expect(allergiesAnswered(member({ memoryRestrictions: ['sin lactosa'] }))).toBe(true)
  })
  it('blank strings don’t count as an answer', () => {
    expect(allergiesAnswered(member({ restrictions: ['  '], memoryRestrictions: 'marisco' }))).toBe(false)
  })
})

describe('householdAllergiesStatus', () => {
  const ana = member({ userId: 'ana', username: 'ana' })
  const victor = member({ userId: 'victor', username: 'victor', restrictions: ['marisco', 'vegetariano'], consentAt: '2026-10-20T10:00:00Z' })

  it('nobody answered: the caller is asked, nobody else pending', () => {
    expect(householdAllergiesStatus([ana], 'ana')).toEqual({ meAnswered: false, pending: [], anyAnswered: false })
  })
  it('the invited person answered, the owner did not', () => {
    expect(householdAllergiesStatus([ana, victor], 'victor')).toEqual({ meAnswered: true, pending: ['ana'], anyAnswered: true })
    expect(householdAllergiesStatus([ana, victor], 'ana')).toEqual({ meAnswered: false, pending: [], anyAnswered: true })
  })
  it('a member who joined before PRO-271 and never answered is pending for the owner', () => {
    const owner = member({ userId: 'o', username: 'o', consentAt: '2026-10-01T10:00:00Z' })
    const newcomer = member({ userId: 'n', username: 'marina' })
    expect(householdAllergiesStatus([owner, newcomer], 'o')).toEqual({ meAnswered: true, pending: ['marina'], anyAnswered: true })
  })
})

describe('unionMemberRestrictions', () => {
  it('merges every member’s profile and memory, deduped', () => {
    const out = unionMemberRestrictions([
      { restrictions: ['sin gluten'], memoryRestrictions: undefined },
      { restrictions: ['marisco', 'Sin gluten'], memoryRestrictions: ['sin lactosa'] },
    ])
    expect(out).toEqual(['sin gluten', 'marisco', 'sin lactosa'])
  })
  it('«marisco» from a member compiles to the crustacean allergen for the whole menu', () => {
    const rules = compileRestrictions(unionMemberRestrictions([{ restrictions: [] }, { restrictions: ['marisco'] }]), [])
    expect(rules.allergens.has('crustaceos')).toBe(true)
  })
})

/**
 * PRO-305 (Seguridad): changing one dish («Cambiar al azar», adding a meal,
 * regenerating a dish, Mimo's swap_meal) reads every member's allergies,
 * like the weekly menu — not only those of whoever asks.
 */
describe('withHouseholdRestrictions (PRO-305)', () => {
  const db = {} as never
  const guestSaysMarisco = async () => ['marisco']
  const shrimp: RecipeWithIngredients = {
    id: 'r-gambas', name: 'Gambas al ajillo', meals: ['dinner'], seasons: [], tags: [], allergens: ['crustaceos'],
    ingredients: [{ ingredientId: 'i1', ingredientName: 'gambas peladas', quantity: 200, unit: 'g', allergenTags: ['crustaceos'] }],
  }
  const tortilla: RecipeWithIngredients = {
    id: 'r-tortilla', name: 'Tortilla de patatas', meals: ['dinner'], seasons: [], tags: [], allergens: ['huevo'],
    ingredients: [{ ingredientId: 'i2', ingredientName: 'patata', quantity: 400, unit: 'g' }],
  }

  it('adds the other members’ restrictions to the owner’s, owner first, deduped', async () => {
    expect(await withHouseholdRestrictions(['sin gluten'], 'owner', db, async () => ['Sin gluten', 'marisco'])).toEqual(['sin gluten', 'marisco'])
  })

  it('a read error keeps the owner’s own (never fails the pick)', async () => {
    expect(await withHouseholdRestrictions(['vegetariano'], 'owner', db, async () => { throw new Error('db down') })).toEqual(['vegetariano'])
  })

  it('the owner (no allergies) changes a dinner: a shellfish recipe never comes out for the guest allergic to marisco', async () => {
    const restrictions = await withHouseholdRestrictions([], 'owner', db, guestSaysMarisco)
    const options = { meal: 'dinner' as const, season: 'autumn' as const, usedRecipeIds: new Set<string>(), restrictions, favoriteRecipeIds: new Set(['r-gambas']) }
    for (let i = 0; i < 50; i++) {
      expect(findRecipeForSlot([shrimp, tortilla], options)?.id).toBe('r-tortilla')
      expect(findForCourse([shrimp, tortilla], null, options)?.id).toBe('r-tortilla')
    }
    // Only the shrimp left: nothing, rather than the shrimp.
    expect(findRecipeForSlot([shrimp], options)).toBeUndefined()
  })

  it('every pick in routes/menus.ts and Mimo’s swap_meal reads the household’s restrictions', () => {
    const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')
    const menus = read('routes/menus.ts')
    // POST meal (añadir una comida), regenerate dish, random dish.
    expect(menus.match(/const restrictions = await withHouseholdRestrictions\(/g)?.length).toBe(3)
    expect(menus).not.toMatch(/const restrictions = mergeRestrictions\(/)
    // PUT meal (Cambiar al azar), through the context it shares with PRO-364's review.
    expect(menus).toContain('await loadSlotPickContext(menu, req.userId!)')
    expect(read('services/menuSlotPick.ts')).toContain('const restrictions = await withHouseholdRestrictions(')
    expect(read('services/menuGenerator.ts')).toContain('withHouseholdRestrictions(')
    expect(read('services/assistant/skills.ts')).toContain('const restrictions = await withHouseholdRestrictions(own.restrictions, userId, db)')
  })
})
