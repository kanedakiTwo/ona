/**
 * Control words a person can send at any time, handled deterministically
 * before every other gate (link, suspension, allowlist, budget, staleness)
 * and never sent to the model:
 *   - stop  ("BAJA", "STOP", "PARAR"…)   → no more proactive messages;
 *   - start ("ALTA", "Sí, avísame"…)      → proactive messages back on;
 *   - human ("HUMANO", "hablar con una persona"…) → how to reach a person.
 * Whole-message matches only, so "para la cena pon lentejas" is a request,
 * not an opt-out.
 */
export type ControlCommand = 'stop' | 'start' | 'human'

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .toLowerCase()
    .replace(/[¡!¿?.,;:'"()*_~]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const STOP = new Set([
  'stop', 'baja', 'darme de baja', 'dame de baja', 'parar', 'para', 'cancelar', 'unsubscribe',
  'no quiero mas avisos', 'no quiero avisos', 'no quiero mas mensajes', 'no me escribas mas',
  'no me mandes mas mensajes', 'no me mandes mas avisos', 'desactivar avisos', 'quitar avisos',
])
const START = new Set([
  'alta', 'start', 'darme de alta', 'si avisame', 'activar avisos', 'reanudar avisos', 'quiero avisos',
])
const HUMAN = new Set([
  'humano', 'persona', 'una persona', 'hablar con una persona', 'hablar con un humano', 'soporte', 'contacto',
  'quiero hablar con una persona', 'ayuda humana',
])

export function controlCommand(text: string | null | undefined): ControlCommand | null {
  if (!text) return null
  const t = normalize(text)
  if (!t || t.length > 40) return null
  if (STOP.has(t)) return 'stop'
  if (START.has(t)) return 'start'
  if (HUMAN.has(t)) return 'human'
  return null
}

/** Button titles of the opt-in question sent right after linking (≤ 20 chars). */
export const OPT_IN_YES = 'Sí, avísame'
export const OPT_IN_NO = 'No, gracias'
