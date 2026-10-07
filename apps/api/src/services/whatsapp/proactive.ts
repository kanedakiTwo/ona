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

export const PROACTIVE_KINDS = [
  'daily_brief',
  'weekly_nudge',
  'prep_alerts',
  'cooking_reminder',
  'dinner_checkin',
  'shopping_reminder',
] as const
export type ProactiveKind = (typeof PROACTIVE_KINDS)[number]

export const PROACTIVE_LABELS: Record<ProactiveKind, string> = {
  daily_brief: 'resumen de la mañana',
  weekly_nudge: 'propuesta de menú del domingo',
  prep_alerts: 'avisos de preparación (descongelar, remojo…)',
  cooking_reminder: 'aviso de empezar a cocinar',
  dinner_checkin: '"¿hiciste la cena?"',
  shopping_reminder: 'recordatorio de la compra',
}

/** Missing key = on; the master `notify` switch is checked separately. */
export function kindEnabled(prefs: Record<string, boolean> | null | undefined, kind: ProactiveKind): boolean {
  return prefs?.[kind] !== false
}

/** "20:30" → 1230; garbage → fallback. */
export function minutesOf(time: string | null | undefined, fallback: number): number {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(time ?? '')
  return m ? Number(m[1]) * 60 + Number(m[2]) : fallback
}
const nowMinutes = (p: MadridParts) => p.hour * 60 + p.minute
const hhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`

export const DEFAULT_DINNER_MIN = 21 * 60

/**
 * Long dinners only (≥ 40 min): a 20-minute window ending when the user
 * should start so dinner is ready at their dinner time (10-min buffer).
 */
export const COOKING_REMINDER_MIN_TOTAL = 40
export function isCookingReminderWindow(p: MadridParts, dinnerTime: string | null, totalMinutes: number): boolean {
  if (totalMinutes < COOKING_REMINDER_MIN_TOTAL) return false
  const start = minutesOf(dinnerTime, DEFAULT_DINNER_MIN) - totalMinutes - 10
  return nowMinutes(p) >= start - 10 && nowMinutes(p) < start + 10
}
/** Between 2 h and 3 h after dinner time. */
export function isDinnerCheckinWindow(p: MadridParts, dinnerTime: string | null): boolean {
  const d = minutesOf(dinnerTime, DEFAULT_DINNER_MIN)
  return nowMinutes(p) >= d + 120 && nowMinutes(p) < d + 180
}
/** Saturday 10:00–12:59 Madrid. */
export function isShoppingReminderWindow(p: MadridParts): boolean {
  return p.weekday === 5 && p.hour >= 10 && p.hour < 13
}
/** Cooking reminders can only fire in the afternoon/evening; cheap pre-check. */
export function couldNeedCookingReminder(p: MadridParts, dinnerTime: string | null): boolean {
  const d = minutesOf(dinnerTime, DEFAULT_DINNER_MIN)
  return nowMinutes(p) >= d - 4 * 60 && nowMinutes(p) < d
}

export function formatCookingReminder(name: string, totalMinutes: number, dinnerTime: string | null): string {
  return `Si quieres cenar a las ${hhmm(minutesOf(dinnerTime, DEFAULT_DINNER_MIN))}, toca empezar con *${name}* (unos ${totalMinutes} min).`
}
export function formatShoppingReminder(pending: string[], webUrl: string): string {
  const shown = pending.slice(0, 8).join(', ')
  return `¿Toca compra? Te faltan ${pending.length} cosas: ${shown}${pending.length > 8 ? '…' : ''}.\n\nVer lista de la compra: ${webUrl}/shopping`
}

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

export interface TodayDinner {
  names: string[]
  /** Longest total time among today's dinner recipes (min), null if unknown. */
  totalMinutes: number | null
}

export interface ProactiveInput {
  parts: MadridParts
  breakfastTime: string | null
  dinnerTime: string | null
  prefs: Record<string, boolean>
  /** Kinds already sent within their cooldown. */
  sentRecently: Partial<Record<ProactiveKind, boolean>>
  /** Lazy so the DB is only hit inside the right time window. */
  todayDay: () => Promise<DayMenu | null>
  todayDinner: () => Promise<TodayDinner | null>
  cookedToday: () => Promise<boolean>
  pendingShopping: () => Promise<string[]>
  hasNextWeekMenu: () => Promise<boolean>
  webUrl: string
}

export interface PlannedMessage {
  kind: ProactiveKind
  messages: OutboundMessage[]
}

export async function planProactive(input: ProactiveInput): Promise<PlannedMessage[]> {
  const out: PlannedMessage[] = []
  const can = (k: ProactiveKind) => kindEnabled(input.prefs, k) && !input.sentRecently[k]
  const p = input.parts

  if (can('daily_brief') && isDailyBriefWindow(p, input.breakfastTime)) {
    const text = formatDailyBrief(await input.todayDay(), input.webUrl)
    if (text) out.push({ kind: 'daily_brief', messages: [{ type: 'text', text }] })
  }

  if (can('cooking_reminder') && couldNeedCookingReminder(p, input.dinnerTime)) {
    const dinner = await input.todayDinner()
    if (dinner?.totalMinutes && dinner.names.length && isCookingReminderWindow(p, input.dinnerTime, dinner.totalMinutes)) {
      out.push({
        kind: 'cooking_reminder',
        messages: [{ type: 'text', text: formatCookingReminder(dinner.names[0], dinner.totalMinutes, input.dinnerTime) }],
      })
    }
  }

  if (can('dinner_checkin') && isDinnerCheckinWindow(p, input.dinnerTime)) {
    const dinner = await input.todayDinner()
    if (dinner?.names.length && !(await input.cookedToday())) {
      out.push({
        kind: 'dinner_checkin',
        messages: [
          {
            type: 'buttons',
            text: `¿Hiciste hoy la cena (*${dinner.names[0]}*)? Así lo apunto.`,
            buttons: [
              { id: 'checkin:yes', title: 'Sí, la hice' },
              { id: 'checkin:no', title: 'No' },
            ],
          },
        ],
      })
    }
  }

  if (can('shopping_reminder') && isShoppingReminderWindow(p)) {
    const pending = await input.pendingShopping()
    if (pending.length >= 3) {
      out.push({ kind: 'shopping_reminder', messages: [{ type: 'text', text: formatShoppingReminder(pending, input.webUrl) }] })
    }
  }

  if (can('weekly_nudge') && isWeeklyNudgeWindow(p) && !(await input.hasNextWeekMenu())) {
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

/** Any proactive window that could fire now (cheap pre-check before DB work). */
export function anyProactiveWindow(p: MadridParts, breakfastTime: string | null, dinnerTime: string | null): boolean {
  return (
    isDailyBriefWindow(p, breakfastTime) ||
    couldNeedCookingReminder(p, dinnerTime) ||
    isDinnerCheckinWindow(p, dinnerTime) ||
    isShoppingReminderWindow(p) ||
    isWeeklyNudgeWindow(p)
  )
}

// ─── Delivery channel choice ─────────────────────────────────────

/**
 * Meta lets a business send free-form messages only within 24 h of the
 * user's last message ("customer service window"). Outside it, only an
 * approved template goes through. Keep a 30-minute safety margin.
 */
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000 - 30 * 60 * 1000

export type Delivery = 'session' | 'template' | 'skip'

/**
 * Which approved template carries a proactive message of `kind` outside the
 * 24 h window: the per-kind one from WHATSAPP_TEMPLATES (JSON map, e.g.
 * {"daily_brief":"ona_menu_de_hoy","alert":"ona_aviso_preparacion"}),
 * else the generic WHATSAPP_TEMPLATE_NAME, else none (the message is
 * skipped). Meta reviews templates per use: one generic "{{1}}" wrapper
 * for everything is what its policy discourages.
 */
export function templateFor(kind: string, perKind: Readonly<Record<string, string>>, generic: string): string | null {
  const named = perKind[kind]
  if (typeof named === 'string' && named.trim()) return named.trim()
  return generic.trim() || null
}

/** Parse WHATSAPP_TEMPLATES; anything malformed → {} (log once at boot). */
export function parseTemplateMap(raw: string): Record<string, string> {
  if (!raw.trim()) return {}
  try {
    const v = JSON.parse(raw)
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
    return Object.fromEntries(Object.entries(v).filter(([, name]) => typeof name === 'string' && name.trim())) as Record<string, string>
  } catch {
    console.warn('[whatsapp] WHATSAPP_TEMPLATES is not valid JSON; ignoring it')
    return {}
  }
}

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
