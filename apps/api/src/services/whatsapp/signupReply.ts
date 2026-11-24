/**
 * The reply that ends the WhatsApp sign-up (Miguel, 19-nov): ONE message —
 * the week's picture, one line and at most one question. Before, 4–6
 * messages arrived in the same second with two different questions (Mimo's
 * and the caption's «¿Cambio algo?»), the allergies link and the avisos
 * question; those two now come ~10 min later (signupFollowUps.ts). And the
 * first thing the household read was «no he conseguido acercarme mucho a lo
 * que os gusta» / «se parece poco» / «bastante genérico»: those sentences go.
 * Pure, tested in signupReply.test.ts.
 */
import { MADE_WITH_PREFIX, MENU_INVITE_PREFIX, MENU_INVITE_PREFIX_EN, SNOWBALL_LINE, SNOWBALL_LINE_EN } from '../menuText.js'

/** What the sign-up's closing reply never says (the prompt forbids it; this is the net). */
export const SIGNUP_FORBIDDEN_PHRASES: readonly RegExp[] = [
  /no (?:he podido |he conseguido |me he podido |consigo )?acercar/i,
  /se parece poco/i,
  /gen[eé]ric/i,
  /acertar[eé] menos/i,
  // PRO-1300: the same, in English.
  /less right/i,
  /(?:not|n't) (?:very |that )?close to/i,
]

/**
 * A sentence that asks something. The «?» of a link doesn't count (PRO-1041:
 * the link to save an allergy told in the sign-up is
 * `…/profile/casa/alergias?next=…`, and it went out with the extra questions).
 */
const asks = (sentence: string) => sentence.replace(/https?:\/\/\S+/g, '').includes('?')

/**
 * Pure: Mimo's words for the sign-up's picture — without a sentence that
 * says the menu is far from their tastes, and with one question at most (the
 * last one).
 */
export function signupWords(text: string): string {
  const sentences = text
    .split('\n')
    .flatMap((line) => line.split(/(?<=[.!?…])\s+/))
    .map((s) => s.trim())
    .filter((s) => s && !SIGNUP_FORBIDDEN_PHRASES.some((re) => re.test(s)))
  const lastQuestion = sentences.map(asks).lastIndexOf(true)
  return sentences.filter((s, i) => !asks(s) || i === lastQuestion).join(' ').trim()
}

/** The caption's opener after generating («Listo: tu menú hasta el domingo 🍽️»; PRO-1300: «Ready: …» in English). */
const OPENER_PREFIXES = ['Listo:', 'Ready:']
const SNOWBALL_LINES = [SNOWBALL_LINE, SNOWBALL_LINE_EN]
const INVITE_PREFIXES = [MENU_INVITE_PREFIX, MENU_INVITE_PREFIX_EN]
const startsWithAny = (line: string, prefixes: readonly string[]) => prefixes.some((p) => line.startsWith(p))

/**
 * Pure: the week caption for the sign-up — no snowball line («acertaré
 * menos…»), no «¿Cambio algo?» invite, no «Hecho con Mimo» foot; and no
 * «Listo: …» opener when Mimo has words. The menu link stays.
 */
export function signupCaption(caption: string, hasWords: boolean): string {
  return caption
    .split('\n')
    .filter((l) => !startsWithAny(l, SNOWBALL_LINES) && !startsWithAny(l, INVITE_PREFIXES) && !l.startsWith(MADE_WITH_PREFIX))
    .filter((l) => !(hasWords && startsWithAny(l, OPENER_PREFIXES)))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Pure: the caption without its «¿Cambio algo?» line, when Mimo's words already ask something. */
export function captionWithoutInvite(caption: string): string {
  return caption
    .split('\n')
    .filter((l) => !startsWithAny(l, INVITE_PREFIXES))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
