/**
 * PRO-1298: one request, one menu. Mimo makes a whole week only when it was
 * asked for, and never twice for the same request:
 *
 * - a request repeated while the menu is being made (two chats at once, a
 *   double send) doesn't start a second generation (`claimMenuGeneration`);
 * - a message sent before the week's menu was made (it waited in the queue
 *   behind the slow turn that made it: «¿hola? el menú») asked for the menu
 *   it already got (`askedBeforeMenu`);
 * - a tapped button makes a whole week only if the button or the message it
 *   answered asks for one (`buttonAsksForWeek`): «No, cenamos otra cosa»
 *   under «¿Hiciste la cena?» never does.
 *
 * Railway runs one API instance (see whatsapp/inbound.ts), so an in-process
 * set is enough for the in-flight part.
 */

const inFlight = new Set<string>()

/**
 * Marks the week's generation as running; null if it already is (then the
 * caller doesn't generate). `release` must run when it ends, also on error.
 */
export function claimMenuGeneration(userId: string, weekStart: string): { release: () => void } | null {
  const key = `${userId}:${weekStart}`
  if (inFlight.has(key)) return null
  inFlight.add(key)
  let done = false
  return {
    release: () => {
      if (done) return
      done = true
      inFlight.delete(key)
    },
  }
}

/** Pure: the week's menu was made after the person sent this message. */
export function askedBeforeMenu(menuCreatedAt: Date | null | undefined, requestedAt: Date | null | undefined): boolean {
  if (!(menuCreatedAt instanceof Date) || !(requestedAt instanceof Date)) return false
  const made = menuCreatedAt.getTime()
  const asked = requestedAt.getTime()
  return Number.isFinite(made) && Number.isFinite(asked) && made >= asked
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** A whole week's menu, asked or offered: «menú de la semana», «prepárame el menú», «rehaz la semana», «la semana que viene». */
const WEEK_MENU_RE =
  /\b(?:(?:prepar|gener|hac|haz|rehac|rehaz|mont|crea|nuev)\w*\s+(?:\w+\s+){0,2}(?:menu|semana)|menu\s+(?:\w+\s+){0,2}(?:semana|semanal|nuevo)|semana\s+(?:que\s+viene|entera|completa|proxima|siguiente)|(?:proxima|siguiente)\s+semana|menu\s+semanal)\b/

/**
 * Pure: a tapped button asks for a whole week's menu — its title, or the
 * question it answered (the last line of that message: «Tu menú de la
 * semana…» above a «¿Te cambio la cena?» doesn't count).
 */
export function buttonAsksForWeek(button: { title: string; asked?: string | null }): boolean {
  // History marks (⟦botones: …⟧, ⟦hecho: …⟧) and «Ver menú: https://…» links are not the question.
  const question = (button.asked ?? '')
    .split('\n')
    .map((l) => l.replace(/⟦[^⟧]*⟧/g, '').trim())
    .filter((l) => l && !/https?:\/\//.test(l))
    .pop() ?? ''
  return [button.title, question].some((text) => WEEK_MENU_RE.test(fold(text)))
}
