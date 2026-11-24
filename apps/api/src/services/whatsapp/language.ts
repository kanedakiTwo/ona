import type { OutboundMessage } from './render.js'

/**
 * 19-nov: the language of the avisos. A household that writes to Mimo in
 * English got them in Spanish. There is no language per person in this
 * branch yet (D-111 is still in feat/ingles-base), so it comes from what the
 * person writes: their last messages to Mimo. Pure.
 *
 *   - Only messages of 3+ words count (a button title like «Sí, hecho» says
 *     nothing about the person).
 *   - English only with a clear lead (and some evidence); anything unclear is
 *     Spanish, as before.
 *   - PRO-1300: a lone greeting («Hi», «Hola») counts too, and the language
 *     the household wrote in at the sign-up is saved (`whatsapp_links.language`):
 *     it applies whenever the last messages don't say it clearly.
 */
export type Lang = 'es' | 'en'

const EN_WORDS = new Set(
  'the and you your is are what for with my we i im i\'m it this that have has to of please thanks thank yes no not can could would how when where dinner lunch today tonight tomorrow week menu list shopping recipe make made cook cooked do does did like want need some any there they our us me just'.split(' '),
)
const ES_WORDS = new Set(
  'el la los las de del que y es son por para con una un qué que hoy cena comida sí si gracias mi me lo le se no pero como cómo cuando cuándo esta este semana menú lista compra receta hacer hice hecho quiero puedes tengo tenemos hay muy también ya'.split(' '),
)

/**
 * PRO-1300: a first message is often just a greeting («Hi», «Hola»): too
 * short for the words count, but it says the language. Whole message only,
 * with or without «Mimo».
 */
const EN_GREETING = /^(?:hi|hello|hey|hiya|hi there|hello there|good (?:morning|afternoon|evening))(?: mimo(?:ia)?)?$/
const ES_GREETING = /^(?:hola|buenas|buenos dias|buenas tardes|buenas noches)(?: mimo(?:ia)?)?$/

/**
 * PRO-1300: the language when the texts say it clearly, else null (the
 * caller then falls back on the language saved at the sign-up, or Spanish).
 */
export function clearLanguage(texts: readonly string[]): Lang | null {
  let en = 0
  let es = 0
  for (const raw of texts) {
    const t = raw.toLowerCase()
    const words = t.split(/[^a-záéíóúüñ']+/).filter(Boolean)
    const bare = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z' ]+/g, ' ').replace(/\s+/g, ' ').trim()
    if (EN_GREETING.test(bare)) en += 3
    if (ES_GREETING.test(bare)) es += 3
    if (words.length < 3) continue
    if (/[ñ¿¡]|[áéíóú]/.test(t)) es += 2
    for (const w of words) {
      if (EN_WORDS.has(w)) en++
      if (ES_WORDS.has(w)) es++
    }
  }
  if (en >= 3 && en > es * 1.5) return 'en'
  if (es >= 3 && es > en * 1.5) return 'es'
  return null
}

export function detectLanguage(texts: readonly string[]): Lang {
  return clearLanguage(texts) === 'en' ? 'en' : 'es'
}

/**
 * The English titles of the avisos' buttons, by id (WhatsApp: ≤ 20
 * characters). The ids are what the code reads; the titles only show.
 */
export const EN_BUTTON_TITLES: Readonly<Record<string, string>> = {
  'cooking:ok': "I'm on it",
  'cooking:swap': 'Something quicker',
  'checkin:up': '👍',
  'checkin:down': '👎',
  'checkin:no': "Didn't make it",
  'nudge:yes': 'Yes, plan it',
  'nudge:no': 'Not now',
  'freezer:yes': 'Yes, add it',
  'freezer:no': 'Not now',
}

/** Buttons with an English title get it; the rest stay as they are. */
export function localizeButtons(messages: OutboundMessage[], lang: Lang): OutboundMessage[] {
  if (lang === 'es') return messages
  return messages.map((m) =>
    m.type === 'buttons' ? { ...m, buttons: m.buttons.map((b) => ({ ...b, title: EN_BUTTON_TITLES[b.id] ?? b.title })) } : m,
  )
}
