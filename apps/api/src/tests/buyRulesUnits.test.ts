/**
 * A recipe "u" of a pack rule (PRO-286). Miguel's real «Enviar a Mercadona»
 * order (2026-10-20) asked for «8 paquetes de pan de molde (450 g)» and
 * «8 paquetes de queso en lonchas (200 g)» because the recipe said 8 slices
 * in "u" and those rules had no `ug` (grams per recipe unit), so every slice
 * counted as a pack. Each rule given a `ug` has a line here, and the guard
 * below keeps any pack rule the catalogue uses in "u" from losing it again.
 *
 * Run: pnpm --filter @ona/api test src/tests/buyRulesUnits.test.ts
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { toOrderQty, resolveBuyRule } from '@ona/shared'

const u = (name: string, quantity: number) => toOrderQty({ name, quantity, unit: 'u', quantitySource: 'recipe' })

describe('slices, cans and sticks in "u" are not packs', () => {
  it.each([
    ['pan de molde', 8, '1 paquete de pan de molde (450 g)'],
    ['pan de molde', 20, '2 paquetes de pan de molde (450 g)'],
    ['queso en lonchas', 8, '1 paquete de queso en lonchas (200 g)'],
    ['queso gouda', 2, '1 paquete de queso en lonchas (200 g)'],
    ['queso en lonchas', 20, '2 paquetes de queso en lonchas (200 g)'],
    ['surimi', 8, '1 paquete de palitos de surimi (250 g)'],
    ['atún', 2, '1 pack de 3 latas de atún en aceite de oliva'],
    ['atún', 4, '2 packs de 3 latas de atún en aceite de oliva'],
    ['pepinillo', 3, '1 frasco de pepinillos'],
    ['ciruela pasa', 45, '2 bolsas de pasas (200 g)'],
    ['laurel', 2, '1 bote de laurel'],
    ['jamón york', 4, '150 g de jamón cocido extra, en lonchas'],
  ] as const)('%s × %s u → "%s"', (name, quantity, text) => {
    expect(u(name, quantity).text).toBe(text)
  })

  it('eggs and yeast sachets in "u" still count one by one', () => {
    expect(u('huevo', 8).text).toBe('1 docena de huevos')
    expect(u('levadura', 2).text).toBe('2 sobres de levadura')
  })
})

/** Pack rules whose recipe "u" is the sale unit itself, with the reason (rules.ts, PRO-286). */
const U_IS_THE_UNIT: Record<string, string> = {
  huevos: 'a "u" is an egg; the egg branch counts them by half-dozen',
  levadura: 'a "u" is a sobre, the sale unit',
}

describe('guard: catalogue pack rules used in "u" have a ug or a written reason', () => {
  const fixtures = ['catalog-quantities-2026-10-15.json', 'catalog-2026-10-12.json']
  const rows = fixtures.flatMap((f) => {
    const recipes = JSON.parse(readFileSync(fileURLToPath(new URL(`./fixtures/${f}`, import.meta.url)), 'utf8')) as Array<{ name: string; ingredients?: Array<{ name: string; unit: string }> }>
    return recipes.flatMap((r) => (r.ingredients ?? []).filter((i) => i.unit === 'u').map((i) => ({ recipe: r.name, name: i.name })))
  })

  it('finds "u" rows to check', () => {
    expect(rows.length).toBeGreaterThan(50)
  })

  it('every pack rule hit in "u" has ug or is in U_IS_THE_UNIT', () => {
    const missing = new Set<string>()
    for (const row of rows) {
      const rule = resolveBuyRule(row.name)?.rule
      if (!rule || rule.by !== 'envase' || rule.ug != null || U_IS_THE_UNIT[rule.key]) continue
      missing.add(`${rule.key} (${row.name} in ${row.recipe})`)
    }
    expect([...missing]).toEqual([])
  })
})
