/**
 * How the household cooks, from chat (PRO-217, D-051; specs/advisor.md,
 * specs/household-profile.md). Calls the same route as Perfil, as the user
 * (appApi.ts), so the web chat, voice and WhatsApp all land on the same
 * `cooking_style` fact of the household's ficha.
 */
import { COOKING_STYLES, COOKING_STYLE_LABELS, COOKING_STYLE_PATH, isCookingStyle } from '@ona/shared'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'
import { appApiFor, AppApiError, type AppApi } from './appApi.js'

const api = (ctx: SkillContext): AppApi =>
  ctx.api ?? appApiFor(ctx.userId, { channel: ctx.channel === 'whatsapp' ? 'whatsapp' : 'web' })
const text = (summary: string, data: unknown = null): SkillResult => ({ data, summary, uiHint: 'text' })

export const setCookingStyleSkill: SkillDefinition = {
  name: 'set_cooking_style',
  description:
    'Guarda en la ficha del hogar COMO cocinan (no cuanto): daily = «Cocino cada día»; cook_and_reuse = «Cocino unos días y aprovecho para otros» (cocinan de más y tiran de sobras); batch = «Batch cooking: cocino una o dos veces y dejo hecha la semana»; improvise = «Improviso: decido cada día». Llamalo cuando el hogar te cuente como cocina o que lo ha cambiado ("ahora hacemos batch los domingos", "cocino cada noche", "hago doble y como sobras al dia siguiente", "voy improvisando"). Es lo mismo que elegir en Perfil.',
  parameters: {
    type: 'object',
    properties: {
      style: { type: 'string', enum: [...COOKING_STYLES], description: 'Como cocinan en casa.' },
    },
    required: ['style'],
  },
  async handler(p: { style?: string }, ctx: SkillContext): Promise<SkillResult> {
    if (!isCookingStyle(p?.style)) return text(`No he guardado nada: style tiene que ser uno de ${COOKING_STYLES.join(', ')}.`)
    try {
      const out = await api(ctx)<{ style: string; changed: boolean }>('PUT', COOKING_STYLE_PATH, { style: p.style })
      const label = COOKING_STYLE_LABELS[p.style]
      return {
        data: out,
        summary: out?.changed ? `Apuntado en la ficha del hogar: «${label}».` : `Ya lo tenia apuntado así: «${label}». No he cambiado nada.`,
        uiHint: 'confirmation',
      }
    } catch (err) {
      if (err instanceof AppApiError && err.status === 403) return text('No lo he cambiado: solo los adultos del hogar pueden cambiar como cocinais.')
      throw err
    }
  },
}

export const householdHabitsSkills: SkillDefinition[] = [setCookingStyleSkill]
