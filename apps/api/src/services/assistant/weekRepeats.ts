import { isTaperVariant } from '@ona/shared'
import { normalizeText } from '../dietaryRestrictions.js'
import { MEAL_LABEL_ES } from '../menuText.js'
import { menuDayOf } from './menuDay.js'

/**
 * PRO-238 (2026-10-19): Mimo put «pollo empanado» on Tuesday without seeing
 * it was already on Sunday («Tienes razón. El domingo 25 ya había pollo
 * empanado de cena»), and offered pizza or croquetas that were already on
 * Friday and Saturday. Now every tool that places a dish looks at the rest of
 * the week and its summary says where the same dish (same recipe, or the
 * same name) already is, so Mimo tells the user. Leftovers and tápers of a
 * dish are the plan, not a repeat. Pure.
 */
type LooseDish = { kind: string; recipeId?: string; recipeName?: string; text?: string; variant?: string }
type WeekDays = readonly (Record<string, { dishes?: readonly LooseDish[] } | undefined> | null | undefined)[]

export function sameDishElsewhere(
  days: WeekDays,
  weekStart: string,
  dayIndex: number,
  meal: string,
  dish: { recipeId?: string | null; name: string },
): string[] {
  const name = normalizeText(dish.name).trim()
  const out: string[] = []
  days.forEach((day, d) => {
    for (const [m, slot] of Object.entries(day ?? {})) {
      if (d === dayIndex && m === meal) continue
      const hit = (slot?.dishes ?? []).some((x) => {
        if (x.kind === 'recipe') {
          if (x.variant === 'leftover' || isTaperVariant(x.variant)) return false
          return (dish.recipeId != null && x.recipeId === dish.recipeId) || (!!name && normalizeText(x.recipeName ?? '').trim() === name)
        }
        return x.kind === 'note' && !!name && normalizeText(x.text ?? '').trim() === name
      })
      if (hit) out.push(`la ${MEAL_LABEL_ES[m] ?? m} del ${menuDayOf(weekStart, d).label}`)
    }
  })
  return out
}

/** The line a placing tool appends to its summary, or '' when the dish is nowhere else this week. */
export function repeatNote(
  days: WeekDays,
  weekStart: string,
  dayIndex: number,
  meal: string,
  dish: { recipeId?: string | null; name: string },
): string {
  const where = sameDishElsewhere(days, weekStart, dayIndex, meal, dish)
  if (where.length === 0) return ''
  const list = where.length === 1 ? where[0] : `${where.slice(0, -1).join(', ')} y ${where[where.length - 1]}`
  return ` Ojo: "${dish.name}" ya esta esta semana en ${list}. Diselo al usuario en una frase y ofrece cambiar uno de los dos.`
}
