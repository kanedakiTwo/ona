import type { DayMenu } from '@ona/shared'
import { mealEntriesForDay } from '../menuText.js'
import type { OutboundMessage } from './render.js'

/**
 * Pure planning for messages ONA sends first (the Instinct-style "it texts
 * you when something needs attention"):
 *   - daily brief at breakfast time: today's menu + "¿cambio algo?"
 *   - Sunday evening nudge: "¿te preparo el menú de la semana que viene?"
 *     when next week has no menu yet
 * Prep alerts ("saca el pescado del congelador") come from the existing
 * notification_schedule queue — see notificationScheduler.ts.
 *
 * The clock is Europe/Madrid regardless of the server's TZ (Railway = UTC).
 */

export { MADRID_TZ, madridParts, mondayOf, type MadridParts } from '../madridTime.js'
import type { MadridParts } from '../madridTime.js'

/** Sunday 18:00–21:59 Madrid. */
export function isWeeklyNudgeWindow(p: MadridParts): boolean {
  return p.weekday === 6 && p.hour >= 18 && p.hour < 22
}

/** From the user's breakfast time (default 09:00) for 90 minutes. */
export function isDailyBriefWindow(p: MadridParts, breakfastTime: string | null | undefined): boolean {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(breakfastTime ?? '')
  const start = m ? Number(m[1]) * 60 + Number(m[2]) : 9 * 60
  const now = p.hour * 60 + p.minute
  return now >= start && now < start + 90
}

export const DAILY_BRIEF_COOLDOWN_MS = 20 * 60 * 60 * 1000
export const WEEKLY_NUDGE_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000

export const WEEKLY_NUDGE_TEXT =
  'Domingo de planificar: ¿te preparo el menú de la semana que viene?'

export function formatDailyBrief(day: DayMenu | null | undefined, webUrl: string): string | null {
  const entries = mealEntriesForDay(day).filter((e) => e.meal !== 'breakfast')
  if (entries.length === 0) return null
  const lines = entries.map((e) => `- ${capitalize(e.label)}: ${e.dishes.join(' + ')}`)
  return `Buenos días. Hoy toca:\n${lines.join('\n')}\n\n¿Quieres cambiar algo?\n\nVer menú: ${webUrl}/menu`
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export interface ProactiveInput {
  parts: MadridParts
  breakfastTime: string | null
  briefedRecently: boolean
  nudgedRecently: boolean
  /** Lazy so the DB is only hit inside the right time window. */
  todayDay: () => Promise<DayMenu | null>
  hasNextWeekMenu: () => Promise<boolean>
  webUrl: string
}

export interface PlannedMessage {
  kind: 'daily_brief' | 'weekly_nudge'
  messages: OutboundMessage[]
}

export async function planProactive(input: ProactiveInput): Promise<PlannedMessage[]> {
  const out: PlannedMessage[] = []

  if (!input.briefedRecently && isDailyBriefWindow(input.parts, input.breakfastTime)) {
    const text = formatDailyBrief(await input.todayDay(), input.webUrl)
    if (text) out.push({ kind: 'daily_brief', messages: [{ type: 'text', text }] })
  }

  if (!input.nudgedRecently && isWeeklyNudgeWindow(input.parts) && !(await input.hasNextWeekMenu())) {
    out.push({
      kind: 'weekly_nudge',
      messages: [
        {
          type: 'buttons',
          text: WEEKLY_NUDGE_TEXT,
          buttons: [
            { id: 'nudge:yes', title: 'Sí, prepáralo' },
            { id: 'nudge:no', title: 'Ahora no' },
          ],
        },
      ],
    })
  }

  return out
}

// ─── Delivery channel choice ─────────────────────────────────────

/**
 * Meta lets a business send free-form messages only within 24 h of the
 * user's last message ("customer service window"). Outside it, only an
 * approved template goes through. Keep a 30-minute safety margin.
 */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000 - 30 * 60 * 1000

export type Delivery = 'session' | 'template' | 'skip'

export function chooseDelivery(
  lastInboundAt: Date | null,
  now: Date,
  templateConfigured: boolean,
): Delivery {
  if (lastInboundAt && now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS) return 'session'
  return templateConfigured ? 'template' : 'skip'
}

/**
 * Template body parameters can't contain newlines, tabs or 4+ consecutive
 * spaces (Meta rejects the send). Buttons are folded into the text.
 */
export function templateParamFrom(messages: OutboundMessage[]): string {
  const text = messages
    .map((m) =>
      m.type === 'buttons'
        ? `${m.text} Responde: ${m.buttons.map((b) => b.title).join(' / ')}.`
        : m.text,
    )
    .join(' ')
  return text.replace(/\s+/g, ' ').trim().slice(0, 1000)
}

// ─── Scheduler status for prep alerts sent over two channels ─────

export interface ChannelOutcome {
  status: 'ok' | 'skipped' | 'error'
  error?: string
}

/** A queued alert counts as sent when any channel delivered it. */
export function combineDelivery(push: ChannelOutcome, whatsapp: ChannelOutcome): {
  status: 'sent' | 'failed'
  errorMessage: string | null
} {
  if (push.status === 'ok' || whatsapp.status === 'ok') return { status: 'sent', errorMessage: null }
  const errors = [push.error, whatsapp.status === 'error' ? `whatsapp: ${whatsapp.error}` : null].filter(Boolean)
  return { status: 'failed', errorMessage: errors.join(' · ').slice(0, 500) || 'no-channel' }
}
