import { findRecipeForSlot, type MatcherOptions, type RecipeWithIngredients } from './recipeMatcher.js'
import type { Course } from '@ona/shared'
import { isSweetDish } from './menuRules.js'

type WithCourse = RecipeWithIngredients & { course?: Course | null }

/**
 * Course-aware wrapper around findRecipeForSlot. Filters the candidate pool
 * upstream of the matcher's other criteria (season, banned, restrictions, …)
 * so the matcher only sees recipes that fit the target course.
 *
 * Rule:
 *   - course === 'starter' | 'main' | 'dessert': only that course.
 *   - course === null: matcher's "single-dish" mode → only main OR null.
 *   - A sweet dish (`isSweetDish`: a dessert, a cake, sweet ingredients with
 *     nothing savoury) is never a lunch or dinner dish other than its dessert
 *     (2026-11-19: a sweet mutabbaq as a Sunday dinner).
 */
export function findForCourse(
  pool: WithCourse[],
  course: Course | null,
  options: MatcherOptions,
): WithCourse | undefined {
  const savoury = course !== 'dessert' && (options.meal === 'lunch' || options.meal === 'dinner')
  const filtered = pool.filter((r) => {
    const c = r.course ?? null
    if (course === null ? !(c === 'main' || c === null) : c !== course) return false
    return !savoury || !isSweetDish(r)
  })
  return findRecipeForSlot(filtered, options) as WithCourse | undefined
}
