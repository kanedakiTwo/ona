/**
 * Mimo's tools: the full list (`skills`) and what each channel sees
 * (`toolsFor`, `getToolDefinitions`). Each group lives in its own module
 * (PRO-400); this index only gathers them and keeps the exports of before.
 */
import type { SkillDefinition } from './types.js'
import { getTodaysMenu, getWeeklyMenu, getWeeklyNutrition, generateWeeklyMenu, getMenuHistory } from './menuSkills.js'
import { getRecipeDetails, suggestRecipes, cookWithWhatIHave, searchRecipes, getMyRecipes } from './recipeSearchSkills.js'
import { completeOnboarding } from './onboardingSkills.js'
import { swapMeal, toggleFavorite, markMealEaten } from './mealSkills.js'
import { createRecipe, recipeVariation, scaleRecipeSkill, editRecipe, addRecipeToMine, importRecipeFromUrlSkill } from './recipeEditSkills.js'
import { nutritionAdvice, evaluateFoodHealth, suggestSubstitution, getVarietyScore, getEatingWindow, getWeekBalance } from './nutritionSkills.js'
import { getPantryStock, markInStock, checkShoppingItem } from './pantrySkills.js'
import { startCookingMode, setTimer, cookingStep } from './cookingSkills.js'
import { updateHousehold, updateMemory } from './householdSkills.js'
import { appSkills } from './appSkills.js'
import { shopOrderSkills } from './shopOrderSkills.js'
import { householdHabitsSkills } from './householdHabitsSkills.js'
import { fichaSkills } from './fichaSkills.js'
import { tasteSkills } from './tasteSkills.js'
import { fixedMealSkills } from './fixedMealSkills.js'
import { taperSkills } from './taperSkills.js'
import { alertTimeSkills } from './alertTimeSkills.js'
import { weekTypeSkills } from './weekTypeSkills.js'
import { schoolMenuSkills } from './schoolMenuSkills.js'
import { freezerSkills } from './freezerSkills.js'
import { recipeOfTheDaySkills } from './recipeOfTheDaySkills.js'
import { moreToolsSkill } from './toolGroups.js'

export { untrustedText, menuRecipeDishes } from './skillHelpers.js'
export { weekHasDishes, weekPlanFromParams, fridgeGateForSkill } from './menuSkills.js'
export { recipeDetailsSummary, namesAllWords } from './recipeSearchSkills.js'
export { mergeMemoryFacts, householdUpdatedSummary, type MemoryFactInput } from './householdSkills.js'
export { importRecipeFromUrlSkill } from './recipeEditSkills.js'
export { MILK_ALLERGY_SUBSTITUTION, recipeBalance, describeWeekBalance, describeRecipeBalance, type RecipeBalance } from './nutritionSkills.js'

export const skills: SkillDefinition[] = [
  getTodaysMenu,
  getWeeklyMenu,
  getRecipeDetails,
  getWeeklyNutrition,
  suggestRecipes,
  searchRecipes,
  generateWeeklyMenu,
  completeOnboarding,
  swapMeal,
  toggleFavorite,
  markMealEaten,
  createRecipe,
  recipeVariation,
  nutritionAdvice,
  // Expansion 1–13:
  getPantryStock,
  markInStock,
  checkShoppingItem,
  getMyRecipes,
  getMenuHistory,
  scaleRecipeSkill,
  evaluateFoodHealth,
  suggestSubstitution,
  getVarietyScore,
  getEatingWindow,
  getWeekBalance,
  cookWithWhatIHave,
  startCookingMode,
  setTimer,
  cookingStep,
  // Improvements 2026-05:
  editRecipe,
  updateHousehold,
  addRecipeToMine,
  updateMemory,
  // WhatsApp channel 2026-10:
  importRecipeFromUrlSkill,
  // UI parity (everything the app can do, from chat) — appSkills.ts:
  ...appSkills,
  // Compra en mis tiendas (specs/shop-orders.md) — shopOrderSkills.ts:
  ...shopOrderSkills,
  // Cómo cocina el hogar (PRO-217) — householdHabitsSkills.ts:
  ...householdHabitsSkills,
  // Mimo habla de la ficha (PRO-319, specs/household-profile.md) — fichaSkills.ts:
  ...fichaSkills,
  // «Afina tu menú»: ver y quitar valoraciones (PRO-297) — tasteSkills.ts:
  ...tasteSkills,
  // Comidas fijas (PRO-218, specs/menus.md):
  ...fixedMealSkills,
  // PRO-223: «mañana me llevo táper».
  ...taperSkills,
  // «Semana tipo» por Mimo (D-182 fase 3, specs/advisor.md):
  ...weekTypeSkills,
  // Menú del cole (PRO-224, specs/menus.md):
  ...schoolMenuSkills,
  // PRO-228: «Sí, mételo» al repaso mensual del congelador.
  ...freezerSkills,
  // La receta del día (PRO-1099, specs/recipe-of-the-day.md):
  ...recipeOfTheDaySkills,
  // PRO-1301: la hora del menú del día y de la pregunta de la cena.
  ...alertTimeSkills,
]

/**
 * Convert skills to Anthropic tool definitions format.
 */
/**
 * Tools the model can use on a channel. Hiding what doesn't apply makes the
 * choice easier (64 tools on 2026-10-11): the in-app cooking controls don't
 * exist on WhatsApp, and complete_onboarding only matters during the
 * WhatsApp-first sign-up.
 */
const HIDDEN_ON_WHATSAPP = new Set(['set_timer', 'cooking_step'])

export interface ToolsForOptions {
  mode?: string
  onboarding?: boolean
  /**
   * PRO-392: this turn's tools (`selectToolGroups` in toolGroups.ts). Without
   * it, every tool of the channel (scripts, the battery's «before» run), and
   * no `more_tools`.
   */
  only?: ReadonlySet<string>
}

export function toolsFor(opts: ToolsForOptions = {}): SkillDefinition[] {
  // PRO-392: `more_tools` (loads another group) exists only with a selection.
  const pool = opts.only ? [...skills, moreToolsSkill] : skills
  return pool.filter((skill) => {
    if (opts.only && !opts.only.has(skill.name)) return false
    if (skill.name === 'complete_onboarding') return opts.onboarding === true
    if (opts.mode === 'whatsapp' && HIDDEN_ON_WHATSAPP.has(skill.name)) return false
    return true
  })
}

export function getToolDefinitions(opts: ToolsForOptions = {}): Array<{
  name: string
  description: string
  input_schema: Record<string, any>
}> {
  return toolsFor(opts).map(skill => ({
    name: skill.name,
    description: skill.description,
    input_schema: skill.parameters,
  }))
}
