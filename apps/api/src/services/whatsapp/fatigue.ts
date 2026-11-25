import type { OutboundMessage } from './render.js'
import type { Lang } from './language.js'

/**
 * An aviso nobody answers is noise. 19-nov: 5 unanswered of one kind paused
 * that kind alone, so a silent household still got 15 or 20 messages before
 * every kind had stopped (history 28-oct → 23-nov: the households that never
 * answer got 70 % of the avisos and answered 3 of 59; one asked for BAJA
 * after 6). Since PRO-1303 the count is ONE for every kind:
 *
 *   - 3 avisos in a row (any kind: cooking, dinner, shopping, Sunday, morning
 *     menu, freezer review, prep alerts) with no sign of life after them —
 *     no message, no button, no opening the app — and Mimo sends a single
 *     «¿Te sigo avisando?» [Sí] [No] instead of the next one;
 *   - from then on EVERY aviso waits (prep alerts too) until the person
 *     answers or writes on WhatsApp: any inbound message lifts the pause;
 *   - «Sí» lifts it; «No» lifts it and switches every aviso off (the same
 *     switches as Perfil → Avisos), so the app shows them off.
 *
 * And a household that hasn't opened this week's menu nor written in 14 days
 * gets no «hora de cocinar» nor «¿qué tal la cena?» (`dormantSkips`): it isn't
 * cooking from the menu. Pure.
 */
export const FATIGUE_STREAK = 3
/** An aviso younger than this isn't judged yet: it may still get its answer. */
export const FATIGUE_REPLY_WINDOW_MS = 12 * 60 * 60 * 1000

/** The kinds of the «Avisos» switches that are messages (the Thursday week isn't one). */
export const FATIGUE_KINDS = ['cooking_reminder', 'dinner_checkin', 'shopping_reminder', 'weekly_nudge', 'daily_brief', 'freezer_review', 'prep_alerts'] as const
export type FatigueKind = (typeof FATIGUE_KINDS)[number]

/** Outbound kinds of `whatsapp_messages` that are avisos (a prep alert is stored as `alert`). */
export const AVISO_OUTBOUND_KINDS: ReadonlySet<string> = new Set([...FATIGUE_KINDS, 'alert'])

/** The outbound kind of the single question (its presence after the last inbound = paused). */
export const PAUSE_ASK_KIND = 'pausa:todos'

/** Before PRO-1303 the question was per kind (`pausa:<kind>`); its buttons still get an answer. */
export const isFatigueKind = (k: string): k is FatigueKind => (FATIGUE_KINDS as readonly string[]).includes(k)

export interface ActivityRow {
  direction: 'in' | 'out' | string
  kind?: string | null
  status: string
  createdAt: Date
}

const lastInbound = (rows: readonly ActivityRow[]): number =>
  Math.max(-Infinity, ...rows.filter((r) => r.direction === 'in').map((r) => r.createdAt.getTime()))

/**
 * How many avisos (any kind) went out since the person's last sign of life:
 * a WhatsApp message or button (`rows`, direction `in`) or using the app
 * (`appSeenAt`). One sent less than `FATIGUE_REPLY_WINDOW_MS` ago isn't
 * judged yet; a failed one doesn't count.
 */
export function ignoredStreak(rows: readonly ActivityRow[], appSeenAt: Date | null, now: Date): number {
  const alive = Math.max(lastInbound(rows), appSeenAt?.getTime() ?? -Infinity)
  return rows.filter(
    (r) =>
      r.direction === 'out' &&
      AVISO_OUTBOUND_KINDS.has(r.kind ?? '') &&
      r.status === 'sent' &&
      r.createdAt.getTime() > alive &&
      now.getTime() - r.createdAt.getTime() >= FATIGUE_REPLY_WINDOW_MS,
  ).length
}

/** The question went out and nothing came in on WhatsApp since: every aviso waits. */
export function avisosPaused(rows: readonly ActivityRow[]): boolean {
  const asked = rows.filter((r) => r.direction === 'out' && r.kind === PAUSE_ASK_KIND).map((r) => r.createdAt.getTime())
  if (asked.length === 0) return false
  return Math.max(...asked) > lastInbound(rows)
}

/**
 * Before the avisos of a moment go: `paused` (send nothing), `ask` (send the
 * question instead of them) or `send`.
 */
export function avisoPauseState(rows: readonly ActivityRow[], appSeenAt: Date | null, now: Date): 'paused' | 'ask' | 'send' {
  if (avisosPaused(rows)) return 'paused'
  return ignoredStreak(rows, appSeenAt, now) >= FATIGUE_STREAK ? 'ask' : 'send'
}

export function fatigueQuestion(lang: Lang): OutboundMessage {
  return lang === 'en'
    ? {
        type: 'buttons',
        text: "I've paused my reminders: the last few went unanswered. Shall I keep sending them?",
        buttons: [
          { id: 'avisos:si:todos', title: 'Yes' },
          { id: 'avisos:no:todos', title: 'No' },
        ],
      }
    : {
        type: 'buttons',
        text: 'He dejado en pausa mis avisos: los últimos se quedaron sin respuesta. ¿Te sigo avisando?',
        buttons: [
          { id: 'avisos:si:todos', title: 'Sí' },
          { id: 'avisos:no:todos', title: 'No' },
        ],
      }
}

/** The button id → which kind (`todos`, or one kind from a question before PRO-1303) and the answer; anything else → null. */
export function fatigueAnswerOf(replyId: string | null | undefined): { kind: FatigueKind | 'todos'; keep: boolean } | null {
  const m = /^avisos:(si|no):([a-z_]+)$/.exec(replyId ?? '')
  if (!m || (m[2] !== 'todos' && !isFatigueKind(m[2]))) return null
  return { kind: m[2] as FatigueKind | 'todos', keep: m[1] === 'si' }
}

export function fatigueConfirmation(keep: boolean, lang: Lang): string {
  if (lang === 'en') return keep ? "Done, I'll keep sending them." : "Got it, no more of those reminders. You can switch them back on in Profile → Notifications."
  return keep ? 'Hecho, te sigo avisando.' : 'Vale, no te mando más esos avisos. Si cambias de idea, los activas en Perfil → Avisos.'
}

// ─── Households that aren't cooking from the menu ──────────────────

export const DORMANT_DAYS = 14
/** What only makes sense to someone cooking from this week's menu. */
export const DORMANT_SKIPPED_KINDS: ReadonlySet<string> = new Set(['cooking_reminder', 'dinner_checkin'])

/**
 * No «hora de cocinar» nor «¿qué tal la cena?» when the household hasn't
 * opened this week's menu (in the app) AND nobody wrote to Mimo in the last
 * 14 days (WhatsApp or the app's chat).
 */
export function isDormant(s: { openedWeekMenu: boolean; lastWroteAt: Date | null }, now: Date): boolean {
  if (s.openedWeekMenu) return false
  return !s.lastWroteAt || now.getTime() - s.lastWroteAt.getTime() > DORMANT_DAYS * 24 * 60 * 60 * 1000
}
