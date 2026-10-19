/**
 * Un aviso, un canal (PRO-234, D-080; specs/notifications.md «Channels»).
 *
 * Every day-to-day alert has ONE channel:
 *   - With WhatsApp linked and «avisos» on, everything (morning menu, start
 *     cooking, freezer/soak, «¿hiciste la cena?», Saturday shopping, Sunday
 *     planning) goes only by WhatsApp.
 *   - Without WhatsApp, only the prep alerts (freezer, soak…) go by the phone
 *     notification (Web Push); the rest doesn't go out.
 *   - Fallback only when WhatsApp fails (outside the 24 h window without a
 *     template, or a Meta error): the phone notification, if the person turned
 *     it on. If that also fails, the alert stays as not sent.
 *
 * Email carries only account and legal messages (welcome, password, invites,
 * newsletter, trial day 12, the notice 15 days before the first charge). The
 * day-7 founder offer is in the app plus ONE message: WhatsApp if it gets
 * through, otherwise email (`founderOffer.ts`).
 */
import { and, eq, like } from 'drizzle-orm'
import { db } from '../../db/connection.js'
import { notificationSchedule } from '../../db/schema.js'
import { PushNotConfiguredError, sendPushToUser, type PushPayload } from '../pushNotifier.js'
import type { ChannelOutcome, ProactiveKind } from '../whatsapp/proactive.js'

export type AlertChannel = 'whatsapp' | 'push'

/** Whether WhatsApp can carry this person's alerts at all. */
export type WhatsAppAlertState =
  /** Linked, «avisos» on, not suspended, and this kind is on. */
  | 'ready'
  /** Linked with «avisos» on, but this kind was switched off: the alert doesn't go out anywhere. */
  | 'kind_off'
  /** No usable WhatsApp (not linked, «avisos» off, not configured). */
  | 'none'

/** The only kinds that go by phone notification when there is no WhatsApp. */
export const PUSH_WITHOUT_WHATSAPP: ReadonlySet<ProactiveKind> = new Set<ProactiveKind>(['prep_alerts'])

/** Kinds that only email carries (account and legal), for the record and the spec. */
export const EMAIL_ONLY = ['welcome', 'password_reset', 'invite', 'newsletter', 'trial_ending', 'charge_notice'] as const

/**
 * Pure: in which order to try the channels for an alert of `kind`. The
 * second entry, when there is one, is only the fallback.
 */
export function channelsFor(kind: ProactiveKind, whatsapp: WhatsAppAlertState): AlertChannel[] {
  if (whatsapp === 'kind_off') return []
  if (whatsapp === 'ready') return ['whatsapp', 'push']
  return PUSH_WITHOUT_WHATSAPP.has(kind) ? ['push'] : []
}

export interface DeliveryResult {
  status: 'sent' | 'failed'
  /** The channel that delivered it, null when none did. */
  channel: AlertChannel | null
  errorMessage: string | null
}

/**
 * Try the channels in order and stop at the first that delivers: the next one
 * runs only when the previous failed or was skipped (never both). A sender that
 * throws counts as an error.
 */
export async function deliverInOrder(
  channels: readonly AlertChannel[],
  send: Record<AlertChannel, () => Promise<ChannelOutcome>>,
): Promise<DeliveryResult> {
  const errors: string[] = []
  for (const ch of channels) {
    let out: ChannelOutcome
    try {
      out = await send[ch]()
    } catch (err: any) {
      out = { status: 'error', error: String(err?.message ?? err).slice(0, 300) }
    }
    if (out.status === 'ok') return { status: 'sent', channel: ch, errorMessage: null }
    if (out.error) errors.push(`${ch}: ${out.error}`)
  }
  return { status: 'failed', channel: null, errorMessage: errors.join(' · ').slice(0, 500) || 'no-channel' }
}

/** Web Push as a ChannelOutcome: ok only when at least one device got it. */
export async function pushOutcome(
  userId: string,
  payload: PushPayload,
  send: typeof sendPushToUser = sendPushToUser,
): Promise<ChannelOutcome> {
  try {
    const r = await send(userId, payload)
    if (r.sent > 0) return { status: 'ok' }
    return r.failed > 0 ? { status: 'error', error: 'push-failed' } : { status: 'skipped', error: 'no-push-subscription' }
  } catch (err: any) {
    return {
      status: 'error',
      error: err instanceof PushNotConfiguredError ? 'push-not-configured' : String(err?.message ?? err).slice(0, 300),
    }
  }
}

// ─── Fallback for Mimo's WhatsApp messages (morning menu, cooking…) ─────

const PUSH_URL: Partial<Record<ProactiveKind, string>> = { shopping_reminder: '/shopping' }

/**
 * Pure: the phone notification that stands in for a WhatsApp message that
 * couldn't go out. Links and WhatsApp bold are dropped; it opens the menu (or
 * the shopping list).
 */
export function pushPayloadForProactive(kind: ProactiveKind, text: string): PushPayload {
  const body = text
    .split('\n')
    .filter((l) => !/https?:\/\//.test(l))
    .join(' ')
    .replace(/\S*https?:\/\/\S+/g, '')
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return {
    title: 'Mimo',
    body: body.length > 180 ? `${body.slice(0, 179)}…` : body,
    url: PUSH_URL[kind] ?? '/menu',
    tag: `proactive:${kind}`,
  }
}

/** One fallback per person, kind and Madrid day. */
export function fallbackKey(kind: ProactiveKind, userId: string, isoDate: string): string {
  return `fallback:${kind}:${userId}:${isoDate}`
}

/** Kinds that already went out today as a phone notification instead of WhatsApp. */
export async function fallbackKindsToday(userId: string, isoDate: string): Promise<Set<string>> {
  const rows = await db
    .select({ key: notificationSchedule.dedupKey })
    .from(notificationSchedule)
    .where(and(eq(notificationSchedule.userId, userId), like(notificationSchedule.dedupKey, `fallback:%:${userId}:${isoDate}`)))
  return new Set(rows.map((r) => r.key.split(':')[1]))
}

/**
 * A proactive WhatsApp message didn't go out: send it as a phone notification
 * instead, at most once per kind and day (the row in `notification_schedule`
 * claims it, so the next tick doesn't retry). Not sent → stays `failed`.
 */
export async function pushFallbackForProactive(
  userId: string,
  kind: ProactiveKind,
  text: string,
  isoDate: string,
  now: Date = new Date(),
): Promise<ChannelOutcome> {
  const payload = pushPayloadForProactive(kind, text)
  const claimed = await db
    .insert(notificationSchedule)
    .values({ userId, dedupKey: fallbackKey(kind, userId, isoDate), fireAt: now, payload, status: 'sent', sentAt: now })
    .onConflictDoNothing({ target: notificationSchedule.dedupKey })
    .returning({ id: notificationSchedule.id })
  if (claimed.length === 0) return { status: 'skipped', error: 'already-sent-today' }
  const out = await pushOutcome(userId, payload)
  if (out.status !== 'ok') {
    await db
      .update(notificationSchedule)
      .set({ status: 'failed', errorMessage: `respaldo: ${out.error ?? out.status}` })
      .where(eq(notificationSchedule.id, claimed[0].id))
  }
  return out
}
