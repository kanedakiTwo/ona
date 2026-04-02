import { eq, desc, gte } from 'drizzle-orm'
import { menuLogs, userNutrientBalance } from '../db/schema.js'
import { TARGET_MACROS, nutrientsToPercentages } from '@ona/shared'
import type { NutrientBalance } from '@ona/shared'

interface WeeklySummary {
  weekStart: string
  caloriesTotal: number
  nutrients: NutrientBalance
}

interface SummaryResult {
  weeks: WeeklySummary[]
  averageCalories: number
  averageMacros: NutrientBalance
  trend: 'improving' | 'stable' | 'declining'
}

interface AdvisorResponse {
  insight: string
  recommendations: string[]
  macroStatus: {
    protein: 'low' | 'ok' | 'high'
    carbohydrates: 'low' | 'ok' | 'high'
    fat: 'low' | 'ok' | 'high'
  }
}

/**
 * Aggregate menu_logs for the last N weeks.
 * Returns average macros, calories, and a simple trend.
 */
export async function getSummary(
  userId: string,
  weeks: number,
  db: any,
): Promise<SummaryResult> {
  const cutoffDate = new Date()
  cutoffDate.setDate(cutoffDate.getDate() - weeks * 7)
  const cutoffStr = cutoffDate.toISOString().split('T')[0]

  const logs = await db
    .select()
    .from(menuLogs)
    .where(eq(menuLogs.userId, userId))
    .orderBy(desc(menuLogs.weekStart))
    .limit(weeks)

  // Filter to logs within the date range
  const filteredLogs = logs.filter(
    (log: any) => log.weekStart >= cutoffStr,
  )

  if (filteredLogs.length === 0) {
    return {
      weeks: [],
      averageCalories: 0,
      averageMacros: { protein: 0, carbohydrates: 0, fat: 0 },
      trend: 'stable',
    }
  }

  const weekSummaries: WeeklySummary[] = filteredLogs.map((log: any) => ({
    weekStart: log.weekStart,
    caloriesTotal: log.caloriesTotal,
    nutrients: log.aggregatedNutrients as NutrientBalance,
  }))

  // Calculate averages
  const totalCalories = weekSummaries.reduce((sum, w) => sum + w.caloriesTotal, 0)
  const averageCalories = totalCalories / weekSummaries.length

  const averageMacros: NutrientBalance = {
    protein:
      weekSummaries.reduce((sum, w) => sum + (w.nutrients?.protein ?? 0), 0) /
      weekSummaries.length,
    carbohydrates:
      weekSummaries.reduce((sum, w) => sum + (w.nutrients?.carbohydrates ?? 0), 0) /
      weekSummaries.length,
    fat:
      weekSummaries.reduce((sum, w) => sum + (w.nutrients?.fat ?? 0), 0) /
      weekSummaries.length,
  }

  // Simple trend detection based on calorie changes
  let trend: 'improving' | 'stable' | 'declining' = 'stable'
  if (weekSummaries.length >= 2) {
    const recent = weekSummaries[0].caloriesTotal
    const older = weekSummaries[weekSummaries.length - 1].caloriesTotal
    const percentageChange = older !== 0 ? Math.abs((recent - older) / older) * 100 : 0

    if (percentageChange < 5) {
      trend = 'stable'
    } else {
      // "Improving" means calories are getting closer to a reasonable target
      // For simplicity, we assume consistency is improving
      const recentPercentages = nutrientsToPercentages(weekSummaries[0].nutrients)
      const carbsDiff = Math.abs(recentPercentages.carbohydrates - TARGET_MACROS.carbohydrates)
      const fatDiff = Math.abs(recentPercentages.fat - TARGET_MACROS.fat)
      const proteinDiff = Math.abs(recentPercentages.protein - TARGET_MACROS.protein)
      const totalDiff = carbsDiff + fatDiff + proteinDiff

      trend = totalDiff < 15 ? 'improving' : 'declining'
    }
  }

  return {
    weeks: weekSummaries,
    averageCalories,
    averageMacros,
    trend,
  }
}

/**
 * Simple rule-based advisor that looks at the user's nutrient balance
 * and recent menu_logs. Returns a structured response with insight.
 */
export async function askAdvisor(
  userId: string,
  question: string,
  db: any,
): Promise<AdvisorResponse> {
  // Fetch current nutrient balance
  const [balance] = await db
    .select()
    .from(userNutrientBalance)
    .where(eq(userNutrientBalance.userId, userId))
    .limit(1)

  const currentBalance = balance?.balance as NutrientBalance | undefined

  // Fetch recent menu logs
  const recentLogs = await db
    .select()
    .from(menuLogs)
    .where(eq(menuLogs.userId, userId))
    .orderBy(desc(menuLogs.weekStart))
    .limit(4)

  // Analyze macro status
  const macroStatus = analyzeMacroStatus(currentBalance)

  // Generate recommendations
  const recommendations: string[] = []
  const insights: string[] = []

  if (macroStatus.protein === 'low') {
    recommendations.push('Increase protein intake by adding more legumes, eggs, or lean meats.')
    insights.push('Your protein levels have been below target recently.')
  } else if (macroStatus.protein === 'high') {
    recommendations.push('Consider reducing protein portions slightly and adding more vegetables.')
    insights.push('Your protein intake has been above the recommended range.')
  }

  if (macroStatus.carbohydrates === 'low') {
    recommendations.push('Add more whole grains, fruits, or starchy vegetables to your meals.')
    insights.push('Your carbohydrate intake has been low.')
  } else if (macroStatus.carbohydrates === 'high') {
    recommendations.push('Try replacing some refined carbs with vegetables or lean protein.')
    insights.push('Your carbohydrate intake has been higher than recommended.')
  }

  if (macroStatus.fat === 'low') {
    recommendations.push('Include healthy fats like olive oil, nuts, or avocado.')
    insights.push('Your fat intake has been below target.')
  } else if (macroStatus.fat === 'high') {
    recommendations.push('Reduce cooking oils and choose leaner protein sources.')
    insights.push('Your fat intake has been above the recommended range.')
  }

  if (recommendations.length === 0) {
    recommendations.push('Your nutrition balance looks good! Keep it up.')
  }

  // Handle question context
  const lowerQuestion = question.toLowerCase()
  if (lowerQuestion.includes('protein')) {
    insights.unshift(`Regarding protein: your current status is "${macroStatus.protein}".`)
  } else if (lowerQuestion.includes('carb')) {
    insights.unshift(`Regarding carbohydrates: your current status is "${macroStatus.carbohydrates}".`)
  } else if (lowerQuestion.includes('fat')) {
    insights.unshift(`Regarding fat: your current status is "${macroStatus.fat}".`)
  } else if (lowerQuestion.includes('calor')) {
    const avgCal =
      recentLogs.length > 0
        ? recentLogs.reduce((sum: number, l: any) => sum + l.caloriesTotal, 0) / recentLogs.length
        : 0
    insights.unshift(
      `Your average weekly calorie total over recent weeks is ${Math.round(avgCal)} kcal.`,
    )
  }

  return {
    insight: insights.length > 0 ? insights.join(' ') : 'Not enough data to provide detailed insights yet.',
    recommendations,
    macroStatus,
  }
}

/**
 * Analyze macro percentages against targets.
 */
function analyzeMacroStatus(
  balance: NutrientBalance | undefined,
): { protein: 'low' | 'ok' | 'high'; carbohydrates: 'low' | 'ok' | 'high'; fat: 'low' | 'ok' | 'high' } {
  if (!balance) {
    return { protein: 'ok', carbohydrates: 'ok', fat: 'ok' }
  }

  const percentages = nutrientsToPercentages(balance)

  const threshold = 5 // percentage points tolerance

  return {
    protein: classifyMacro(percentages.protein, TARGET_MACROS.protein, threshold),
    carbohydrates: classifyMacro(percentages.carbohydrates, TARGET_MACROS.carbohydrates, threshold),
    fat: classifyMacro(percentages.fat, TARGET_MACROS.fat, threshold),
  }
}

function classifyMacro(actual: number, target: number, threshold: number): 'low' | 'ok' | 'high' {
  if (actual < target - threshold) return 'low'
  if (actual > target + threshold) return 'high'
  return 'ok'
}
