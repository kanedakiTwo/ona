import { and, eq, desc } from 'drizzle-orm'
import { users, menus, userNutrientBalance } from '../../db/schema.js'
import { COOKING_STYLE_LABELS, nutrientsToPercentages, TARGET_MACROS } from '@ona/shared'
import type { NutrientBalance } from '@ona/shared'
import { buildMemoryDigest } from '../userMemoryStore.js'
import { madridParts, mondayOf } from '../madridTime.js'
import { mealLinesForDay } from '../menuText.js'
import { resolveScope, scopeWhere } from '../scopeResolver.js'
import { getCookingStyle } from '../profile/cookingStyle.js'

const DAY_NAMES_LONG = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo']
const hhmm = (h: number, m: number) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`

/**
 * First line of the user context: the date, without the time. The context
 * block sits before the conversation in the request, so anything in it that
 * changes every minute ("son las 14:32", until 2026-10-16) made every message
 * write the context and the whole history to the prompt cache again instead
 * of reading them (`cost_events`: ~4 700 tokens written per message).
 */
export function todayLine(now: Date): string {
  const p = madridParts(now)
  return `Hoy es ${DAY_NAMES_LONG[p.weekday]} ${p.isoDate} (dayIndex ${p.weekday}). La hora va al principio del ultimo mensaje del usuario.`
}

/** The clock, as the first block of the newest user message (engine.ts → buildTurnMessages). */
export function clockNote(now: Date): string {
  const p = madridParts(now)
  return `(Hora de este mensaje: ${hhmm(p.hour, p.minute)} en Madrid)`
}

/**
 * Load lightweight user context for the assistant system prompt.
 * Includes: profile, current menu summary, and macro balance.
 */
export async function loadUserContext(userId: string, db: any): Promise<string> {
  const parts: string[] = []

  // ── User profile ──────────────────────────────────────────
  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)

  if (!user) return 'Usuario no encontrado.'

  // Today in Madrid — the model needs it for "hoy", "mañana", "el jueves".
  // The clock goes in the newest user message instead (clockNote, engine.ts).
  const now = madridParts(new Date())
  parts.push(todayLine(new Date()))

  const profileParts = [`Usuario: ${user.username}`]
  if (user.age) profileParts.push(`${user.age} anos`)
  if (user.weight) profileParts.push(`${user.weight}kg`)
  if (user.height) profileParts.push(`${user.height}cm`)
  if (user.activityLevel && user.activityLevel !== 'none') {
    const activityLabels: Record<string, string> = {
      light: 'actividad ligera',
      moderate: 'actividad moderada',
      intense: 'actividad intensa',
    }
    profileParts.push(activityLabels[user.activityLevel] ?? user.activityLevel)
  }
  parts.push(profileParts.join(', '))

  if (user.restrictions && user.restrictions.length > 0) {
    parts.push(`Restricciones: ${user.restrictions.join(', ')}`)
  }

  const cookingLabels: Record<string, string> = {
    daily: 'cocina a diario',
    '3-4': 'cocina 3-4 veces/semana',
    '1-2': 'cocina 1-2 veces/semana',
    rarely: 'cocina raramente',
  }
  // Render the household as "<adults> adultos + <kidsCount> niños (2–10 años)"
  // so the assistant can reason about portions per person. Falls back to the
  // legacy enum label for users who haven't yet updated to the new schema.
  const legacyHouseholdLabels: Record<string, string> = {
    solo: 'solo',
    couple: 'en pareja',
    family_with_kids: 'familia con ninos',
    family_no_kids: 'familia sin ninos',
  }
  const contextParts: string[] = []
  const adults = (user as { adults?: number | null }).adults
  const kidsCount = (user as { kidsCount?: number | null }).kidsCount
  if (typeof adults === 'number' && adults > 0) {
    const adultsLabel = adults === 1 ? '1 adulto' : `${adults} adultos`
    if (typeof kidsCount === 'number' && kidsCount > 0) {
      const kidsLabel = kidsCount === 1 ? '1 niño (2–10 años)' : `${kidsCount} niños (2–10 años)`
      contextParts.push(`${adultsLabel} + ${kidsLabel}`)
    } else {
      contextParts.push(adultsLabel)
    }
  } else if (user.householdSize) {
    contextParts.push(legacyHouseholdLabels[user.householdSize] ?? user.householdSize)
  }
  if (user.cookingFreq) contextParts.push(cookingLabels[user.cookingFreq] ?? user.cookingFreq)
  // PRO-217: how they cook, from the household's ficha (set_cooking_style changes it).
  try {
    const householdId = (user as { primaryHouseholdId?: string | null }).primaryHouseholdId
    const style = householdId ? await getCookingStyle(householdId, db) : null
    if (style) contextParts.push(`como cocinan: «${COOKING_STYLE_LABELS[style]}»`)
  } catch {
    // The context never fails for this line.
  }
  if (contextParts.length > 0) {
    parts.push(`Hogar: ${contextParts.join(', ')}`)
  }

  if (user.priority) parts.push(`Prioridad: ${user.priority}`)
  if (user.favoriteDishes && user.favoriteDishes.length > 0) {
    parts.push(`Platos favoritos: ${user.favoriteDishes.join(', ')}`)
  }

  // ── This week's menu (Madrid week, household-aware) ─────────
  // Read from `dishes[]` (multi-dish slots); the old `slot.recipeName` shape
  // left this block empty for every menu since the multi-dish migration.
  const weekStart = mondayOf(now.isoDate, now.weekday)
  const [currentMenu] = await db
    .select()
    .from(menus)
    .where(and(scopeWhere(menus.userId, menus.householdId, await resolveScope(userId, db)), eq(menus.weekStart, weekStart)))
    .orderBy(desc(menus.createdAt))
    .limit(1)

  if (currentMenu?.days) {
    const days = currentMenu.days as any[]
    const dayNames = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']
    const menuLines: string[] = []
    for (let i = 0; i < days.length; i++) {
      const lines = mealLinesForDay(days[i])
      if (lines.length > 0) menuLines.push(`  ${dayNames[i] ?? `D${i + 1}`} (dayIndex ${i}): ${lines.join('; ')}`)
    }
    if (menuLines.length > 0) {
      parts.push(`Menu de esta semana (${weekStart}):\n${menuLines.join('\n')}`)
    }
  } else {
    parts.push(`No hay menu para esta semana (${weekStart}).`)
  }

  // ── Nutrient balance ──────────────────────────────────────
  const [balance] = await db
    .select()
    .from(userNutrientBalance)
    .where(eq(userNutrientBalance.userId, userId))
    .limit(1)

  if (balance?.balance) {
    const b = balance.balance as NutrientBalance
    const pct = nutrientsToPercentages(b)
    parts.push(
      `Balance: proteina ${pct.protein.toFixed(1)}%, carbohidratos ${pct.carbohydrates.toFixed(1)}%, grasa ${pct.fat.toFixed(1)}% ` +
      `(objetivo: ${TARGET_MACROS.protein}/${TARGET_MACROS.carbohydrates}/${TARGET_MACROS.fat})`
    )
  }

  // ── User memory digest ────────────────────────────────────
  // Pulled last so it sits at the bottom of the system prompt — closest to
  // the user's next message, where the model anchors. Empty when the user
  // hasn't recorded any preferences (no extra noise on the prompt).
  const memoryDigest = await buildMemoryDigest(userId).catch(() => '')
  if (memoryDigest) parts.push(memoryDigest)

  return parts.join('\n')
}
