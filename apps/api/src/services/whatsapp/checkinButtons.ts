import type { Lang } from './language.js'

/**
 * The buttons of the avisos recorded without the model (18-nov, 19-nov):
 *
 *   - «¿qué tal la cena?» (`CHECKIN_BUTTONS` in proactive.ts): 👍 = made it
 *     and liked it (rating 4), 👎 = made it, not again (rating 1: it no
 *     longer comes out on its own in the menu), «No la hice» = not made.
 *     The cooked dinner goes on the day of the check-in, then a short fixed
 *     confirmation. The ids of the earlier check-in (`checkin:yes`,
 *     `checkin:yes:5`, `checkin:yes:3`) still work for messages already out.
 *   - «hora de cocinar» «Lo hago» (`cooking:ok`): a fixed line, nothing else.
 *
 * They work with the monthly cap used up and cost no turn. Pure.
 */
export interface CheckinAnswer {
  cooked: boolean
  rating: 5 | 4 | 3 | 1 | null
}

/** The button id → what it answers; any other id (or none) → null. */
export function checkinAnswerOf(replyId: string | null | undefined): CheckinAnswer | null {
  switch (replyId) {
    case 'checkin:up':
      return { cooked: true, rating: 4 }
    case 'checkin:down':
      return { cooked: true, rating: 1 }
    case 'checkin:yes':
      return { cooked: true, rating: null }
    case 'checkin:yes:5':
      return { cooked: true, rating: 5 }
    case 'checkin:yes:3':
      return { cooked: true, rating: 3 }
    case 'checkin:no':
      return { cooked: false, rating: null }
    default:
      return null
  }
}

/** A tap counts for a check-in sent this long ago at most (a late tap goes to Mimo). */
export const CHECKIN_ANSWER_WINDOW_MS = 30 * 60 * 60 * 1000

/**
 * 20-nov (reviewer, `webhook.emoji_tono_piel_ignorado`): a 👍🏻 typed instead
 * of tapped was dropped as a lone emoji. A typed 👍 / 👎 — any skin tone,
 * repeated, with spaces or «!» — is that button's id; anything else is null.
 */
export function checkinReplyIdOfEmoji(text: string | null | undefined): 'checkin:up' | 'checkin:down' | null {
  const t = (text ?? '').replace(/[\u{1F3FB}-\u{1F3FF}︎️\s!.]/gu, '')
  if (/^(?:👍)+$/u.test(t)) return 'checkin:up'
  if (/^(?:👎)+$/u.test(t)) return 'checkin:down'
  return null
}

/**
 * Pure: Mimo's last message (`rows`, oldest first; notices and «me pongo con
 * ello» skipped) is the dinner check-in, sent in the last 30 h, with no turn
 * of the household processed after it. Then a typed 👍 / 👎 answers it.
 */
export function dinnerCheckinPending(
  rows: ReadonlyArray<{ direction: string; kind?: string; status: string; createdAt: Date }>,
  now: Date,
): boolean {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]
    if (r.direction === 'in') {
      if (r.status === 'processed') return false
      continue
    }
    if (r.status !== 'sent' || r.kind === 'ack' || r.kind === 'system') continue
    return r.kind === 'dinner_checkin' && now.getTime() - r.createdAt.getTime() <= CHECKIN_ANSWER_WINDOW_MS
  }
  return false
}

/**
 * Pure: the rating a tap saves over the one the household has. A 👍 (4)
 * never lowers a 5; the same rating isn't written again. Null = keep it.
 */
export function ratingToSave(existing: number | null | undefined, tapped: number | null): number | null {
  if (tapped == null) return null
  if (existing === tapped) return null
  if (tapped === 4 && existing != null && existing >= 4) return null
  return tapped
}

/** The fixed confirmation. «La cena» (feminine) fits any dish's gender. */
export function checkinConfirmation(answer: CheckinAnswer, name: string, lang: Lang = 'es'): string {
  if (lang === 'en') {
    if (!answer.cooked) return "Fine, I won't note it."
    if (answer.rating === 1) return `Noted: *${name}*. I won't put it in the menu on my own again.`
    if (answer.rating === 4 || answer.rating === 5) return `Noted: *${name}*, and that you liked it.`
    return `Noted: *${name}*.`
  }
  if (!answer.cooked) return 'Vale, no la apunto.'
  if (answer.rating === 1) return `Apuntada la cena: *${name}*. No la vuelvo a poner sola en el menú.`
  if (answer.rating === 4) return `Apuntada la cena: *${name}*, y que os gustó.`
  if (answer.rating === 5) return `Apuntada la cena: *${name}*, y que es para repetir.`
  if (answer.rating === 3) return `Apuntada la cena: *${name}*, y que estuvo bien.`
  return `Apuntada la cena: *${name}*.`
}
