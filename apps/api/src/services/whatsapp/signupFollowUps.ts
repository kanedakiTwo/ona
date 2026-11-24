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
import { COPY } from './inbound.js'
import { OPT_IN_NO, OPT_IN_YES } from './commands.js'
import { renderPlainText, outboundBody, type OutboundMessage } from './render.js'
import { recordServiceMessageCost } from './serviceCost.js'
import * as store from './store.js'
import * as client from './client.js'
import { isWhatsAppConfigured } from './config.js'
import { env } from '../../config/env.js'
import { flushChatAllergyOutbox, signupAsk } from '../chatAllergies.js'

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
  // PRO-1305: the allergy permission's question stands for the health link.
  if (!kinds.has('health_link') && !kinds.has('health_ask')) return 'health_link'
  // They wrote ALTA by themselves: nothing to ask.
  if (kinds.has('optin')) return null
  return 'optin_prompt'
}

/** The message of a follow-up. */
export function signupFollowUpMessage(which: SignupFollowUp, webUrl: string): OutboundMessage[] {
  if (which === 'health_link') return renderPlainText(COPY.healthOnWeb(`${webUrl.replace(/\/$/, '')}/profile`))
  return [
    {
      type: 'buttons',
      text: COPY.optInPrompt,
      buttons: [
        { id: 'optin_yes', title: OPT_IN_YES },
        { id: 'optin_no', title: OPT_IN_NO },
      ],
    },
  ]
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
      // PRO-1305 (E-103 §3): an allergy said in the sign-up, no permission and
      // never asked → the one-time question instead of the link to the web.
      if (which === 'health_link' && (await sendSignupAsk(row.userId, row.phone))) {
        sent++
        continue
      }
      for (const m of signupFollowUpMessage(which, env.WEB_PUBLIC_URL)) {
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

/** The one-time allergy question (PRO-1305), when it is due. True = it went out. */
async function sendSignupAsk(userId: string, phone: string): Promise<boolean> {
  const due = await signupAsk(userId, 'es').catch((err) => {
    console.warn('[whatsapp] sign-up allergy question not read:', err?.message ?? err)
    return null
  })
  if (!due) return false
  const { languageForPhone } = await import('./outbound.js')
  const lang = await languageForPhone(phone).catch(() => 'es' as const)
  let wentOut = false
  await flushChatAllergyOutbox(due.outbox, {
    lang,
    send: async (m) => {
      const out: OutboundMessage = m.buttons?.length ? { type: 'buttons', text: m.text, buttons: m.buttons } : { type: 'text', text: m.text }
      try {
        const wamid = await client.sendMessage(phone, out)
        void recordServiceMessageCost(userId)
        await store.insertOutbound({ phone, userId, kind: m.kind, body: outboundBody(out), status: 'sent', wamid })
        wentOut = true
        return wamid
      } catch (err: any) {
        await store.insertOutbound({ phone, userId, kind: m.kind, body: outboundBody(out), status: 'failed', errorMessage: String(err?.message ?? err).slice(0, 500) })
        wentOut = true
        return null
      }
    },
  })
  return wentOut
}
