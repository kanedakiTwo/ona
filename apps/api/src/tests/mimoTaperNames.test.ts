/**
 * PRO-296: Mimo reads the menu with the same names as the card on the web.
 * Tápers and added dishes saved without a name (before PRO-240) reached Mimo
 * as «receta sin nombre (del congelador)» (Dani y Sara, 2026-10-20) and «receta
 * sin nombre» for Laura's «+ Huevo duro». Every Mimo read fills the missing
 * name from its recipe.
 */
import { describe, expect, it } from 'vitest'
import { weekMenuContext } from '../services/assistant/contextLoader.js'

/** A drizzle-like db whose one query (the recipe names) answers `rows`. */
function namesDb(rows: { id: string; name: string }[]) {
  const asked: number[] = []
  const node: any = new Proxy(
    {},
    {
      get(_, prop) {
        if (prop === 'then') return (resolve: any) => { asked.push(1); return Promise.resolve(rows).then(resolve) }
        return () => node
      },
    },
  )
  return { db: node, asked }
}

// Monday: a freezer táper and a dish Mimo added, both saved without a name.
const days = [
  {
    lunch: {
      dishes: [
        { kind: 'recipe', recipeId: 'r-alb', recipeName: 'Albóndigas en salsa' },
        { kind: 'recipe', recipeId: 'r-huevo' },
      ],
    },
    dinner: { dishes: [{ kind: 'recipe', recipeId: 'r-lent', variant: 'freezer' }] },
  },
  {}, {}, {}, {}, {}, {},
]

describe('the assistant context names tápers and added dishes (PRO-296)', () => {
  it('fills the names from the recipes: never «receta sin nombre»', async () => {
    const { db, asked } = namesDb([
      { id: 'r-huevo', name: 'Huevo duro' },
      { id: 'r-lent', name: 'Lentejas estofadas' },
    ])
    const block = await weekMenuContext('2026-10-19', days, db)
    expect(block).toBe(
      'Menu de esta semana (2026-10-19):\n  Lun (dayIndex 0): comida: Albóndigas en salsa + Huevo duro; cena: Lentejas estofadas (del congelador)',
    )
    expect(block).not.toContain('sin nombre')
    expect(asked).toHaveLength(1)
  })

  it('a week where every dish has its name asks nothing', async () => {
    const { db, asked } = namesDb([])
    const named = [{ lunch: { dishes: [{ kind: 'recipe', recipeId: 'a', recipeName: 'Paella' }] } }]
    expect(await weekMenuContext('2026-10-19', named, db)).toBe('Menu de esta semana (2026-10-19):\n  Lun (dayIndex 0): comida: Paella')
    expect(asked).toHaveLength(0)
  })

  it('an empty week gives no block', async () => {
    expect(await weekMenuContext('2026-10-19', [{}, {}], namesDb([]).db)).toBeNull()
  })
})
