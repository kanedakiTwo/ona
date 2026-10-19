import { appApiFor, AppApiError, type AppApi } from './appApi.js'
import { DAY_PROP, isMenuDayError, resolveMenuDay } from './menuDay.js'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'

/**
 * PRO-223 · «mañana me llevo táper» to Mimo (web chat and WhatsApp): the same
 * route as the app (`POST/DELETE /menu/:menuId/day/:day/meal/:meal/taper`),
 * so the dinner before gets one more ration per táper and the list counts it once.
 */
const api = (ctx: SkillContext): AppApi =>
  ctx.api ?? appApiFor(ctx.userId, { channel: ctx.channel === 'whatsapp' ? 'whatsapp' : 'web' })
const text = (summary: string, data: unknown = null): SkillResult => ({ data, summary, uiHint: 'text' })
const MEAL_ES: Record<string, string> = { breakfast: 'desayuno', lunch: 'comida', snack: 'merienda' }
const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']

export const setTaper: SkillDefinition = {
  name: 'set_taper',
  description:
    'Marca una comida como "taper" ("mañana me llevo taper", "el jueves como fuera, me llevo la cena del miercoles"): esa comida pasa a ser las sobras de la cena del dia anterior y esa cena se cocina (y se compra) con una racion mas por cada taper. remove=true lo quita. Por defecto la comida (lunch) del dia que diga.',
  parameters: {
    type: 'object',
    properties: {
      day: DAY_PROP,
      meal: { type: 'string', enum: ['breakfast', 'lunch', 'snack'], description: 'Por defecto lunch (la comida de mediodia)' },
      count: { type: 'integer', minimum: 1, maximum: 6, description: 'Cuantos tapers (por defecto 1)' },
      remove: { type: 'boolean', description: 'true para quitar el taper de esa comida' },
    },
    required: ['day'],
  },
  async handler(p: { day?: string; meal?: string; count?: number; remove?: boolean }, ctx: SkillContext): Promise<SkillResult> {
    const t = resolveMenuDay({ day: p.day })
    if (isMenuDayError(t)) return text(t.error)
    const meal = p.meal && MEAL_ES[p.meal] ? p.meal : 'lunch'
    let menu: { id: string; days: any[] } | null = null
    try {
      menu = await api(ctx)('GET', `/menu/${ctx.userId}/${t.weekStart}`)
    } catch (err) {
      if (!(err instanceof AppApiError && err.status === 404)) throw err
    }
    if (!menu) return text(`No hay menú para la semana del ${t.label}; no he cambiado nada. Puedes generarlo con generate_weekly_menu.`)
    const path = `/menu/${menu.id}/day/${t.dayIndex}/meal/${meal}/taper`
    const where = `la ${MEAL_ES[meal]} del ${t.label}`
    try {
      if (p.remove) {
        await api(ctx)('DELETE', path)
        return { data: { day: t.dayIndex, meal, removed: true }, summary: `Hecho: ${where} ya no es táper; queda vacía para que pongas otra cosa.`, uiHint: 'menu' }
      }
      const count = typeof p.count === 'number' ? p.count : 1
      const updated = await api(ctx)<{ days: any[] }>('POST', path, { count })
      const dish = updated?.days?.[t.dayIndex]?.[meal]?.dishes?.find((d: any) => d.kind === 'recipe')
      const name = dish?.recipeName ?? 'la cena'
      return {
        data: { day: t.dayIndex, meal, count, recipeName: name },
        summary: `Hecho: ${where} es táper de «${name}» (la cena del ${DAY_NAMES[t.dayIndex - 1]}), que ahora se hace con ${count === 1 ? 'una ración más' : `${count} raciones más`}; la lista ya lo cuenta.`,
        uiHint: 'menu',
      }
    } catch (err) {
      if (err instanceof AppApiError && err.status < 500) return text(`No he cambiado nada: ${err.message}`)
      throw err
    }
  },
}

export const taperSkills: SkillDefinition[] = [setTaper]
