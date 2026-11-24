import { appApiFor, AppApiError, type AppApi } from './appApi.js'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'

/**
 * PRO-1054 · «lo de la receta de los viernes por email, ¿cómo me apunto?»
 * (web chat and WhatsApp): Mimo knows the Friday email and turns it on or off
 * through the same route as the switch in Perfil → Ajustes → Avisos
 * (`GET`/`PUT /newsletter/me`, specs/newsletter.md). Before it, Mimo said
 * «no me consta que Mimoia mande recetas por email», even to people who had
 * ticked the box.
 */
const api = (ctx: SkillContext): AppApi =>
  ctx.api ?? appApiFor(ctx.userId, { channel: ctx.channel === 'whatsapp' ? 'whatsapp' : 'web' })
const text = (summary: string, data: unknown = null): SkillResult => ({ data, summary, uiHint: 'text' })

/** What it is and where it lives, in the words of the screen. */
export const NEWSLETTER_WHAT =
  'El correo de los viernes: cada viernes por la mañana, un email de Mimoia con una receta de la semana, una carta de Miguel (el fundador) y las novedades de Mimoia. Es aparte de los avisos de Mimo.'
export const NEWSLETTER_WHERE =
  'Se activa o se quita en Perfil → Ajustes → Avisos, con la casilla «Quiero recibir cada viernes por email una receta de la semana y novedades de Mimoia» (también en el registro), y cada correo trae su enlace para darse de baja.'

export const getNewsletter: SkillDefinition = {
  name: 'get_newsletter',
  description:
    'Dice si al usuario le llega el correo de los viernes de Mimoia (cada viernes, un email con una receta de la semana y novedades; la newsletter) y donde se activa. Usala cuando pregunte por la receta o el correo de los viernes, la newsletter, o si esta apuntado. Ese correo existe: nunca digas que Mimoia no manda recetas por email.',
  parameters: { type: 'object', properties: {}, required: [] },
  async handler(_p, ctx: SkillContext): Promise<SkillResult> {
    const r = await api(ctx)<{ optIn: boolean }>('GET', '/newsletter/me')
    const state = r.optIn
      ? 'Está apuntado: le llega cada viernes.'
      : 'No está apuntado. Si quiere, le apuntas tú con set_newsletter.'
    return text(`${state} ${NEWSLETTER_WHAT} ${NEWSLETTER_WHERE}`, { optIn: r.optIn })
  },
}

export const setNewsletter: SkillDefinition = {
  name: 'set_newsletter',
  description:
    'Apunta o quita al usuario del correo de los viernes de Mimoia (una receta de la semana y novedades, por email), igual que la casilla de Perfil → Ajustes → Avisos. on=true solo si el lo pide o dice que si («apuntame», «quiero la receta de los viernes»); on=false con «no me mandes mas el correo de los viernes», «quitame de la newsletter». No digas que esta hecho sin usarla.',
  parameters: {
    type: 'object',
    properties: { on: { type: 'boolean', description: 'true para apuntarle, false para quitarle' } },
    required: ['on'],
  },
  async handler(p: { on?: unknown }, ctx: SkillContext): Promise<SkillResult> {
    if (typeof p.on !== 'boolean') return text('No he cambiado nada: falta decir si apuntarle (on=true) o quitarle (on=false).')
    try {
      const r = await api(ctx)<{ optIn: boolean }>('PUT', '/newsletter/me', { optIn: p.on })
      return text(
        r.optIn
          ? 'Hecho: apuntado al correo de los viernes. El próximo viernes por la mañana le llega una receta de la semana y las novedades de Mimoia. Se quita en Perfil → Ajustes → Avisos o con el enlace de baja de cada correo.'
          : 'Hecho: ya no le llegará el correo de los viernes. Se vuelve a activar en Perfil → Ajustes → Avisos.',
        { optIn: r.optIn },
      )
    } catch (err) {
      if (err instanceof AppApiError && err.status < 500) return text(`No he cambiado nada: ${err.message}`)
      throw err
    }
  },
}

export const newsletterSkills: SkillDefinition[] = [getNewsletter, setNewsletter]
