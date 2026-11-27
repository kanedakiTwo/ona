/**
 * PRO-1262 · Los favoritos en la semana que se hace sola. The Ruiz family
 * (tortilla, macarrones, croquetas, pollo empanado) got from Mimo's Thursday
 * week lamb-stuffed peppers, sfiha and a seafood stew, and changed 6 of 9
 * dishes: the favourites only weigh ×2 in the draw (`pickRandom`), which
 * among hundreds of recipes is nearly nothing. Now a generated week carries
 * at least the share of the household's chosen recipes its own weeks carry:
 * the last `FAVORITE_SHARE_WEEKS` weeks before this one, each as it is now
 * (its newest row), leaving out a week Mimo made on Thursday that nobody
 * changed (no `menu_edits`: it would only copy the draw). «Chosen»: favourites, «Me encanta»,
 * «Me apetece», 5 stars and the dishes they said in the sign-up — not the
 * fridge.
 *
 * Short of it, drawn dishes (a main or a single dish of a lunch or a dinner;
 * never a locked slot, the week type's, a leftover, a táper nor a batch) are
 * swapped for a chosen recipe that fits that slot with the usual rules
 * (`pick`), in random order. Pure but the load.
 */
import { and, desc, gte, inArray, like, lt } from 'drizzle-orm'
import { addDaysIso, isTaperVariant, type DayMenu, type LockedSlots, type RecipeDish } from '@ona/shared'
import { menuEdits, menus, notificationSchedule } from '../db/schema.js'
import { resolveScope, scopeWhere } from './scopeResolver.js'

export const FAVORITE_SHARE_WEEKS = 4

const SHARE_MEALS = new Set(['lunch', 'dinner'])

/** A dish of the draw that counts: a planned recipe, not a leftover, táper, the week type's fixed one nor a batch. */
const counts = (d: unknown): d is RecipeDish => {
  const dish = d as RecipeDish
  return !!dish && dish.kind === 'recipe' && !dish.leftoverOf && dish.variant !== 'leftover' && !isTaperVariant(dish.variant) && !dish.fixedDish
}

/** Pure: the share (0–1) of chosen recipes among the lunch and dinner dishes of these weeks; 0 with none. */
export function favoriteShareOf(weeks: ReadonlyArray<ReadonlyArray<DayMenu | null | undefined>>, chosen: ReadonlySet<string>): number {
  let all = 0
  let fav = 0
  for (const days of weeks) {
    for (const day of days) {
      for (const [meal, slot] of Object.entries(day ?? {})) {
        if (!SHARE_MEALS.has(meal)) continue
        for (const d of slot?.dishes ?? []) {
          if (!counts(d)) continue
          all++
          if (chosen.has(d.recipeId)) fav++
        }
      }
    }
  }
  return all ? fav / all : 0
}

export interface FavoriteShareOptions {
  share: number
  chosen: ReadonlySet<string>
  locked?: LockedSlots
  skippedDays?: ReadonlySet<number>
  /** Slots that aren't the draw's (the week type's preset or táper slots). */
  keep?: (dayIndex: number, meal: string) => boolean
  /** A chosen recipe for that dish of the slot (the week as it is now, recipes already in it in `used`), or null. */
  pick: (dayIndex: number, meal: string, dish: RecipeDish, days: DayMenu[], used: ReadonlySet<string>) => RecipeDish | null
  random?: () => number
}

/** Pure: the week with at least `share` of its lunch and dinner dishes chosen ones, as far as `pick` finds them. */
export function ensureFavoriteShare(days: DayMenu[], o: FavoriteShareOptions): { days: DayMenu[]; swapped: number } {
  if (o.share <= 0 || o.chosen.size === 0) return { days, swapped: 0 }
  const out = days.map((d) => ({ ...(d ?? {}) }))
  const used = new Set<string>()
  let all = 0
  let fav = 0
  const spots: Array<{ dayIndex: number; meal: string; position: number }> = []
  out.forEach((day, dayIndex) => {
    for (const [meal, slot] of Object.entries(day)) {
      for (const d of slot?.dishes ?? []) if (d.kind === 'recipe') used.add(d.recipeId)
      if (!SHARE_MEALS.has(meal)) continue
      const own = !o.skippedDays?.has(dayIndex) && !o.locked?.[String(dayIndex)]?.[meal] && !o.keep?.(dayIndex, meal) && !slot?.taper
      ;(slot?.dishes ?? []).forEach((d, position) => {
        if (!counts(d)) return
        all++
        if (o.chosen.has(d.recipeId)) fav++
        else if (own && !d.batchDate && !d.fromWeekType && (d.course == null || d.course === 'main')) spots.push({ dayIndex, meal, position })
      })
    }
  })
  let missing = Math.ceil(o.share * all - 1e-9) - fav
  if (missing <= 0) return { days, swapped: 0 }
  const random = o.random ?? Math.random
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[spots[i], spots[j]] = [spots[j], spots[i]]
  }
  let swapped = 0
  for (const { dayIndex, meal, position } of spots) {
    if (missing <= 0) break
    const slot = out[dayIndex][meal]!
    const current = slot.dishes[position] as RecipeDish
    const other = o.pick(dayIndex, meal, current, out, used)
    if (!other || !o.chosen.has(other.recipeId) || used.has(other.recipeId)) continue
    const dishes = [...slot.dishes]
    dishes[position] = other
    out[dayIndex][meal] = { ...slot, dishes }
    used.delete(current.recipeId)
    used.add(other.recipeId)
    missing--
    swapped++
  }
  return { days: swapped ? out : days, swapped }
}

/**
 * The household's share of chosen recipes in its last weeks before
 * `weekStart` (each week's newest row; a Thursday week nobody changed left
 * out). 0 on any error.
 */
export async function loadFavoriteShare(userId: string, weekStart: string, chosen: ReadonlySet<string>, db: any): Promise<number> {
  if (chosen.size === 0) return 0
  try {
    const scope = await resolveScope(userId)
    const since = addDaysIso(weekStart.slice(0, 10), -7 * FAVORITE_SHARE_WEEKS)
    const rows = await db
      .select({ id: menus.id, weekStart: menus.weekStart, days: menus.days })
      .from(menus)
      .where(and(scopeWhere(menus.userId, menus.householdId, scope), lt(menus.weekStart, weekStart), gte(menus.weekStart, since)))
      .orderBy(desc(menus.createdAt))
    // The weeks Mimo made on Thursday (PRO-381's claim keeps them) that nobody changed (`menu_edits`).
    const claims = await db
      .select({ payload: notificationSchedule.payload })
      .from(notificationSchedule)
      .where(like(notificationSchedule.dedupKey, `autoplan:${scope.value}:%`))
    const made = (claims as Array<{ payload: { menuId?: string } | null }>).map((c) => c.payload?.menuId).filter((id): id is string => !!id)
    const edited = made.length
      ? new Set(((await db.selectDistinct({ menuId: menuEdits.menuId }).from(menuEdits).where(inArray(menuEdits.menuId, made))) as Array<{ menuId: string }>).map((e) => e.menuId))
      : new Set<string>()
    const untouched = new Set(made.filter((id) => !edited.has(id)))
    const seen = new Set<string>()
    const weeks: DayMenu[][] = []
    for (const r of rows as Array<{ id: string; weekStart: string; days: DayMenu[] }>) {
      const week = String(r.weekStart)
      if (seen.has(week)) continue
      seen.add(week)
      if (!untouched.has(r.id)) weeks.push(r.days ?? [])
    }
    return favoriteShareOf(weeks, chosen)
  } catch {
    return 0
  }
}
