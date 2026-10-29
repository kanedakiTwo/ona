/**
 * PRO-345 (Seguridad): a saved menu is re-checked when one of its recipes
 * changes or disappears. The case of the hogares de prueba (2026-10-22):
 * «Fajitas de pollo» in a gluten-free household's Thursday dinner, and the
 * catalogue recipe got «Tortillas de trigo» afterwards; and Marta y Jorge's
 * «Crema de calabaza», deleted, on Saturday.
 */
import { describe, expect, it } from 'vitest'
import { replacedDishLine, type DayMenu } from '@ona/shared'
import {
  replaceStaleDishes,
  staleDishes,
  staleNoteText,
  toRecheckRecipe,
  type PickContext,
  type RecheckMenu,
  type RecheckRecipe,
} from '../services/menuRecipeRecheck.js'

const WEEK = '2026-10-26' // Monday
const CREATED = new Date('2026-10-24T08:30:00Z')
const EDITED = new Date('2026-10-25T22:35:00Z')

const fajitasBefore: RecheckRecipe = {
  id: 'fajitas',
  name: 'Fajitas de pollo',
  allergens: [],
  updatedAt: new Date('2026-10-12T10:00:00Z'),
  ingredients: [
    { ingredientName: 'Pollo', allergenTags: [] },
    { ingredientName: 'Pimiento rojo', allergenTags: [] },
    { ingredientName: 'Lima', allergenTags: [] },
  ],
}

/** The same recipe edited after the menu was made: now with wheat tortillas. */
const fajitasWithWheat: RecheckRecipe = {
  ...fajitasBefore,
  allergens: ['gluten'],
  updatedAt: EDITED,
  ingredients: [...fajitasBefore.ingredients, { ingredientName: 'Tortillas de trigo', allergenTags: ['gluten'] }],
}

const lentejas: RecheckRecipe = {
  id: 'lentejas',
  name: 'Lentejas guisadas',
  allergens: [],
  updatedAt: new Date('2026-10-01T10:00:00Z'),
  ingredients: [{ ingredientName: 'Lentejas', allergenTags: [] }],
}

function week(): DayMenu[] {
  const days: DayMenu[] = [{}, {}, {}, {}, {}, {}, {}]
  days[0] = { dinner: { dishes: [{ kind: 'recipe', recipeId: 'fajitas', recipeName: 'Fajitas de pollo', course: 'main' }] } }
  days[1] = { lunch: { dishes: [{ kind: 'recipe', recipeId: 'lentejas', recipeName: 'Lentejas guisadas', course: 'main' }] } }
  // Thursday 29: the dinner of Dani and Sara.
  days[3] = { dinner: { servings: 2, dishes: [{ kind: 'recipe', recipeId: 'fajitas', recipeName: 'Fajitas de pollo', course: 'main' }] } }
  // Friday lunch: the leftover of Thursday's dinner.
  days[4] = {
    lunch: { dishes: [{ kind: 'recipe', recipeId: 'fajitas', recipeName: 'Fajitas de pollo', course: 'main', variant: 'leftover', leftoverOf: { day: 3, meal: 'dinner', dishPosition: 0 } }] },
  }
  // Saturday: the deleted «Crema de calabaza» as a starter.
  days[5] = {
    lunch: {
      dishes: [
        { kind: 'recipe', recipeId: 'crema', recipeName: 'Crema de calabaza', course: 'starter' },
        { kind: 'recipe', recipeId: 'lentejas', recipeName: 'Lentejas guisadas', course: 'main' },
      ],
    },
  }
  return days
}

function menu(days = week()): RecheckMenu {
  return { id: 'm1', weekStart: WEEK, createdAt: CREATED, days }
}

const byId = (...rs: RecheckRecipe[]) => new Map(rs.map((r) => [r.id, r]))
// Tuesday 27 in Madrid: Monday is gone.
const TODAY = '2026-10-27'

describe('staleDishes (PRO-345)', () => {
  it('a recipe edited to have gluten, in a gluten-free household: every dish of it from today on', () => {
    const stale = staleDishes({ menu: menu(), recipesById: byId(fajitasWithWheat, lentejas), restrictions: ['sin gluten'], today: TODAY })
    expect(stale.filter((s) => s.reason === 'diet')).toEqual([
      { day: 3, meal: 'dinner', position: 0, recipeId: 'fajitas', recipeName: 'Fajitas de pollo', reason: 'diet' },
      { day: 4, meal: 'lunch', position: 0, recipeId: 'fajitas', recipeName: 'Fajitas de pollo', reason: 'diet' },
    ])
  })

  it('a deleted recipe is stale whatever the household eats', () => {
    const stale = staleDishes({ menu: menu(), recipesById: byId(fajitasBefore, lentejas), restrictions: [], today: TODAY })
    expect(stale).toEqual([{ day: 5, meal: 'lunch', position: 0, recipeId: 'crema', recipeName: 'Crema de calabaza', reason: 'removed' }])
  })

  it('the same recipe unchanged, or a household without the restriction: nothing', () => {
    expect(staleDishes({ menu: menu(), recipesById: byId(fajitasBefore, lentejas, { ...lentejas, id: 'crema', name: 'Crema de calabaza' }), restrictions: ['sin gluten'], today: TODAY })).toEqual([])
    expect(staleDishes({ menu: menu(), recipesById: byId(fajitasWithWheat, lentejas, { ...lentejas, id: 'crema' }), restrictions: ['marisco'], today: TODAY })).toEqual([])
  })

  it('a recipe that already had gluten before entering the menu (picked by hand, confirmed) stays', () => {
    const handPicked = staleDishes({
      menu: menu(),
      recipesById: byId(fajitasWithWheat, lentejas, { ...lentejas, id: 'crema' }),
      restrictions: ['sin gluten'],
      today: TODAY,
      // Thursday's dinner was picked by hand after the edit.
      enteredAt: (day, meal) => (day === 3 && meal === 'dinner' ? new Date('2026-10-26T08:00:00Z') : CREATED),
    })
    expect(handPicked.map((s) => `${s.day}|${s.meal}`)).toEqual(['4|lunch'])
  })

  it('past days and eaten meals are left alone', () => {
    const days = week()
    days[3].dinner!.eaten = true
    const stale = staleDishes({ menu: menu(days), recipesById: byId(fajitasWithWheat, lentejas, { ...lentejas, id: 'crema' }), restrictions: ['celíaca'], today: TODAY })
    expect(stale.map((s) => `${s.day}|${s.meal}`)).toEqual(['4|lunch'])
  })

  it('the hooks only look at the recipe that changed', () => {
    const stale = staleDishes({ menu: menu(), recipesById: byId(fajitasWithWheat, lentejas), restrictions: ['sin gluten'], today: TODAY, onlyRecipeIds: new Set(['crema']) })
    expect(stale.map((s) => s.recipeId)).toEqual(['crema'])
  })
})

describe('replaceStaleDishes (PRO-345)', () => {
  const recipesById = byId(fajitasWithWheat, lentejas)
  const stale = () => staleDishes({ menu: menu(), recipesById, restrictions: ['sin gluten'], today: TODAY })

  it('the gluten fajitas are replaced, the card says why, the leftover follows and the deleted starter is replaced too', () => {
    const asked: PickContext[] = []
    const picks = [
      { id: 'arroz-pollo', name: 'Arroz con pollo', course: 'main' as const },
      { id: 'gazpacho', name: 'Gazpacho', course: 'starter' as const },
    ]
    const { days, changes } = replaceStaleDishes(week(), stale(), (ctx) => {
      asked.push({ ...ctx, usedRecipeIds: new Set(ctx.usedRecipeIds) })
      return picks.find((p) => p.course === (ctx.course ?? 'main')) ?? null
    })
    expect(days[3].dinner).toEqual({
      servings: 2,
      dishes: [{ kind: 'recipe', recipeId: 'arroz-pollo', recipeName: 'Arroz con pollo', course: 'main', replaced: { recipeName: 'Fajitas de pollo', reason: 'diet' } }],
    })
    expect(days[4].lunch!.dishes[0]).toMatchObject({ recipeId: 'arroz-pollo', variant: 'leftover', leftoverOf: { day: 3, meal: 'dinner', dishPosition: 0 } })
    expect(days[5].lunch!.dishes.map((d) => (d.kind === 'recipe' ? d.recipeId : d.text))).toEqual(['gazpacho', 'lentejas'])
    // Monday is past: its fajitas stay; the original week isn't touched.
    expect(days[0].dinner!.dishes[0]).toMatchObject({ recipeId: 'fajitas' })
    expect(week()[3].dinner!.dishes[0]).toMatchObject({ recipeId: 'fajitas' })
    // One pick per dish to cook (not the leftover), never repeating the week.
    expect(asked.map((a) => `${a.day}|${a.meal}|${a.course}`)).toEqual(['3|dinner|main', '5|lunch|starter'])
    expect(asked[1].usedRecipeIds.has('arroz-pollo')).toBe(true)
    expect(changes.map((c) => [c.day, c.meal, c.reason, c.to?.id ?? null])).toEqual([
      [3, 'dinner', 'diet', 'arroz-pollo'],
      [5, 'lunch', 'removed', 'gazpacho'],
      [4, 'lunch', 'diet', 'arroz-pollo'],
    ])
    expect(replacedDishLine({ recipeName: 'Fajitas de pollo', reason: 'diet' })).toBe(
      'En lugar de «Fajitas de pollo», que ha cambiado y ya no encaja con vuestra dieta',
    )
  })

  it('nothing fits: a note that says why, so no menu keeps a recipe that is gone', () => {
    const { days } = replaceStaleDishes(week(), stale(), () => null)
    expect(days[3].dinner!.dishes[0]).toEqual({ kind: 'note', text: '«Fajitas de pollo» ya no encaja con vuestra dieta: elegid otro plato' })
    expect(days[4].lunch!.dishes[0]).toEqual({ kind: 'note', text: '«Fajitas de pollo» ya no encaja con vuestra dieta: elegid otro plato' })
    expect(days[5].lunch!.dishes[0]).toEqual({ kind: 'note', text: '«Crema de calabaza» ya no está en el catálogo: elegid otro plato' })
  })

  it('a táper already cooked stays on a diet change, and becomes a note when its recipe is deleted', () => {
    const days = week()
    days[3].dinner!.dishes[0] = { kind: 'recipe', recipeId: 'fajitas', recipeName: 'Fajitas de pollo', variant: 'freezer' }
    days[5].lunch!.dishes[0] = { kind: 'recipe', recipeId: 'crema', recipeName: 'Crema de calabaza', variant: 'fridge' }
    const s = staleDishes({ menu: menu(days), recipesById, restrictions: ['sin gluten'], today: TODAY })
    const out = replaceStaleDishes(days, s, () => ({ id: 'x', name: 'X' }))
    expect(out.days[3].dinner!.dishes[0]).toMatchObject({ recipeId: 'fajitas', variant: 'freezer' })
    expect(out.days[5].lunch!.dishes[0]).toEqual({ kind: 'note', text: 'Táper de «Crema de calabaza»' })
  })

  it('notes never pass 120 characters', () => {
    expect(staleNoteText('x'.repeat(200), 'removed').length).toBeLessThanOrEqual(120)
    expect(staleNoteText('x'.repeat(200), 'diet', true).length).toBeLessThanOrEqual(120)
  })
})

describe('the recipe as the check reads it (PRO-1067)', () => {
  // «Lentejas guisadas» edited afterwards: the chorizo only in a step, as in PRO-346.
  const steps = ['Pon las lentejas en remojo.', 'Sofríe la cebolla y añade el chorizo en rodajas.']
  const edited = toRecheckRecipe(
    { id: 'lentejas', name: 'Lentejas guisadas', allergens: [], updatedAt: EDITED },
    [{ ingredientName: 'Lentejas', allergenTags: [] }, { ingredientName: 'Cebolla', allergenTags: [] }],
    steps,
  )

  it('reads what the steps name and the ingredients don’t, like the matcher', () => {
    expect(edited.stepMentions?.map((m) => m.term)).toContain('chorizo')
    expect(toRecheckRecipe({ id: 'l', name: 'L', allergens: null, updatedAt: null }, [{ ingredientName: 'Chorizo', allergenTags: [] }], steps).stepMentions).toEqual([])
  })

  it('a vegetarian household: the lentils with chorizo in a step are replaced', () => {
    const stale = staleDishes({ menu: menu(), recipesById: byId(fajitasBefore, edited, { ...lentejas, id: 'crema', name: 'Crema de calabaza' }), restrictions: ['vegetariano'], today: TODAY })
    expect(stale).toEqual([
      { day: 1, meal: 'lunch', position: 0, recipeId: 'lentejas', recipeName: 'Lentejas guisadas', reason: 'diet' },
      { day: 5, meal: 'lunch', position: 1, recipeId: 'lentejas', recipeName: 'Lentejas guisadas', reason: 'diet' },
    ])
  })
})
