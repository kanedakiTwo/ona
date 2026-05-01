import { eq, desc } from 'drizzle-orm'
import { users, menus, userNutrientBalance } from '../../db/schema.js'
import { nutrientsToPercentages, TARGET_MACROS } from '@ona/shared'
import type { NutrientBalance } from '@ona/shared'

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

  const householdLabels: Record<string, string> = {
    solo: 'solo',
    couple: 'en pareja',
    family_with_kids: 'familia con ninos',
    family_no_kids: 'familia sin ninos',
  }
  const cookingLabels: Record<string, string> = {
    daily: 'cocina a diario',
    '3-4': 'cocina 3-4 veces/semana',
    '1-2': 'cocina 1-2 veces/semana',
    rarely: 'cocina raramente',
  }

  const contextParts: string[] = []
  if (user.householdSize) contextParts.push(householdLabels[user.householdSize] ?? user.householdSize)
  if (user.cookingFreq) contextParts.push(cookingLabels[user.cookingFreq] ?? user.cookingFreq)
  if (contextParts.length > 0) {
    parts.push(`Hogar: ${contextParts.join(', ')}`)
  }

  if (user.priority) parts.push(`Prioridad: ${user.priority}`)
  if (user.favoriteDishes && user.favoriteDishes.length > 0) {
    parts.push(`Platos favoritos: ${user.favoriteDishes.join(', ')}`)
  }

  // ── Current menu summary ──────────────────────────────────
  const [currentMenu] = await db
    .select()
    .from(menus)
    .where(eq(menus.userId, userId))
    .orderBy(desc(menus.createdAt))
    .limit(1)

  if (currentMenu?.days) {
    const days = currentMenu.days as any[]
    const dayNames = ['Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab', 'Dom']
    const menuLines: string[] = []

    for (let i = 0; i < days.length; i++) {
      const day = days[i]
      const meals = Object.entries(day)
        .filter(([, slot]: any) => slot?.recipeName)
        .map(([meal, slot]: any) => `${meal}=${slot.recipeName}`)
      if (meals.length > 0) {
        menuLines.push(`  ${dayNames[i] ?? `D${i + 1}`}: ${meals.join(', ')}`)
      }
    }

    if (menuLines.length > 0) {
      parts.push(`Menu actual (semana ${currentMenu.weekStart}):\n${menuLines.join('\n')}`)
    }
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

  return parts.join('\n')
}
