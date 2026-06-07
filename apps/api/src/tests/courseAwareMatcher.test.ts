import { describe, it, expect } from 'vitest'
import { findForCourse } from '../services/courseAwareMatcher.js'
import type { RecipeWithIngredients } from '../services/recipeMatcher.js'
import type { Course } from '@ona/shared'

function r(
  id: string,
  course: Course | null,
): RecipeWithIngredients & { course: typeof course } {
  return {
    id,
    name: id,
    meals: ['lunch'],
    seasons: ['summer'],
    tags: [],
    ingredients: [],
    course,
  }
}

const baseOptions = {
  meal: 'lunch' as const,
  season: 'summer' as const,
  usedRecipeIds: new Set<string>(),
  restrictions: [],
  favoriteRecipeIds: new Set<string>(),
}

describe('courseAwareMatcher.findForCourse', () => {
  it('with course=null excludes starters and desserts from candidates', () => {
    const all = [r('s1', 'starter'), r('m1', 'main'), r('d1', 'dessert'), r('u1', null)]
    const picked = findForCourse(all, null, baseOptions)
    expect(picked).toBeDefined()
    expect(picked!.id).toMatch(/m1|u1/)
  })

  it('with course="starter" only picks starters', () => {
    const all = [r('s1', 'starter'), r('m1', 'main'), r('d1', 'dessert')]
    const picked = findForCourse(all, 'starter', baseOptions)
    expect(picked?.id).toBe('s1')
  })

  it('with course="main" only picks mains', () => {
    const all = [r('s1', 'starter'), r('m1', 'main')]
    const picked = findForCourse(all, 'main', baseOptions)
    expect(picked?.id).toBe('m1')
  })

  it('with course="dessert" only picks desserts', () => {
    const all = [r('s1', 'starter'), r('d1', 'dessert')]
    const picked = findForCourse(all, 'dessert', baseOptions)
    expect(picked?.id).toBe('d1')
  })

  it('returns undefined when no candidates match (caller should record a warning)', () => {
    const all = [r('m1', 'main')]
    const picked = findForCourse(all, 'dessert', baseOptions)
    expect(picked).toBeUndefined()
  })
})
