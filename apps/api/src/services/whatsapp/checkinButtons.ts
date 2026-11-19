/**
 * 18-nov: the «¿hiciste la cena?» buttons (`CHECKIN_BUTTONS` /
 * `CHECKIN_RATING_BUTTONS` in proactive.ts) are recorded without the model:
 * the cooked dinner on the day of the check-in and, with «¡a repetir!» /
 * «estuvo bien», its rating (5 / 3), then a short fixed confirmation. They
 * work with the monthly cap used up (two ratings were lost to it) and cost no
 * turn. Pure.
 */
export interface CheckinAnswer {
  cooked: boolean
  rating: 5 | 3 | null
}

/** The button id → what it answers; any other id (or none) → null. */
export function checkinAnswerOf(replyId: string | null | undefined): CheckinAnswer | null {
  switch (replyId) {
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

/** The fixed confirmation. «La cena» (feminine) fits any dish's gender. */
export function checkinConfirmation(answer: CheckinAnswer, name: string): string {
  if (!answer.cooked) return 'Vale, no la apunto.'
  if (answer.rating === 5) return `Apuntada la cena: *${name}*, y que es para repetir.`
  if (answer.rating === 3) return `Apuntada la cena: *${name}*, y que estuvo bien.`
  return `Apuntada la cena: *${name}*.`
}
