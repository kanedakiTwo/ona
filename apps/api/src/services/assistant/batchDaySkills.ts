import { isBatchCooked, isTaperVariant, isValidBatchDate, BATCH_MAX_DAYS_BEFORE } from '@ona/shared'
import { appApiFor, AppApiError, type AppApi } from './appApi.js'
import { DAY_PROP, isMenuDayError, resolveMenuDay, type MenuDay } from './menuDay.js'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'

/**
 * PRO-1046 · el día de lote. Dani y Sara cook on Sunday for Monday to
 * Thursday; Mimo had no way to say so and wrote a note on Sunday («La app no
 * tiene una forma de marcar un día como día de batch»), while the menu kept
 * the dishes as cooked on their own day. Now Mimo marks each dish of the
 * batch (`PATCH …/dish/:position { batchDate }`, the same route as the
 * app's «Lo cocino en el lote»): the batch day shows «Cocinas hoy: … ×N
 * (para lunes a jueves)» and those meals are tápers. The list doesn't change.
 */
const api = (ctx: SkillContext): AppApi =>
  ctx.api ?? appApiFor(ctx.userId, { channel: ctx.channel === 'whatsapp' ? 'whatsapp' : 'web' })
const text = (summary: string, data: unknown = null): SkillResult => ({ data, summary, uiHint: 'text' })
const MEAL_ES: Record<string, string> = { breakfast: 'desayuno', lunch: 'comida', snack: 'merienda', dinner: 'cena' }
const MEALS = Object.keys(MEAL_ES)

type MenuDoc = { id: string; days: Array<Record<string, { dishes?: Array<{ kind: string; recipeName?: string; variant?: string | null; batchDate?: string | null }> }> | null> }

async function loadMenu(ctx: SkillContext, weekStart: string): Promise<MenuDoc | null> {
  try {
    return await api(ctx)<MenuDoc>('GET', `/menu/${ctx.userId}/${weekStart}`)
  } catch (err) {
    if (err instanceof AppApiError && err.status === 404) return null
    throw err
  }
}

export const setBatchDay: SkillDefinition = {
  name: 'set_batch_day',
  description:
    'Dia de lote (batch cooking): el hogar cocina un dia platos de los dias siguientes ("el domingo hacemos batch del chili de lunes a jueves", "el arroz del viernes lo hago en el lote del domingo y lo congelo"). Marca cada plato del menu (dishes: su dia y comida; si hay sobras planificadas, solo el primer dia, las sobras van con el) como cocinado en el lote de batchDay: ese dia el menu enseña «Cocinas hoy: … ×N (para lunes a jueves)» y esas comidas salen como taper. La lista de la compra no cambia (se compra igual). El lote va de 1 a 6 dias antes de cada comida (la semana de antes cuenta). remove=true lo quita: vuelven a cocinarse su dia. No escribas notas para esto.',
  parameters: {
    type: 'object',
    properties: {
      batchDay: { ...DAY_PROP, description: `El dia en que se cocina el lote. ${DAY_PROP.description}` },
      dishes: {
        type: 'array',
        minItems: 1,
        maxItems: 10,
        description: 'Las comidas cuyo plato se cocina en el lote',
        items: {
          type: 'object',
          properties: {
            day: DAY_PROP,
            meal: { type: 'string', enum: MEALS, description: 'breakfast, lunch (comida), snack o dinner (cena)' },
          },
          required: ['day', 'meal'],
        },
      },
      remove: { type: 'boolean', description: 'true para que esos platos ya no salgan del lote' },
    },
    required: ['dishes'],
  },
  async handler(p: { batchDay?: string; dishes?: Array<{ day?: string; meal?: string }>; remove?: boolean }, ctx: SkillContext): Promise<SkillResult> {
    const remove = p.remove === true
    let batch: MenuDay | null = null
    if (!remove) {
      const b = resolveMenuDay({ day: p.batchDay })
      if (isMenuDayError(b)) return text(b.error)
      batch = b
    }
    const wanted = Array.isArray(p.dishes) ? p.dishes.slice(0, 10) : []
    if (wanted.length === 0) return text('Falta qué platos van en el lote (dishes con day y meal). No he cambiado nada.')
    const done: string[] = []
    const skipped: string[] = []
    const menus = new Map<string, MenuDoc | null>()
    for (const w of wanted) {
      const t = resolveMenuDay({ day: w.day })
      if (isMenuDayError(t)) { skipped.push(t.error); continue }
      const meal = typeof w.meal === 'string' && MEAL_ES[w.meal] ? w.meal : null
      if (!meal) { skipped.push(`${t.label}: falta la comida (lunch o dinner)`); continue }
      const where = `${MEAL_ES[meal]} del ${t.label}`
      if (batch && !isValidBatchDate(batch.isoDate, t.isoDate)) {
        skipped.push(`${where}: el lote tiene que ser de 1 a ${BATCH_MAX_DAYS_BEFORE} días antes`)
        continue
      }
      if (!menus.has(t.weekStart)) menus.set(t.weekStart, await loadMenu(ctx, t.weekStart))
      const menu = menus.get(t.weekStart)
      if (!menu) { skipped.push(`${where}: no hay menú esa semana`); continue }
      const dishes = menu.days[t.dayIndex]?.[meal]?.dishes ?? []
      const position = remove
        ? dishes.findIndex((d) => isBatchCooked(d as never))
        : dishes.findIndex((d) => d.kind === 'recipe' && d.variant !== 'leftover' && !isTaperVariant(d.variant))
      if (position < 0) {
        const leftover = dishes.some((d) => d.kind === 'recipe' && d.variant === 'leftover')
        skipped.push(
          remove
            ? `${where}: no estaba en ningún lote`
            : leftover
              ? `${where}: son sobras, ya salen del lote de su plato`
              : `${where}: no tiene una receta que cocinar`,
        )
        continue
      }
      const name = dishes[position].recipeName ?? 'el plato'
      try {
        await api(ctx)('PATCH', `/menu/${menu.id}/day/${t.dayIndex}/meal/${meal}/dish/${position}`, { batchDate: batch ? batch.isoDate : null })
        done.push(`«${name}» (${where})`)
      } catch (err) {
        if (err instanceof AppApiError && err.status < 500) { skipped.push(`${where}: ${err.message}`); continue }
        throw err
      }
    }
    const notDone = skipped.length ? ` Sin cambiar: ${skipped.join('; ')}.` : ''
    if (done.length === 0) return text(`No he cambiado nada.${notDone}`)
    const summary = batch
      ? `Hecho: el ${batch.label} es día de lote: ${done.join(', ')}. Ese día el menú enseña «Cocinas hoy» con las raciones de cada plato (sobras incluidas) y esas comidas salen como táper; la lista de la compra no cambia.${notDone}`
      : `Hecho: ${done.join(', ')} ya no salen del lote; se cocinan su día.${notDone}`
    return { data: { batchDate: batch?.isoDate ?? null, dishes: done }, summary, uiHint: 'menu' }
  },
}

export const batchDaySkills: SkillDefinition[] = [setBatchDay]
