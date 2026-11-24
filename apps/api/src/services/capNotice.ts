/**
 * PRO-1302: what Mimo says when the month's cap is used up.
 *
 * Until 23-nov the cap cut dry: «Has alcanzado tu límite mensual…» on every
 * message, also on a button or «¿qué hay hoy?». Now what the code answers
 * keeps working (codeReply.ts, the avisos' buttons, the courtesies) and the
 * notice says so, and where the menu and the list are — ONCE a month (the
 * `cap_hits` row is the mark, capHits.ts). It goes at the end of the turn
 * that reaches the cap (that turn is never cut), or, if the cap came some
 * other way, on the first message that would need the model.
 */
const euros = (capEur: number) => `${Math.round(capEur)} €`

/** Pure: the WhatsApp notice, with the links to the menu and the list. */
export function capNoticeWhatsApp(capEur: number, webUrl: string, lang: 'es' | 'en' = 'es'): string {
  const base = webUrl.replace(/\/$/, '')
  if (lang === 'en') {
    return [
      `I've used up this month's allowance for new answers (${euros(capEur)}); it renews on the 1st.`,
      'The buttons of my reminders still work. Your menu and your shopping list are always in the app:',
      `Menu: ${base}/menu`,
      `Shopping list: ${base}/shopping`,
    ].join('\n')
  }
  return [
    `Este mes ya he gastado lo que tengo para pensar respuestas nuevas (${euros(capEur)}); vuelvo del todo el día 1.`,
    'Mientras, sigo contestando aquí los botones de mis avisos, «¿qué hay hoy?», «mándame el menú» y «la lista de la compra».',
    'Y el menú y la lista los tienes siempre en la app:',
    `Menú: ${base}/menu`,
    `Lista: ${base}/shopping`,
  ].join('\n')
}

/** Pure: the app's notice (Mimo's panel), the first time this month. */
export function capNoticeApp(capEur: number): string {
  return (
    `Este mes ya he gastado lo que tengo para pensar respuestas nuevas (${euros(capEur)}); vuelvo del todo el día 1. ` +
    'Mientras, sigo contestando «¿qué hay hoy?», «mándame el menú», «la lista de la compra» y, en el modo cocina, «siguiente», «anterior» y «repite». ' +
    'El menú y la lista los tienes siempre en Menú y en Compra.'
  )
}

/** Pure: the app's line after that (the panel needs an answer; it says it short). */
export function capNoticeAppShort(capEur: number): string {
  return `Sigo sin respuestas nuevas este mes (${euros(capEur)}); vuelvo el día 1. El menú y la lista, en Menú y en Compra.`
}

/**
 * Pure: did this turn (`added`) take the month's spend to the cap or past it?
 * Null `spentBefore` (not known) → no.
 */
export function reachesCap(spentBefore: number | null, added: number, cap: number): boolean {
  return spentBefore !== null && cap > 0 && spentBefore + added >= cap
}

/** Pure: Mimo's words end asking something (the next message answers it: it belongs to this turn). */
export function asksSomething(text: string | null | undefined): boolean {
  const lines = (text ?? '').split('\n').map((l) => l.trim()).filter(Boolean)
  return (lines.at(-1) ?? '').includes('?')
}
