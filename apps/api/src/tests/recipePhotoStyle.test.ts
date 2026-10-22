/**
 * PRO-89 (Miguel, 2026-10-14): back to the single house style of
 * 2026-10-08 ("menos perfecto", the one that generated the current
 * catalogue) — no per-recipe variants (PRO-59 is undone). Every recipe's
 * prompt ends with the same style text, and the vision check looks for that
 * same style.
 */
import { describe, it, expect } from 'vitest'
import { buildRecipePrompt, promptSafe, STYLE_SUFFIX } from '../services/recipeImageGenerator.js'
import * as generator from '../services/recipeImageGenerator.js'

/** The style text as it was before PRO-59 (git show bb38070^:apps/api/src/services/recipeImageGenerator.ts). */
const BEFORE_PRO_59 =
  'Fotografía real de comida casera recién servida, tomada desde arriba o en tres cuartos, como en un libro de cocina de autor. Cerámica artesana algo irregular (blanca, crema o de barro) sobre madera natural gastada o lino crudo arrugado. Luz natural de ventana, cálida, con sombras suaves. Nada de perfección de estudio: ración servida con naturalidad y algo desigual, cortes irregulares, piezas distintas entre sí, alguna gota de salsa o miga en el borde del plato o en el mantel, una cuchara de servir apoyada o una servilleta descolocada, encuadre ligeramente descentrado. Paleta cálida (cremas, ocres, terracota), sin texto, sin manos ni personas. Textura fotográfica real con ligero grano, profundidad de campo media; que no parezca una imagen generada por ordenador.'

describe('buildRecipePrompt — one house style', () => {
  it('is the style text from before PRO-59', () => {
    expect(STYLE_SUFFIX).toBe(BEFORE_PRO_59)
  })

  it('two different recipes get the same style text, at the end of the prompt', () => {
    const a = buildRecipePrompt({ name: 'Lentejas con chorizo', topIngredients: ['lentejas', 'chorizo'], meals: ['lunch'] })
    const b = buildRecipePrompt({ name: 'Tzatziki', topIngredients: ['yogur', 'pepino'], meals: ['snack'], description: 'Un cuenco de salsa blanca espesa con pepino rallado.' })
    expect(a.endsWith(BEFORE_PRO_59)).toBe(true)
    expect(b.endsWith(BEFORE_PRO_59)).toBe(true)
    expect(a.slice(a.length - BEFORE_PRO_59.length)).toBe(b.slice(b.length - BEFORE_PRO_59.length))
  })

  it('has no per-recipe variants any more', () => {
    expect(Object.keys(generator)).not.toEqual(expect.arrayContaining(['PHOTO_VARIANTS']))
    expect(Object.keys(generator)).not.toContain('photoVariantFor')
    expect(Object.keys(generator)).not.toContain('STYLE_BASE')
    const prompt = buildRecipePrompt({ name: 'Albóndigas en salsa', topIngredients: [], meals: ['dinner'] })
    expect(prompt).not.toMatch(/gres|mantel de cuadros|lateral bajo|piedra/)
  })
})

describe('the prompt never carries a word the image models block (2026-10-22, «Rape alangostado» → 422)', () => {
  it('«rape» (monkfish) goes as «pejesapo» in the prompt, in the name and in the description; other words stay', () => {
    const prompt = buildRecipePrompt({
      name: 'Rape alangostado',
      topIngredients: ['rape', 'pimentón'],
      meals: ['dinner'],
      description: 'Lomos de rape envueltos y pintados con pimentón, cortados en medallones',
    })
    expect(prompt).not.toMatch(/\brape\b/i)
    expect(prompt).toContain('Pejesapo alangostado.')
    expect(prompt).toContain('Lomos de pejesapo envueltos')
    expect(promptSafe('Raperos y uvas rapé')).toBe('Raperos y uvas rapé')
    expect(promptSafe('RAPE')).toBe('Pejesapo')
  })
})
