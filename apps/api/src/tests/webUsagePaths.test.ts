/**
 * PRO-120: the web's screen names, recipe origins and sign-up step names
 * (apps/web/src/lib/usagePaths.ts) match the lists the API accepts.
 */
import { describe, expect, it } from 'vitest'
import { onboardingStepKey, recipeFromPath, screenOfPath } from '../../../web/src/lib/usagePaths'
import { ONBOARDING_STEPS, RECIPE_VIEW_FROM, USAGE_SCREENS } from '../services/usageEvents.js'

describe('web usage paths', () => {
  it('maps app paths to screens and leaves the rest out', () => {
    expect(screenOfPath('/menu')).toBe('menu')
    expect(screenOfPath('/shopping/')).toBe('lista')
    expect(screenOfPath('/recipes')).toBe('recetas')
    expect(screenOfPath('/recipes/0b1c')).toBe('receta')
    expect(screenOfPath('/recipes/new')).toBeNull()
    expect(screenOfPath('/recipes/0b1c/cook')).toBeNull()
    expect(screenOfPath('/profile/pantry')).toBe('despensa')
    expect(screenOfPath('/profile/avisos')).toBe('avisos')
    expect(screenOfPath('/profile/casa')).toBe('casa')
    expect(screenOfPath('/privacidad')).toBeNull()
    expect(screenOfPath(null)).toBeNull()
  })

  it('every screen and origin the web sends is one the API accepts', () => {
    for (const p of ['/menu', '/shopping', '/compra', '/recipes', '/recipes/x', '/profile', '/profile/pantry', '/profile/avisos', '/profile/casa']) {
      expect(USAGE_SCREENS).toContain(screenOfPath(p))
    }
    for (const prev of ['/menu?day=2', '/recipes', '/cookbooks/1', '/shopping', null, '/']) {
      expect(RECIPE_VIEW_FROM).toContain(recipeFromPath(prev))
    }
    expect(recipeFromPath('/menu')).toBe('menu')
    expect(recipeFromPath('/cookbooks/1')).toBe('catalogo')
    expect(recipeFromPath(null)).toBe('otro')
  })

  it('numbers the six sign-up steps like the API lists them', () => {
    const keys = [1, 2, 3, 4, 5, 6].map(onboardingStepKey)
    expect(keys).toEqual(['hogar', 'frecuencia', 'cocina', 'tiempo', 'dieta', 'prioridad'])
    for (const k of keys) expect(ONBOARDING_STEPS).toContain(k)
    expect(onboardingStepKey(7)).toBeNull()
  })
})
