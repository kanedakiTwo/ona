import type { Season } from '../constants/enums.js'

/**
 * Detect current season based on month.
 * Dec-Feb: winter, Mar-May: spring, Jun-Aug: summer, Sep-Nov: autumn
 */
export function detectSeason(date: Date = new Date()): Season {
  const month = date.getMonth() // 0-11
  const seasonIndex = Math.floor(month / 12 * 4) % 4
  const seasons: Season[] = ['winter', 'spring', 'summer', 'autumn']
  return seasons[seasonIndex]
}

/**
 * Get all recipes available for the current season.
 */
export function isInSeason(recipeSeasons: Season[], currentSeason: Season): boolean {
  return recipeSeasons.length === 0 || recipeSeasons.includes(currentSeason)
}
