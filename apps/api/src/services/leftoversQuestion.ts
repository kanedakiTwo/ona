/**
 * Mimo's one question about leftovers (PRO-285, Miguel 2026-10-20: «que lo
 * mande Mimo por WhatsApp»), to decide PRO-227 (D-069).
 *
 * To each beta user with WhatsApp linked, the next time they write to Mimo on
 * WhatsApp, Mimo adds the question ONCE at the end of its reply. A reply, so
 * always inside Meta's 24 h window: no template, no message of its own, and
 * it doesn't count towards the weekly aviso budget (D-069).
 *
 *   - Once per user: `users.leftovers_question_at`, stamped atomically.
 *   - Only on WhatsApp, with the link's last inbound message inside the
 *     service window (`SERVICE_WINDOW_MS`), never during the first steps.
 *   - Never in the same reply as another offer (invite another household,
 *     the family, the avisos re-offer): `offerAdded` tells them apart.
 *   - Off by itself from 2026-11-08 (Madrid), or once everyone has seen it.
 *   - The user's next message after it is saved verbatim in `user_feedback`
 *     with the tag `sobras` (channel `whatsapp`); `/admin/feedback` counts
 *     them (`byTag`). Customer Success summarises them without names.
 *
 * Pure rules + DB glue behind a small store (tests/leftoversQuestion.test.ts).
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { madridParts } from './madridTime.js'
import { SERVICE_WINDOW_MS } from './whatsapp/proactive.js'
import type { ChatMessage } from './assistant/types.js'

type Db = typeof defaultDb

/** Miguel's text (approval 2026-10-20), word for word. */
export const LEFTOVERS_QUESTION =
  'Una pregunta rápida para Mimoia: ¿os sobró algo de la última cena que hicisteis en casa? Y si sobró, ¿qué hicisteis con ello: táper para el día siguiente, al congelador, se lo comió alguien o acabó tirándose? Contesta como te salga: nos ayuda a decidir si te pregunto por las sobras.'

/** What the previous reply must contain for the next message to be the answer. */
export const LEFTOVERS_QUESTION_MARKER = 'nos ayuda a decidir si te pregunto por las sobras'

/** The feedback tag of the answers. */
export const LEFTOVERS_FEEDBACK_TAG = 'sobras'

/** First Madrid day the question no longer goes out. */
export const LEFTOVERS_QUESTION_OFF_FROM = '2026-11-08'

export interface LeftoversQuestionInput {
  /** When it was already asked (never again). */
  askedAt: Date | null
  /** The user has WhatsApp linked. */
  linked: boolean
  /** The link's last inbound message (opens Meta's 24 h window). */
  lastInboundAt: Date | null
  now: Date
}

/** Pure: append the question to this WhatsApp reply? (The caller checks the channel and other offers.) */
export function shouldAskLeftovers(i: LeftoversQuestionInput): boolean {
  if (i.askedAt) return false
  if (madridParts(i.now).isoDate >= LEFTOVERS_QUESTION_OFF_FROM) return false
  if (!i.linked || !i.lastInboundAt) return false
  return i.now.getTime() - i.lastInboundAt.getTime() < SERVICE_WINDOW_MS
}

/** Pure: the reply with the question at the end. */
export function withLeftoversQuestion(message: string): string {
  const body = message.trimEnd()
  return body ? `${body}\n\n${LEFTOVERS_QUESTION}` : LEFTOVERS_QUESTION
}

/** Pure: is this message the answer to the question Mimo just asked? */
export function isLeftoversAnswer(message: string, history: readonly ChatMessage[]): boolean {
  const last = [...history].reverse().find((m) => m.role === 'assistant')
  if (!last || !last.content.includes(LEFTOVERS_QUESTION_MARKER)) return false
  return message.trim().length >= 2
}

// ─── Store (DB) ───────────────────────────────────────────────────

export interface LeftoversQuestionStore {
  load(userId: string): Promise<Omit<LeftoversQuestionInput, 'now'> | null>
  /** Stamp it as asked, only the first time; false when someone else already did. */
  claim(userId: string, now: Date): Promise<boolean>
  /** Save the answer as an opinion tagged `sobras`, once per user; false when one is already there. */
  saveAnswer(userId: string, text: string): Promise<boolean>
}

export function createDbLeftoversQuestionStore(db: Db = defaultDb): LeftoversQuestionStore {
  return {
    async load(userId) {
      const res = await db.execute(sql`
        SELECT u.leftovers_question_at AS asked_at,
               (SELECT max(wl.last_inbound_at) FROM whatsapp_links wl WHERE wl.user_id = u.id) AS last_inbound_at,
               EXISTS (SELECT 1 FROM whatsapp_links wl WHERE wl.user_id = u.id) AS linked
          FROM users u WHERE u.id = ${userId}::uuid
      `)
      const r = (res.rows as any[])[0]
      if (!r) return null
      return {
        askedAt: r.asked_at ? new Date(r.asked_at) : null,
        linked: Boolean(r.linked),
        lastInboundAt: r.last_inbound_at ? new Date(r.last_inbound_at) : null,
      }
    },
    async claim(userId, now) {
      const res = await db.execute(sql`
        UPDATE users SET leftovers_question_at = ${now.toISOString()}::timestamptz
         WHERE id = ${userId}::uuid AND leftovers_question_at IS NULL
        RETURNING id
      `)
      return res.rows.length > 0
    },
    async saveAnswer(userId, text) {
      const res = await db.execute(sql`
        INSERT INTO user_feedback (user_id, channel, text, tag)
        SELECT ${userId}::uuid, 'whatsapp', ${text}, ${LEFTOVERS_FEEDBACK_TAG}
         WHERE NOT EXISTS (
           SELECT 1 FROM user_feedback f WHERE f.user_id = ${userId}::uuid AND f.tag = ${LEFTOVERS_FEEDBACK_TAG}
         )
        RETURNING id
      `)
      return res.rows.length > 0
    },
  }
}

// ─── Glue ─────────────────────────────────────────────────────────

/**
 * The reply, with the question at the end when it is due (and stamped so it
 * never repeats). Only for WhatsApp replies that carry no other offer. Never
 * throws: on any failure the reply goes as it was.
 */
export async function maybeAppendLeftoversQuestion(
  userId: string,
  reply: string,
  opts: { mode: string; otherOffer: boolean; onboarding?: boolean; store?: LeftoversQuestionStore; now?: Date },
): Promise<string> {
  if (opts.mode !== 'whatsapp' || opts.otherOffer || opts.onboarding || !reply.trim()) return reply
  const now = opts.now ?? new Date()
  try {
    const store = opts.store ?? createDbLeftoversQuestionStore()
    const state = await store.load(userId)
    if (!state || !shouldAskLeftovers({ ...state, now })) return reply
    if (!(await store.claim(userId, now))) return reply
    return withLeftoversQuestion(reply)
  } catch (err) {
    console.warn('[leftovers-question] skipped:', (err as Error)?.message ?? err)
    return reply
  }
}

/** The message right after the question: saved verbatim, tagged `sobras`. Never throws. */
export async function recordLeftoversAnswer(
  userId: string,
  message: string,
  history: readonly ChatMessage[],
  opts: { store?: LeftoversQuestionStore } = {},
): Promise<boolean> {
  try {
    if (!isLeftoversAnswer(message, history)) return false
    const store = opts.store ?? createDbLeftoversQuestionStore()
    return await store.saveAnswer(userId, message.trim().slice(0, 2000))
  } catch (err) {
    console.warn('[leftovers-question] answer not recorded:', (err as Error)?.message ?? err)
    return false
  }
}
