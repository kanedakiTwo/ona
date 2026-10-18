/**
 * Menú del cole from chat (PRO-224, D-051): Mimo reads what was saved and
 * fixes or adds days, in the web chat and on WhatsApp. The photo or PDF
 * itself is read on WhatsApp by `inbound.ts` (with «menú del cole» in the
 * caption or the message before) or uploaded in Perfil → Mi casa → Menú del cole.
 */
import { FOOD_GROUPS, dishFoodGroup, isFoodGroup, type SchoolLunch } from '@ona/shared'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'
import { getPrimaryHouseholdId } from '../scopeResolver.js'
import { addDays, madridParts } from '../madridTime.js'
import { loadSchoolLunches, saveSchoolLunches, schoolLunchLines } from '../schoolMenu.js'

const ISO = /^\d{4}-\d{2}-\d{2}$/

const HOW_TO_SEND =
  'Para pasarme el menú del cole: por WhatsApp, mándame la foto o el PDF con «menú del cole» en el mensaje; en la web, en Perfil → Mi casa → Menú del cole.'

const getSchoolMenu: SkillDefinition = {
  name: 'get_school_menu',
  description:
    'Lee el menú del comedor escolar que tiene guardado el hogar (plato principal de cada día de cole y su grupo). Úsalo cuando pregunten qué comen los niños en el cole, antes de corregir un día, o cuando digan «te paso el menú del cole» (para explicar cómo mandarlo). Las cenas de los días de cole no repiten el grupo de lo que comieron allí («para no repetir»; nunca hables de equilibrar ni de salud).',
  parameters: {
    type: 'object',
    properties: {
      from: { type: 'string', description: 'Desde (AAAA-MM-DD). Por defecto, hoy.' },
      to: { type: 'string', description: 'Hasta (AAAA-MM-DD). Por defecto, 31 días después.' },
    },
    required: [],
  },
  async handler(params: { from?: string; to?: string }, ctx: SkillContext): Promise<SkillResult> {
    const householdId = await getPrimaryHouseholdId(ctx.userId, ctx.db)
    const today = madridParts(new Date()).isoDate
    const from = params?.from && ISO.test(params.from) ? params.from : today
    const to = params?.to && ISO.test(params.to) ? params.to : addDays(from, 31)
    const days = householdId ? await loadSchoolLunches(householdId, from, to, ctx.db) : []
    if (days.length === 0) {
      return { data: { days }, summary: `No hay menú del cole guardado entre ${from} y ${to}. ${HOW_TO_SEND}`, uiHint: 'text' }
    }
    return { data: { days }, summary: `Menú del cole guardado:\n${schoolLunchLines(days).join('\n')}`, uiHint: 'text' }
  },
}

const setSchoolMenuDays: SkillDefinition = {
  name: 'set_school_menu_days',
  description:
    'Guarda o corrige días del menú del comedor escolar del hogar: el plato principal de la comida de ese día y su grupo. Úsalo cuando el usuario corrija lo leído («el martes 4 era merluza») o dicte días. Con clear quita días (vacaciones, festivos, un día mal leído).',
  parameters: {
    type: 'object',
    properties: {
      days: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            date: { type: 'string', description: 'AAAA-MM-DD' },
            dish: { type: 'string', description: 'Plato principal, p. ej. «Lentejas con verduras».' },
            group: { type: 'string', enum: [...FOOD_GROUPS], description: 'Grupo del plato. Si no lo sabes, omítelo.' },
          },
          required: ['date', 'dish'],
        },
      },
      clear: { type: 'array', items: { type: 'string' }, description: 'Fechas (AAAA-MM-DD) a quitar.' },
    },
    required: [],
  },
  async handler(params: { days?: Array<{ date?: string; dish?: string; group?: string }>; clear?: string[] }, ctx: SkillContext): Promise<SkillResult> {
    const householdId = await getPrimaryHouseholdId(ctx.userId, ctx.db)
    if (!householdId) return { data: null, summary: 'No he podido guardarlo: no encuentro tu hogar.', uiHint: 'text' }
    const days: SchoolLunch[] = []
    for (const d of params?.days ?? []) {
      const date = String(d?.date ?? '').slice(0, 10)
      const dish = String(d?.dish ?? '').trim().slice(0, 120)
      if (!ISO.test(date) || !dish) continue
      days.push({ date, dish, group: isFoodGroup(d?.group) ? d.group : dishFoodGroup(dish) })
    }
    const clear = (params?.clear ?? []).map((c) => String(c).slice(0, 10)).filter((c) => ISO.test(c))
    if (days.length === 0 && clear.length === 0) {
      return { data: null, summary: 'No he cambiado nada: dime la fecha y el plato de cada día.', uiHint: 'text' }
    }
    await saveSchoolLunches(householdId, ctx.userId, days, clear, ctx.db)
    const parts = [
      days.length ? `Guardado:\n${schoolLunchLines(days).join('\n')}` : '',
      clear.length ? `Quitados: ${clear.join(', ')}.` : '',
    ].filter(Boolean)
    return { data: { days, clear }, summary: `${parts.join('\n')}\nLas cenas de esos días no repetirán el grupo al generar o cambiar el menú.`, uiHint: 'text' }
  },
}

export const schoolMenuSkills: SkillDefinition[] = [getSchoolMenu, setSchoolMenuDays]
