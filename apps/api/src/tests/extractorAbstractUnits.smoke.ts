import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { AnthropicProvider } from '../services/providers/anthropic.js'
import { normalizeTerm, getTermBySynonym } from '@ona/shared'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'recipe-with-abstract-units.txt'),
  'utf8',
)

const SKIP = !process.env.ANTHROPIC_API_KEY

describe('extractor — abstract units smoke', () => {
  it.skipIf(SKIP)(
    'extracts servings + display/canonical pairs from Spanish prose',
    async () => {
      const provider = new AnthropicProvider()
      const result = await provider.extractRecipeFromText(FIXTURE, 'article')
      if (!result.isRecipe) throw new Error(`Expected isRecipe=true, got reason: ${result.reason}`)

      const recipe = result.raw

      // Servings: Salmorejo says "4 personas" → should be explicit
      expect(recipe.servings).toBeGreaterThanOrEqual(1)
      expect(recipe.servings).toBeLessThanOrEqual(12)
      expect(['explicit', 'estimated']).toContain(recipe.servingsConfidence)
      expect(recipe.servingsConfidence).toBe('explicit')

      // At least one ingredient should have display fields
      // (cda for vinagre, vaso for aceite, diente for ajo, etc.)
      const withDisplay = recipe.ingredients.filter(
        (ing) => ing.displayQuantity != null && ing.displayUnit != null,
      )
      expect(withDisplay.length).toBeGreaterThanOrEqual(1)

      // Each display unit should match a known vocabulary synonym
      for (const ing of withDisplay) {
        const term = getTermBySynonym(normalizeTerm(ing.displayUnit!))
        expect(
          term,
          `display unit "${ing.displayUnit}" should match a vocabulary term`,
        ).toBeDefined()
      }
    },
    30_000,
  )
})
