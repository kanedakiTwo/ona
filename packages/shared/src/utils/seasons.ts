import type { Season } from '../constants/enums.js'

/**
 * Detect current season based on month.
 * Dec-Feb: winter, Mar-May: spring, Jun-Aug: summer, Sep-Nov: autumn
 */
export function detectSeason(date: Date = new Date()): Season {
  const month = date.getMonth() // 0-11
  if (month <= 1 || month === 11) return 'winter'  // Dec, Jan, Feb
  if (month <= 4) return 'spring'                    // Mar, Apr, May
  if (month <= 7) return 'summer'                    // Jun, Jul, Aug
  return 'autumn'                                    // Sep, Oct, Nov
}

/**
 * Get all recipes available for the current season.
 */
export function isInSeason(recipeSeasons: Season[], currentSeason: Season): boolean {
  return recipeSeasons.length === 0 || recipeSeasons.includes(currentSeason)
}
