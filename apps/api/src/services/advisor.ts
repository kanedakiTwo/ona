import { eq, desc } from 'drizzle-orm'
import { menuLogs, userNutrientBalance, menus, recipes } from '../db/schema.js'
import { TARGET_MACROS, nutrientsToPercentages } from '@ona/shared'
import type { NutrientBalance } from '@ona/shared'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { readdir, readFile } from 'fs/promises'
import path from 'path'
import { fileURLToPath } from 'url'

const execFileAsync = promisify(execFile)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Load all knowledge base files from /kb at startup
let knowledgeBase = ''
async function loadKB() {
  const kbDir = path.resolve(__dirname, '..', '..', '..', '..', 'kb')
  try {
    const files = await readdir(kbDir)
    const mdFiles = files.filter(f => f.endsWith('.md'))
    const contents = await Promise.all(
      mdFiles.map(f => readFile(path.join(kbDir, f), 'utf-8'))
    )
    knowledgeBase = contents.join('\n\n---\n\n')
    console.log(`Loaded ${mdFiles.length} KB file(s): ${mdFiles.join(', ')}`)
  } catch {
    console.log('No KB directory found, advisor will work without knowledge base.')
  }
}
loadKB()

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

// ───────────────────────────────────────────────
// getSummary
// ───────────────────────────────────────────────

export async function getSummary(
  userId: string,
  weeks: number,
  db: any,
): Promise<SummaryResult> {
  const logs = await db
    .select()
    .from(menuLogs)
    .where(eq(menuLogs.userId, userId))
    .orderBy(desc(menuLogs.weekStart))
    .limit(weeks)

  if (logs.length === 0) {
    return {
      weeks: [],
      averageCalories: 0,
      averageMacros: { protein: 0, carbohydrates: 0, fat: 0 },
      trend: 'stable',
    }
  }

  const weekSummaries: WeeklySummary[] = logs.map((log: any) => ({
    weekStart: log.weekStart,
    caloriesTotal: log.caloriesTotal,
    nutrients: log.aggregatedNutrients as NutrientBalance,
  }))

  const totalCalories = weekSummaries.reduce((sum, w) => sum + w.caloriesTotal, 0)
  const averageCalories = totalCalories / weekSummaries.length

  const averageMacros: NutrientBalance = {
    protein: weekSummaries.reduce((sum, w) => sum + (w.nutrients?.protein ?? 0), 0) / weekSummaries.length,
    carbohydrates: weekSummaries.reduce((sum, w) => sum + (w.nutrients?.carbohydrates ?? 0), 0) / weekSummaries.length,
    fat: weekSummaries.reduce((sum, w) => sum + (w.nutrients?.fat ?? 0), 0) / weekSummaries.length,
  }

  let trend: 'improving' | 'stable' | 'declining' = 'stable'
  if (weekSummaries.length >= 2) {
    const recent = weekSummaries[0].caloriesTotal
    const older = weekSummaries[weekSummaries.length - 1].caloriesTotal
    const change = older !== 0 ? Math.abs((recent - older) / older) * 100 : 0
    if (change >= 5) {
      const pct = nutrientsToPercentages(weekSummaries[0].nutrients)
      const diff = Math.abs(pct.carbohydrates - TARGET_MACROS.carbohydrates)
        + Math.abs(pct.fat - TARGET_MACROS.fat)
        + Math.abs(pct.protein - TARGET_MACROS.protein)
      trend = diff < 15 ? 'improving' : 'declining'
    }
  }

  return { weeks: weekSummaries, averageCalories, averageMacros, trend }
}

// ───────────────────────────────────────────────
// askAdvisor — powered by `claude -p`
// ───────────────────────────────────────────────

function buildSystemPrompt(): string {
  const base = `Eres el asesor nutricional de ONA, una app de planificacion de menus semanales.

Tu personalidad:
- Hablas en espanol, de tu, tono cercano pero informado.
- No juzgas. No moralizas. Informas con datos y das recomendaciones practicas.
- Eres breve: respuestas de 2-4 frases maximo. No hagas listas largas.
- Si no hay datos suficientes, dilo claramente y sugiere generar mas menus.
- No uses markdown, ni asteriscos, ni formato. Solo texto plano.

Responderas basandote en los datos nutricionales reales del usuario que te paso.`

  if (knowledgeBase) {
    return `${base}

A continuacion tienes la base de conocimiento nutricional de ONA. Usala como marco para tus respuestas, pero no la impongas al usuario ni la cites textualmente — integra los principios de forma natural en tus consejos:

${knowledgeBase}`
  }

  return base
}

export async function askAdvisor(
  userId: string,
  question: string,
  db: any,
): Promise<{ insight: string; recommendations: string[] }> {
  // Gather all user context
  const [balance] = await db
    .select()
    .from(userNutrientBalance)
    .where(eq(userNutrientBalance.userId, userId))
    .limit(1)

  const recentLogs = await db
    .select()
    .from(menuLogs)
    .where(eq(menuLogs.userId, userId))
    .orderBy(desc(menuLogs.weekStart))
    .limit(4)

  // Current menu (most recent)
  const [currentMenu] = await db
    .select()
    .from(menus)
    .where(eq(menus.userId, userId))
    .orderBy(desc(menus.createdAt))
    .limit(1)

  // Available recipes catalog
  const allRecipes = await db
    .select({ id: recipes.id, name: recipes.name, meals: recipes.meals, seasons: recipes.seasons, prepTime: recipes.prepTime })
    .from(recipes)

  const context = buildUserContext(
    balance?.balance as NutrientBalance | undefined,
    recentLogs,
    currentMenu,
    allRecipes,
  )

  // Build the full prompt
  const fullPrompt = `${buildSystemPrompt()}\n\nDatos del usuario:\n${context}\n\nPregunta del usuario: ${question}`

  try {
    const { stdout } = await execFileAsync('claude', ['-p', fullPrompt], {
      timeout: 30000,
      env: { ...process.env, NO_COLOR: '1' },
    })

    const text = stdout.trim()
    if (!text) {
      return fallback(balance?.balance as NutrientBalance | undefined, recentLogs)
    }

    // Split into insight (first line) and recommendations (rest)
    const lines = text.split('\n').filter(l => l.trim())
    return {
      insight: lines[0],
      recommendations: lines.slice(1).map(l => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean),
    }
  } catch (err: any) {
    console.error('claude -p error:', err.message)
    return fallback(balance?.balance as NutrientBalance | undefined, recentLogs)
  }
}

// ───────────────────────────────────────────────
// Helpers
// ───────────────────────────────────────────────

function buildUserContext(balance: NutrientBalance | undefined, logs: any[], currentMenu?: any, availableRecipes?: any[]): string {
  if (!balance && logs.length === 0) {
    return 'El usuario aun no tiene datos. No ha generado ningun menu semanal.'
  }

  const parts: string[] = []

  if (balance) {
    const pct = nutrientsToPercentages(balance)
    parts.push(`Balance actual (EMA): proteina ${pct.protein.toFixed(1)}%, carbohidratos ${pct.carbohydrates.toFixed(1)}%, grasa ${pct.fat.toFixed(1)}%`)
    parts.push(`Objetivo ONA: proteina ${TARGET_MACROS.protein}%, carbohidratos ${TARGET_MACROS.carbohydrates}%, grasa ${TARGET_MACROS.fat}%`)
  }

  if (logs.length > 0) {
    const avgCal = logs.reduce((s: number, l: any) => s + l.caloriesTotal, 0) / logs.length
    parts.push(`Calorias promedio semanal (ultimas ${logs.length} semanas): ${Math.round(avgCal)} kcal`)

    const latest = logs[0]
    if (latest.aggregatedNutrients) {
      const n = latest.aggregatedNutrients as NutrientBalance
      parts.push(`Ultima semana: proteina ${Math.round(n.protein)}g, carbohidratos ${Math.round(n.carbohydrates)}g, grasa ${Math.round(n.fat)}g`)
    }
  }

  // Current menu — what the user is eating this week
  if (currentMenu?.days) {
    const days = currentMenu.days as any[]
    const dayNames = ['Lunes', 'Martes', 'Miercoles', 'Jueves', 'Viernes', 'Sabado', 'Domingo']
    const menuLines: string[] = []
    for (let i = 0; i < days.length; i++) {
      const day = days[i]
      const meals = Object.entries(day)
        .filter(([, slot]: any) => slot?.recipeName)
        .map(([meal, slot]: any) => `${meal}: ${slot.recipeName}`)
      if (meals.length > 0) {
        menuLines.push(`  ${dayNames[i] ?? `Dia ${i + 1}`}: ${meals.join(', ')}`)
      }
    }
    if (menuLines.length > 0) {
      parts.push(`Menu actual del usuario (semana del ${currentMenu.weekStart}):\n${menuLines.join('\n')}`)
    }
  }

  // Available recipes — so the advisor can suggest alternatives
  if (availableRecipes && availableRecipes.length > 0) {
    const recipeList = availableRecipes
      .map((r: any) => `${r.name} (${r.meals?.join('/')}, ${r.prepTime ?? '?'}min)`)
      .join(', ')
    parts.push(`Recetas disponibles en el catalogo (${availableRecipes.length}): ${recipeList}`)
  }

  parts.push(`Semanas con datos: ${logs.length}`)
  return parts.join('\n')
}

function fallback(balance: NutrientBalance | undefined, logs: any[]): { insight: string; recommendations: string[] } {
  if (!balance && logs.length === 0) {
    return {
      insight: 'Todavia no tengo datos tuyos. Genera tu primer menu semanal y vuelve a preguntarme.',
      recommendations: [],
    }
  }

  const pct = balance ? nutrientsToPercentages(balance) : null
  const insights: string[] = []
  const recs: string[] = []

  if (pct) {
    if (pct.protein < TARGET_MACROS.protein - 5) {
      insights.push(`Tu proteina esta en ${pct.protein.toFixed(0)}% (objetivo: ${TARGET_MACROS.protein}%).`)
      recs.push('Anade mas legumbres, huevos o carnes magras.')
    }
    if (pct.carbohydrates > TARGET_MACROS.carbohydrates + 5) {
      insights.push(`Tus carbohidratos estan en ${pct.carbohydrates.toFixed(0)}% (objetivo: ${TARGET_MACROS.carbohydrates}%).`)
      recs.push('Sustituye parte de los cereales por verduras.')
    }
    if (pct.fat > TARGET_MACROS.fat + 5) {
      insights.push(`Tu grasa esta en ${pct.fat.toFixed(0)}% (objetivo: ${TARGET_MACROS.fat}%).`)
      recs.push('Reduce aceites y elige proteinas mas magras.')
    }
  }

  return {
    insight: insights.length > 0 ? insights.join(' ') : 'Tu balance nutricional se ve bien. Sigue asi.',
    recommendations: recs,
  }
}
