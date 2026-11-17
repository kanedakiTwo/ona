import { isIsoDay, type RecipeOfTheDayView } from '@ona/shared'
import { appApiFor, AppApiError, type AppApi } from './appApi.js'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'

/**
 * PRO-1099 · «¿Cuál es la receta del día?» — the same `GET /recipe-of-the-day`
 * the public page `/receta-del-dia` reads (D-051: in the web chat and on
 * WhatsApp alike). It is the same for everyone, not picked for the household,
 * so its allergens go with it and the summary says so.
 */

const api = (ctx: SkillContext): AppApi =>
  ctx.api ?? appApiFor(ctx.userId, { channel: ctx.channel === 'whatsapp' ? 'whatsapp' : 'web' })

const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

/** «miércoles 4 de noviembre» */
export function dayEs(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`
}

/** Pure: what Mimo is told about the recipe of the day. */
export function recipeOfTheDaySummary(view: RecipeOfTheDayView, allergens: readonly string[] | null): string {
  const when = view.isRequestedDate
    ? `La receta del día (${dayEs(view.date)}) es «${view.title}».`
    : `El ${dayEs(view.requestedDate)} no hay receta del día; la última fue «${view.title}», el ${dayEs(view.date)}.`
  const lines = [when, view.text]
  if (view.credit) lines.push(view.credit + '.')
  lines.push(`Enlace: ${view.url}`)
  if (allergens && allergens.length) lines.push(`Alérgenos: ${allergens.join(', ')}.`)
  else if (allergens) lines.push('Sin alérgenos marcados en la ficha.')
  lines.push('Es la misma para todos, no está elegida para este hogar: si en casa hay alergias o una dieta, compruébalo antes de recomendarla.')
  return lines.join(' ')
}

export const getRecipeOfTheDay: SkillDefinition = {
  name: 'get_recipe_of_the_day',
  description:
    'La receta del dia de Mimoia (la misma que la pagina /receta-del-dia): titulo, texto corto, ingredientes clave, minutos, cocina y enlace. Usala cuando pregunten "cual es la receta del dia", "que receta toca hoy" o por la de un dia concreto. Sin date, la de hoy; si ese dia no hay, devuelve la ultima con su fecha. No esta elegida para el hogar: avisa si choca con sus alergias o su dieta.',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Dia AAAA-MM-DD (opcional; por defecto hoy)' },
    },
    required: [],
  },
  async handler(p: { date?: string }, ctx: SkillContext): Promise<SkillResult> {
    const date = typeof p?.date === 'string' ? p.date.trim() : ''
    if (date && !isIsoDay(date)) {
      return { data: { error: 'INVALID_DATE' }, summary: 'La fecha tiene que ser un dia AAAA-MM-DD.', uiHint: 'text' }
    }
    let view: RecipeOfTheDayView
    try {
      view = await api(ctx)<RecipeOfTheDayView>('GET', date ? `/recipe-of-the-day/${date}` : '/recipe-of-the-day')
    } catch (err) {
      if (err instanceof AppApiError && err.status === 404) {
        return { data: { recipeOfTheDay: null }, summary: 'Todavía no hay receta del día.', uiHint: 'text' }
      }
      throw err
    }
    // Best effort: the ficha's allergens, so Mimo can warn the household.
    let allergens: string[] | null = null
    try {
      const recipe = await api(ctx)<{ allergens?: string[] }>('GET', `/recipes/${view.recipeId}`)
      allergens = Array.isArray(recipe?.allergens) ? recipe.allergens : null
    } catch {
      allergens = null
    }
    return { data: { recipeOfTheDay: view, allergens }, summary: recipeOfTheDaySummary(view, allergens), uiHint: 'text' }
  },
}

export const recipeOfTheDaySkills: SkillDefinition[] = [getRecipeOfTheDay]
