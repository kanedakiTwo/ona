import { ALERT_TIME_KINDS, alertTimeError, isAlertTimeKind, normalizeAlertTime, type AlertsOverview, type AlertTimeKind } from '@ona/shared'
import { appApiFor, AppApiError, type AppApi } from './appApi.js'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'

/**
 * PRO-1301 · «mándame el menú a las 8», «pregúntame por la cena a las 22:00»
 * (web chat and WhatsApp): the same route as Perfil → Avisos
 * (`PATCH /notifications/prefs { times }`), saved for the whole household.
 * Before it, Mimo couldn't, and once said «apuntado» without saving anything.
 */
const api = (ctx: SkillContext): AppApi =>
  ctx.api ?? appApiFor(ctx.userId, { channel: ctx.channel === 'whatsapp' ? 'whatsapp' : 'web' })
const text = (summary: string, data: unknown = null): SkillResult => ({ data, summary, uiHint: 'text' })

const WHAT: Record<AlertTimeKind, string> = {
  daily_brief: 'el menú del día',
  dinner_checkin: 'la pregunta de la cena («¿hiciste la cena?»)',
}

export const setAlertTime: SkillDefinition = {
  name: 'set_alert_time',
  description:
    'Cambia la hora a la que llega un aviso de Mimo, para todo el hogar, igual que Perfil → Ajustes → Avisos. kind: daily_brief (el menu del dia, entre 08:00 y 13:00) o dinner_checkin (la pregunta "¿hiciste la cena?", entre 19:00 y 22:00). time: "HH:MM" en hora de España ("a las 8" = "08:00", "a las 10 de la noche" = "22:00"); reset=true vuelve a la hora de siempre. Usala cuando pida cambiar la hora de uno de esos avisos; la hora de los demas avisos no se puede cambiar (diselo asi). No digas que lo has cambiado sin usarla.',
  parameters: {
    type: 'object',
    properties: {
      kind: { type: 'string', enum: [...ALERT_TIME_KINDS] },
      time: { type: 'string', description: 'HH:MM, p. ej. "08:30"' },
      reset: { type: 'boolean', description: 'true para volver a la hora de siempre' },
    },
    required: ['kind'],
  },
  async handler(p: { kind?: string; time?: string; reset?: boolean }, ctx: SkillContext): Promise<SkillResult> {
    if (!isAlertTimeKind(p.kind)) return text('No he cambiado nada: solo se puede elegir la hora del menú del día y de la pregunta de la cena.')
    const kind = p.kind
    const time = p.reset ? null : normalizeAlertTime(p.time)
    if (!p.reset) {
      const error = alertTimeError(kind, time)
      if (error) return text(`No he cambiado nada: ${error}`)
    }
    try {
      const o = await api(ctx)<AlertsOverview>('PATCH', '/notifications/prefs', { times: { [kind]: time } })
      const now = o.times?.[kind]?.time ?? time
      const row = o.kinds.find((k) => k.kind === kind)
      const caveat = row && !row.on
        ? ' Ojo: ese aviso está apagado; si lo quiere, enciéndelo con set_alerts.'
        : row && row.channel === 'off' && row.note ? ` Ojo: ahora no le llegaría: ${row.note}` : ''
      return text(
        `Hecho: ${WHAT[kind]} llegará a las ${now}${p.reset ? ' (la hora de siempre)' : ''}, para todo el hogar.${caveat} Se ve y se cambia en Perfil → Ajustes → Avisos.`,
        { kind, time: now },
      )
    } catch (err) {
      if (err instanceof AppApiError && err.status < 500) return text(`No he cambiado nada: ${err.message}`)
      throw err
    }
  },
}

export const alertTimeSkills: SkillDefinition[] = [setAlertTime]
