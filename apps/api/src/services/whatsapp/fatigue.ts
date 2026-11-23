import type { OutboundMessage } from './render.js'
import type { Lang } from './language.js'

/**
 * 19-nov (28-oct → 18-nov: 136 avisos, 13 % answered; 9 households got 39
 * and never answered): an aviso nobody answers is noise. When a household
 * leaves 5 avisos of one kind in a row unanswered (no message, no button, in
 * the 12 h after each), that kind stops for it and Mimo asks ONCE «¿Te sigo
 * avisando de…?» with Sí / No, answered without the model:
 *
 *   - the pause is the kind's own switch (`setAlertPrefs`, the same as
 *     «Avisos» in the app), so the app shows it off;
 *   - «Sí» switches it back on; «No» leaves it off;
 *   - asked once per kind and number, ever (the outbound row of kind
 *     `pausa:<kind>`): a kind switched on again later is never paused again.
 *
 * Prep alerts (descongelar, remojo…) are left out: they work. Pure.
 */
export const FATIGUE_STREAK = 5
export const FATIGUE_REPLY_WINDOW_MS = 12 * 60 * 60 * 1000

export const FATIGUE_KINDS = ['cooking_reminder', 'dinner_checkin', 'shopping_reminder', 'weekly_nudge', 'daily_brief', 'freezer_review'] as const
export type FatigueKind = (typeof FATIGUE_KINDS)[number]

export const isFatigueKind = (k: string): k is FatigueKind => (FATIGUE_KINDS as readonly string[]).includes(k)

/** The outbound kind of the question about `kind` (its presence = already asked). */
export const fatigueAskKind = (kind: FatigueKind) => `pausa:${kind}`

export interface ActivityRow {
  direction: 'in' | 'out' | string
  kind?: string | null
  status: string
  createdAt: Date
}

/**
 * How many of the latest avisos of `kind` went unanswered in a row. An aviso
 * sent less than `FATIGUE_REPLY_WINDOW_MS` ago isn't judged yet; a failed one
 * doesn't count.
 */
export function ignoredStreak(rows: readonly ActivityRow[], kind: string, now: Date): number {
  const inbound = rows.filter((r) => r.direction === 'in').map((r) => r.createdAt.getTime())
  const sent = rows
    .filter((r) => r.direction === 'out' && r.kind === kind && r.status === 'sent' && now.getTime() - r.createdAt.getTime() >= FATIGUE_REPLY_WINDOW_MS)
    .map((r) => r.createdAt.getTime())
    .sort((a, b) => b - a)
  let streak = 0
  for (const at of sent) {
    if (inbound.some((t) => t > at && t <= at + FATIGUE_REPLY_WINDOW_MS)) break
    streak++
  }
  return streak
}

/** Pure: the first of `planned` kinds this household has stopped answering, never asked about. */
export function fatiguedKind(rows: readonly ActivityRow[], planned: readonly string[], now: Date): FatigueKind | null {
  const asked = new Set(rows.filter((r) => r.direction === 'out').map((r) => r.kind))
  for (const k of planned) {
    if (!isFatigueKind(k) || asked.has(fatigueAskKind(k))) continue
    if (ignoredStreak(rows, k, now) >= FATIGUE_STREAK) return k
  }
  return null
}

const LABEL: Record<Lang, Record<FatigueKind, string>> = {
  es: {
    cooking_reminder: 'la hora de empezar a cocinar',
    dinner_checkin: 'qué tal la cena',
    shopping_reminder: 'la compra',
    weekly_nudge: 'preparar el menú del domingo',
    daily_brief: 'el menú de cada mañana',
    freezer_review: 'lo que hay en el congelador',
  },
  en: {
    cooking_reminder: 'when to start cooking',
    dinner_checkin: 'how dinner went',
    shopping_reminder: 'the shopping',
    weekly_nudge: "planning Sunday's menu",
    daily_brief: "each morning's menu",
    freezer_review: "what's in the freezer",
  },
}

export function fatigueQuestion(kind: FatigueKind, lang: Lang): OutboundMessage {
  const what = LABEL[lang][kind]
  return lang === 'en'
    ? {
        type: 'buttons',
        text: `I've paused my messages about ${what}: the last few went unanswered. Shall I keep sending them?`,
        buttons: [
          { id: `avisos:si:${kind}`, title: 'Yes' },
          { id: `avisos:no:${kind}`, title: 'No' },
        ],
      }
    : {
        type: 'buttons',
        text: `He dejado en pausa mis avisos de ${what}: los últimos se quedaron sin respuesta. ¿Te sigo avisando?`,
        buttons: [
          { id: `avisos:si:${kind}`, title: 'Sí' },
          { id: `avisos:no:${kind}`, title: 'No' },
        ],
      }
}

/** The button id → which kind and what was answered; anything else → null. */
export function fatigueAnswerOf(replyId: string | null | undefined): { kind: FatigueKind; keep: boolean } | null {
  const m = /^avisos:(si|no):([a-z_]+)$/.exec(replyId ?? '')
  if (!m || !isFatigueKind(m[2])) return null
  return { kind: m[2], keep: m[1] === 'si' }
}

export function fatigueConfirmation(keep: boolean, lang: Lang): string {
  if (lang === 'en') return keep ? "Done, I'll keep sending them." : "Got it, I won't send those any more. You can switch them back on in Profile → Notifications."
  return keep ? 'Hecho, te sigo avisando.' : 'Vale, no te aviso más de eso. Si cambias de idea, lo activas en Perfil → Avisos.'
}
