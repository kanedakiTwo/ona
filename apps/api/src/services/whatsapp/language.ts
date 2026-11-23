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
 */
export type Lang = 'es' | 'en'

const EN_WORDS = new Set(
  'the and you your is are what for with my we i im i\'m it this that have has to of please thanks thank yes no not can could would how when where dinner lunch today tonight tomorrow week menu list shopping recipe make made cook cooked do does did like want need some any there they our us me just'.split(' '),
)
const ES_WORDS = new Set(
  'el la los las de del que y es son por para con una un qué que hoy cena comida sí si gracias mi me lo le se no pero como cómo cuando cuándo esta este semana menú lista compra receta hacer hice hecho quiero puedes tengo tenemos hay muy también ya'.split(' '),
)

export function detectLanguage(texts: readonly string[]): Lang {
  let en = 0
  let es = 0
  for (const raw of texts) {
    const t = raw.toLowerCase()
    const words = t.split(/[^a-záéíóúüñ']+/).filter(Boolean)
    if (words.length < 3) continue
    if (/[ñ¿¡]|[áéíóú]/.test(t)) es += 2
    for (const w of words) {
      if (EN_WORDS.has(w)) en++
      if (ES_WORDS.has(w)) es++
    }
  }
  return en >= 3 && en > es * 1.5 ? 'en' : 'es'
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
