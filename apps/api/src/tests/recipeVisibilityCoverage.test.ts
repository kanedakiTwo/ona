import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * Regression guard for the "other users' private recipes leak into my menu /
 * assistant" bug. The generator, the assistant and the menu routes used to
 * load the whole `recipes` table. Every recipe read in these files must now
 * be narrowed by a `.where(...)`, and the bulk loaders must go through
 * recipeVisibility.ts.
 */
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')

const read = (rel: string) => readFileSync(join(SRC, rel), 'utf8')

/** The query chain that starts at each `.from(recipes)` (until the statement ends). */
function recipeChains(source: string): string[] {
  const chains: string[] = []
  let at = source.indexOf('.from(recipes)')
  while (at !== -1) {
    let depth = 0
    let i = at
    for (; i < source.length; i++) {
      const c = source[i]
      if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === '\n' && depth <= 0) {
        const rest = source.slice(i + 1).trimStart()
        if (!rest.startsWith('.')) break
      }
      if (depth < 0) break
    }
    chains.push(source.slice(at, i))
    at = source.indexOf('.from(recipes)', at + 1)
  }
  return chains
}

const SCOPED_FILES = [
  'services/menuGenerator.ts',
  'services/pantryMatcher.ts',
  'services/advisor.ts',
  'services/assistant/skills.ts',
  'routes/menus.ts',
]

describe('recipe visibility coverage', () => {
  for (const file of SCOPED_FILES) {
    it(`${file} never reads the whole recipes table`, () => {
      const chains = recipeChains(read(file))
      expect(chains.length).toBeGreaterThan(0)
      for (const chain of chains) {
        expect(chain, `unscoped recipe read in ${file}:\n${chain}`).toContain('.where(')
      }
    })
  }

  it('bulk loaders filter by visibility', () => {
    expect(read('services/menuGenerator.ts')).toMatch(
      /loadRecipesWithIngredients\(db: any, userId: string\)[\s\S]{0,300}visibleRecipeWhere\(/,
    )
    expect(read('services/assistant/skills.ts')).toMatch(
      /loadRecipesWithIngredients\(db: any, userId: string\)[\s\S]{0,300}visibleRecipeWhere\(/,
    )
    expect(read('services/pantryMatcher.ts')).toContain('visibleRecipeWhere(await visibleAuthorIds(userId))')
    expect(read('services/advisor.ts')).toContain('visibleRecipeWhere(await visibleAuthorIds(userId))')
    // generate, regenerate-week and the two single-slot regenerations.
    const menus = read('routes/menus.ts')
    expect(menus.match(/from\(recipes\)\.where\(visibleRecipeWhere/g)?.length).toBe(4)
    // manual pick of a recipe for a slot (meal + course variants).
    expect(menus.match(/eq\(recipes\.id, manualRecipeId\), visibleRecipeWhere/g)?.length).toBe(2)
  })

  it('the chain extractor catches an unscoped bulk load', () => {
    const chains = recipeChains('const all = await db.select().from(recipes)\nconst x = 1\n')
    expect(chains).toEqual(['.from(recipes)'])
    expect(chains[0]).not.toContain('.where(')
  })
})
