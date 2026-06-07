import { findRecipeForSlot, type MatcherOptions, type RecipeWithIngredients } from './recipeMatcher.js'
import type { Course } from '@ona/shared'

type WithCourse = RecipeWithIngredients & { course?: Course | null }

/**
 * Course-aware wrapper around findRecipeForSlot. Filters the candidate pool
 * upstream of the matcher's other criteria (season, banned, restrictions, …)
 * so the matcher only sees recipes that fit the target course.
 *
 * Rule:
 *   - course === 'starter' | 'main' | 'dessert': only that course.
 *   - course === null: matcher's "single-dish" mode → only main OR null.
 */
export function findForCourse(
  pool: WithCourse[],
  course: Course | null,
  options: MatcherOptions,
): WithCourse | undefined {
  const filtered = pool.filter((r) => {
    const c = r.course ?? null
    if (course === null) return c === 'main' || c === null
    return c === course
  })
  return findRecipeForSlot(filtered, options) as WithCourse | undefined
}
