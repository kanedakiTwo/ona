import type { OutboundMessage } from './render.js'
import type { Lang } from './language.js'

/**
 * 19-nov (a household wrote BAJA after «quedan 85 cosas» and a 138-minute
 * aviso, and we never knew why): the first BAJA of a number asks why, in the
 * same message, with three buttons answered without the model. The answer is
 * an opinion (`user_feedback`, tag `baja_avisos`, the option in `answer`).
 * Pure.
 */
export const OPT_OUT_REASON_TAG = 'baja_avisos'

export const OPT_OUT_REASONS = ['demasiados', 'no_sirven', 'otra'] as const
export type OptOutReason = (typeof OPT_OUT_REASONS)[number]

const TITLES: Record<Lang, Record<OptOutReason, string>> = {
  es: { demasiados: 'Demasiados mensajes', no_sirven: 'No me sirven', otra: 'Otra cosa' },
  en: { demasiados: 'Too many messages', no_sirven: 'Not useful to me', otra: 'Something else' },
}

const QUESTION: Record<Lang, string> = {
  es: '¿Me dices por qué? Me ayuda a mejorar.',
  en: 'Could you tell me why? It helps me improve.',
}

/** The BAJA confirmation with the question and its buttons underneath. */
export function optOutWithReason(stopped: string, lang: Lang): OutboundMessage {
  return {
    type: 'buttons',
    text: `${stopped}\n\n${QUESTION[lang]}`,
    buttons: OPT_OUT_REASONS.map((r) => ({ id: `baja:${r}`, title: TITLES[lang][r] })),
  }
}

export function optOutReasonOf(replyId: string | null | undefined): OptOutReason | null {
  const m = /^baja:([a-z_]+)$/.exec(replyId ?? '')
  return m && (OPT_OUT_REASONS as readonly string[]).includes(m[1]) ? (m[1] as OptOutReason) : null
}

export function optOutReasonThanks(lang: Lang): string {
  return lang === 'en' ? 'Thanks, noted.' : 'Gracias, lo apunto.'
}
