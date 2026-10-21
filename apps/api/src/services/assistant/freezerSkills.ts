import { freezerItemsDue, isTaperVariant } from '@ona/shared'
import { appApiFor, AppApiError, type AppApi } from './appApi.js'
import { bestMatch, normalize } from './appSkills.js'
import { findRecipesWithWhatIHave } from '../withWhatIHave.js'
import { madridParts, mondayOf } from '../madridTime.js'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'

/**
 * PRO-228 · «Sí, mételo» to the monthly freezer review: puts what has been in
 * the freezer for 4+ weeks into the menus of the next two weeks.
 *   - A catalogue ingredient (merluza, pechugas) → a recipe the household can
 *     eat that uses it (`findRecipesWithWhatIHave`: allergies, diets and
 *     dislikes respected) replaces the dish of a free meal.
 *   - A cooked táper written by hand («lentejas estofadas») that names a
 *     recipe → that recipe as «Del congelador» (adds nothing to the list).
 * One thing per day, from tomorrow, in the dinner (else the lunch) of an
 * existing menu; locked meals, leftovers, freezer dishes and skipped days are
 * left alone. Weeks without a menu are reported, never generated here.
 */

const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const MEAL_ES: Record<string, string> = { lunch: 'comida', dinner: 'cena' }
export const FREEZER_PLAN_DAYS = 14

const api = (ctx: SkillContext): AppApi =>
  ctx.api ?? appApiFor(ctx.userId, { channel: ctx.channel === 'whatsapp' ? 'whatsapp' : 'web' })

interface PantryRow { id: string; name: string; ingredientId: string | null; quantity: number; unit: string; location?: string; storedAt?: string; createdAt: string }
interface Dish { kind: string; recipeId?: string; recipeName?: string; variant?: string }
interface MenuDoc {
  id: string
  days: Array<Record<string, { dishes?: Dish[] } | undefined>>
  locked?: Record<string, Record<string, boolean>>
  skippedDays?: number[]
}

/** The next `n` days from tomorrow (Madrid): week Monday + day index. */
export function nextDays(now: Date, n: number = FREEZER_PLAN_DAYS): Array<{ weekStart: string; dayIndex: number; isoDate: string }> {
  const p = madridParts(now)
  const base = Date.parse(`${p.isoDate}T12:00:00Z`)
  return Array.from({ length: n }, (_, i) => {
    const iso = new Date(base + (i + 1) * 86_400_000).toISOString().slice(0, 10)
    const weekday = (new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7
    return { weekStart: mondayOf(iso, weekday), dayIndex: weekday, isoDate: iso }
  })
}

/** The meal of that day we may use: dinner, else lunch; free of locks, leftovers and freezer dishes. */
export function freeMealOf(menu: MenuDoc, dayIndex: number): string | null {
  if (menu.skippedDays?.includes(dayIndex)) return null
  for (const meal of ['dinner', 'lunch']) {
    const slot = menu.days?.[dayIndex]?.[meal]
    if (!slot) continue
    if (menu.locked?.[String(dayIndex)]?.[meal]) continue
    if ((slot.dishes ?? []).some((d) => d.variant === 'leftover' || isTaperVariant(d.variant) || (d as any).leftoverOf)) continue
    return meal
  }
  return null
}

/**
 * A hand-written row is a cooked táper when it says so («táper de lentejas»,
 * «albóndigas caseras») or is exactly a recipe's name; «pechugas de pollo»
 * is an ingredient, not a dish.
 */
export function taperRecipe<H extends { recipe: { name: string } }>(hits: H[], itemName: string): H | null {
  const n = normalize(itemName)
  const said = /\b(taper|tapers|guiso|cocinad[oa]s?|caser[oa]s?|hech[oa]s?|sobras?)\b/.test(n)
  const bare = n.replace(/\b(taper|tapers|de|del|guiso|cocinad[oa]s?|caser[oa]s?|hech[oa]s?|sobras?)\b/g, ' ').replace(/\s+/g, ' ').trim()
  const exact = hits.find((h) => normalize(h.recipe.name) === n)
  if (exact) return exact
  if (!said || !bare) return null
  return bestMatch(hits, bare, (h) => h.recipe.name)
}

async function loadMenu(ctx: SkillContext, weekStart: string): Promise<MenuDoc | null> {
  try {
    return await api(ctx)<MenuDoc>('GET', `/menu/${ctx.userId}/${weekStart}`)
  } catch (err) {
    if (err instanceof AppApiError && err.status === 404) return null
    throw err
  }
}

const dateEs = (iso: string) => {
  const d = new Date(`${iso}T12:00:00Z`)
  return `${DAY_NAMES[(d.getUTCDay() + 6) % 7]} ${d.getUTCDate()}`
}

export const planFreezerItems: SkillDefinition = {
  name: 'plan_freezer_items',
  description:
    'Mete en el menu de las dos proximas semanas lo que lleva un mes o mas en el congelador (respuesta "Si, metelo" al repaso mensual del congelador, o "mete lo del congelador en el menu"). Una cosa por dia desde mañana, en la cena (si no, en la comida); no toca comidas fijadas, sobras ni dias sin cocinar. Sin names, todo lo que lleva 4 semanas o mas; con names, solo eso.',
  parameters: {
    type: 'object',
    properties: {
      names: { type: 'array', items: { type: 'string' }, description: 'Solo estas cosas del congelador (si el usuario elige)' },
    },
    required: [],
  },
  async handler(p: { names?: string[] }, ctx: SkillContext): Promise<SkillResult> {
    const now = new Date()
    const rows = await api(ctx)<PantryRow[]>('GET', '/pantry?location=congelador')
    let items: PantryRow[] = Array.isArray(p?.names) && p.names.length
      ? p.names.map((n) => bestMatch(rows, String(n), (r) => r.name)).filter((r): r is PantryRow => !!r)
      : freezerItemsDue(rows, now)
    items = [...new Map(items.map((i) => [i.id, i])).values()]
    if (items.length === 0) {
      return { data: { placed: [] }, summary: 'No hay nada en el congelador que lleve un mes o mas; no he cambiado nada.', uiHint: 'text' }
    }

    const days = nextDays(now)
    const menus = new Map<string, MenuDoc | null>()
    for (const w of [...new Set(days.map((d) => d.weekStart))]) menus.set(w, await loadMenu(ctx, w))
    const usedDays = new Set<string>()
    const usedRecipes = new Set<string>()
    const placed: Array<{ item: string; recipe: string; date: string; meal: string; freezer: boolean }> = []
    const notPlaced: Array<{ item: string; reason: string }> = []

    for (const item of items) {
      // Which recipe: a táper that names a recipe, else a recipe that uses it.
      const hits = await findRecipesWithWhatIHave(ctx.userId, [{ ...(item.ingredientId ? { id: item.ingredientId } : {}), name: item.name }], ctx.db, 30)
      const fresh = hits.filter((h) => !usedRecipes.has(h.recipe.id))
      const named = !item.ingredientId ? taperRecipe(fresh, item.name) : null
      const asTaper = !!named
      const hit = named ?? fresh.find((h) => h.uses.length > 0) ?? null
      if (!hit) {
        notPlaced.push({ item: item.name, reason: 'no tengo ninguna receta que lo use y encaje con vuestra casa' })
        continue
      }
      const spot = days
        .filter((d) => !usedDays.has(d.isoDate))
        .map((d) => ({ d, menu: menus.get(d.weekStart) ?? null }))
        .map(({ d, menu }) => ({ d, menu, meal: menu ? freeMealOf(menu, d.dayIndex) : null }))
        .find((x) => x.menu && x.meal)
      if (!spot || !spot.menu || !spot.meal) {
        notPlaced.push({ item: item.name, reason: 'no queda ninguna comida libre en los menus de estas dos semanas' })
        continue
      }
      const path = `/menu/${spot.menu.id}/day/${spot.d.dayIndex}/meal/${spot.meal}`
      if (asTaper) {
        await api(ctx)('DELETE', path)
        await api(ctx)('POST', `${path}/dish`, { kind: 'recipe', recipeId: hit.recipe.id, variant: 'freezer' })
      } else {
        await api(ctx)('PUT', path, { recipeId: hit.recipe.id })
      }
      usedDays.add(spot.d.isoDate)
      usedRecipes.add(hit.recipe.id)
      placed.push({ item: item.name, recipe: hit.recipe.name, date: spot.d.isoDate, meal: spot.meal, freezer: asTaper })
    }

    const noMenuWeeks = [...menus.entries()].filter(([, m]) => !m).map(([w]) => w)
    const lines = placed.map((x) => `- ${x.item}: ${x.recipe}${x.freezer ? ' (del congelador, no suma a la compra)' : ''}, ${MEAL_ES[x.meal]} del ${dateEs(x.date)}`)
    const missing = notPlaced.map((x) => `- ${x.item}: ${x.reason}`)
    const weeks = noMenuWeeks.length
      ? `\nLa semana del ${noMenuWeeks.map((w) => dateEs(w)).join(' y la del ')} aun no tiene menu: no he metido nada en ella.`
      : ''
    return {
      data: { placed, notPlaced, noMenuWeeks },
      summary: [
        placed.length ? `Hecho, en el menu:\n${lines.join('\n')}` : 'No he podido meter nada en el menu.',
        missing.length ? `Sin meter:\n${missing.join('\n')}` : '',
        weeks,
      ].filter(Boolean).join('\n'),
      uiHint: placed.length ? 'menu' : 'text',
    }
  },
}

export const freezerSkills: SkillDefinition[] = [planFreezerItems]
