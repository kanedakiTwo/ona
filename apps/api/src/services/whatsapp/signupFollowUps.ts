/**
 * What the WhatsApp sign-up used to send in the same second as the first
 * menu (Miguel, 19-nov): the link to add allergies on the web (also the rest
 * of the family's) and the avisos question. Now they come ~10 minutes after
 * the first menu, one at a time, from the scheduler's tick (every 5 min,
 * under its Postgres lock, so one process sends): first the health link
 * (`health_link`), then — 5 min of quiet later at least — the avisos question
 * (`optin_prompt`, with its two buttons). The answer to it still brings the
 * three first steps (inbound.ts, `signupEnding`).
 *
 * What was sent is read back from `whatsapp_messages` (the kinds), so a
 * restart or a deploy loses nothing and nothing goes twice. Never while the
 * conversation is going (a message in or out in the last 5 min), never at
 * night (22:30–08:00, the avisos' hours), never after BAJA, and only within
 * 20 h of the sign-up (inside Meta's 24 h window).
 */
import { and, eq, gte, isNotNull, isNull, lte, max } from 'drizzle-orm'
import { db } from '../../db/connection.js'
import { users, whatsappLinks, whatsappMessages } from '../../db/schema.js'
import { isAwakeInstant } from '../notifications/hours.js'
import { optInButtons, signupCopy } from './inbound.js'
import { languageForPhone } from './outbound.js'
import type { Lang } from './language.js'
import { renderPlainText, outboundBody, type OutboundMessage } from './render.js'
import { recordServiceMessageCost } from './serviceCost.js'
import * as store from './store.js'
import * as client from './client.js'
import { isWhatsAppConfigured } from './config.js'
import { env } from '../../config/env.js'

/** From the first menu to the health link. */
export const SIGNUP_FOLLOWUP_DELAY_MS = 10 * 60 * 1000
/** No follow-up while the conversation is going: this much quiet first (and between the two). */
export const SIGNUP_FOLLOWUP_QUIET_MS = 5 * 60 * 1000
/** Past this from the sign-up, nothing more (Meta's 24 h window). */
export const SIGNUP_FOLLOWUP_MAX_MS = 20 * 60 * 60 * 1000

export type SignupFollowUp = 'health_link' | 'optin_prompt'

/**
 * Pure: what is due now for a number whose sign-up ended at `completedAt`.
 * `kinds`: outbound kinds sent to it (latest time each); `lastActivityAt`:
 * its latest message, in or out.
 */
export function dueSignupFollowUp(input: {
  completedAt: Date
  kinds: ReadonlyMap<string, Date>
  lastActivityAt: Date | null
  now: Date
}): SignupFollowUp | null {
  const { completedAt, kinds, lastActivityAt, now } = input
  const since = now.getTime() - completedAt.getTime()
  // Only the WhatsApp-first sign-up (its first message is kind 'onboarding').
  if (!kinds.has('onboarding')) return null
  if (since < SIGNUP_FOLLOWUP_DELAY_MS || since > SIGNUP_FOLLOWUP_MAX_MS) return null
  // Already asked (the flow before 19-nov sent both with the menu), or BAJA.
  if (kinds.has('optin_prompt') || kinds.has('optout')) return null
  if (lastActivityAt && now.getTime() - lastActivityAt.getTime() < SIGNUP_FOLLOWUP_QUIET_MS) return null
  if (!kinds.has('health_link')) return 'health_link'
  // They wrote ALTA by themselves: nothing to ask.
  if (kinds.has('optin')) return null
  return 'optin_prompt'
}

/** The message of a follow-up, in the household's language (PRO-1300). */
export function signupFollowUpMessage(which: SignupFollowUp, webUrl: string, lang: Lang = 'es'): OutboundMessage[] {
  const copy = signupCopy(lang)
  if (which === 'health_link') return renderPlainText(copy.healthOnWeb(`${webUrl.replace(/\/$/, '')}/profile`))
  return [{ type: 'buttons', text: copy.optInPrompt, buttons: optInButtons(lang) }]
}

/** One tick: send what is due. Returns how many messages went out. */
export async function runSignupFollowUps(now: Date = new Date()): Promise<number> {
  if (!isWhatsAppConfigured() || !isAwakeInstant(now)) return 0
  const rows = await db
    .select({ userId: users.id, phone: whatsappLinks.phone, completedAt: users.onboardingCompletedAt })
    .from(users)
    .innerJoin(whatsappLinks, eq(whatsappLinks.userId, users.id))
    .where(
      and(
        isNotNull(users.onboardingCompletedAt),
        gte(users.onboardingCompletedAt, new Date(now.getTime() - SIGNUP_FOLLOWUP_MAX_MS)),
        lte(users.onboardingCompletedAt, new Date(now.getTime() - SIGNUP_FOLLOWUP_DELAY_MS)),
        isNull(users.suspendedAt),
      ),
    )
  let sent = 0
  for (const row of rows) {
    try {
      const kinds = await store.recentOutboundKinds(row.phone, new Date(0))
      const [last] = await db
        .select({ at: max(whatsappMessages.createdAt) })
        .from(whatsappMessages)
        .where(eq(whatsappMessages.phone, row.phone))
      const which = dueSignupFollowUp({ completedAt: row.completedAt!, kinds, lastActivityAt: last?.at ?? null, now })
      if (!which) continue
      const lang = await languageForPhone(row.phone)
      for (const m of signupFollowUpMessage(which, env.WEB_PUBLIC_URL, lang)) {
        try {
          const wamid = await client.sendMessage(row.phone, m)
          void recordServiceMessageCost(row.userId)
          await store.insertOutbound({ phone: row.phone, userId: row.userId, kind: which, body: outboundBody(m), status: 'sent', wamid })
          sent++
        } catch (err: any) {
          // Recorded as sent-and-failed under the same kind: it isn't tried again.
          await store.insertOutbound({ phone: row.phone, userId: row.userId, kind: which, body: outboundBody(m), status: 'failed', errorMessage: String(err?.message ?? err).slice(0, 500) })
        }
      }
    } catch (err) {
      console.warn('[whatsapp] sign-up follow-up failed for', row.userId, err)
    }
  }
  return sent
}
