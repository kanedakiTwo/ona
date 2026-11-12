/**
 * The Sean Ellis survey (PRO-334, CS-07): «Si mañana Mimoia dejara de
 * existir, ¿cómo te sentirías?», asked ONCE to each adult of the beta who
 * has really used Mimoia for two weeks (specs/feedback.md).
 *
 *   - Who: own adult account (not a child of the household), 14 days or
 *     more since sign-up, a menu, Mimoia used on 2 different Madrid days in
 *     the last 14 (app or WhatsApp), during the beta. Never an internal or
 *     test household (same rules as the «pregunta única», PRO-1091).
 *   - Where: on WhatsApp, at the end of one of Mimo's replies (a reply, so
 *     inside the 24 h window; never with another offer), when the person
 *     wrote to Mimo there in the last 7 days; otherwise a card on /menu that
 *     can be closed. Mimo also files it when the answer comes in the chat
 *     (tool `answer_sean_ellis`, D-051).
 *   - Once per person: `users.sean_ellis_at`, stamped when asked on
 *     WhatsApp, when the card is closed and when it is answered.
 *   - The answer is an opinion (`user_feedback`, tag `sean_ellis`) with the
 *     option in `answer`; the agents only see counts by option (D-094).
 *
 * Pure rules + DB glue behind a small store (tests/seanEllisSurvey.test.ts).
 */
import { sql } from 'drizzle-orm'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { isBeta } from './billing.js'
import { isInternalAccount, isTestEmail, testDomains } from './whatsapp/oneOffQuestion.js'
import { SERVICE_WINDOW_MS } from './whatsapp/proactive.js'
import type { ChatMessage } from './assistant/types.js'

type Db = typeof defaultDb

export const SEAN_ELLIS_TAG = 'sean_ellis'
export const SEAN_ELLIS_AFTER_DAYS = 14
export const SEAN_ELLIS_MIN_ACTIVE_DAYS = 2
/** Wrote to Mimo on WhatsApp within these days → it is asked there, not on /menu. */
export const SEAN_ELLIS_WHATSAPP_DAYS = 7

export const SEAN_ELLIS_ANSWERS = ['muy', 'algo', 'nada', 'ya_no'] as const
export type SeanEllisAnswer = (typeof SEAN_ELLIS_ANSWERS)[number]

/** CS-07 v0.2 (Legal, LEG-508), word for word. */
export const SEAN_ELLIS_QUESTION = 'Si mañana Mimoia dejara de existir, ¿cómo te sentirías?'
export const SEAN_ELLIS_OPTIONS: ReadonlyArray<{ key: SeanEllisAnswer; label: string }> = [
  { key: 'muy', label: 'Muy decepcionado/a' },
  { key: 'algo', label: 'Algo decepcionado/a' },
  { key: 'nada', label: 'Nada decepcionado/a (no me resulta tan útil)' },
  { key: 'ya_no', label: 'Ya no la uso' },
]
export const SEAN_ELLIS_WHY = '¿Por qué?'
export const SEAN_ELLIS_WHATSAPP =
  'Una cosa rápida, si te apetece: si mañana Mimoia dejara de existir, ¿cómo te sentirías? 1) Muy decepcionado/a · 2) Algo · 3) Nada · 4) Ya no la uso. Contesta con el número; nos ayuda a decidir qué mejorar.'
/** What the previous reply must contain for the next message to be the answer. */
export const SEAN_ELLIS_MARKER = 'nos ayuda a decidir qué mejorar'

const DAY_MS = 24 * 60 * 60 * 1000

export interface SeanEllisState {
  createdAt: Date
  /** Asked on WhatsApp, card closed or answered: never again. */
  askedAt: Date | null
  answered: boolean
  /** A child account in its household. */
  child: boolean
  /** Everyone in the person's households (the person included). */
  housemates: Array<{ email: string; role: string }>
  hasMenu: boolean
  /** Different Madrid days with app use or a WhatsApp message, last 14. */
  activeDays: number
  /** The WhatsApp link's last inbound message; null = not linked or never wrote. */
  lastInboundAt: Date | null
}

export interface SeanEllisRules {
  now: Date
  adminEmails?: readonly string[]
  testDomains?: readonly string[]
}

/** Pure: is the survey due for this person (on any channel)? */
export function seanEllisDue(s: SeanEllisState, r: SeanEllisRules): boolean {
  if (s.askedAt || s.answered || s.child) return false
  if (!isBeta(r.now)) return false
  if (r.now.getTime() - s.createdAt.getTime() < SEAN_ELLIS_AFTER_DAYS * DAY_MS) return false
  if (!s.hasMenu || s.activeDays < SEAN_ELLIS_MIN_ACTIVE_DAYS) return false
  const admins = r.adminEmails ?? env.ADMIN_EMAILS
  const domains = r.testDomains ?? testDomains()
  return !s.housemates.some((m) => isInternalAccount(m, admins) || isTestEmail(m.email, domains))
}

/** Pure: where it goes, if due. WhatsApp when the person wrote there in the last 7 days. */
export function seanEllisChannel(s: SeanEllisState, r: SeanEllisRules): 'whatsapp' | 'web' | null {
  if (!seanEllisDue(s, r)) return null
  const recent = s.lastInboundAt && r.now.getTime() - s.lastInboundAt.getTime() < SEAN_ELLIS_WHATSAPP_DAYS * DAY_MS
  return recent ? 'whatsapp' : 'web'
}

/** Pure: the option in a free answer («2», «muy decepcionada», «ya no la uso»), or null. */
export function parseSeanEllisAnswer(text: string): SeanEllisAnswer | null {
  const t = text.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  const digit = /^\s*([1-4])(?!\d)/.exec(t)
  if (digit) return SEAN_ELLIS_ANSWERS[Number(digit[1]) - 1]
  if (/\bya no (la )?uso\b/.test(t)) return 'ya_no'
  if (/\bmuy\b/.test(t)) return 'muy'
  if (/\balgo\b/.test(t)) return 'algo'
  if (/\bnada\b/.test(t)) return 'nada'
  return null
}

/** Pure: is this message the answer to the question Mimo just asked on WhatsApp? */
export function isSeanEllisReply(message: string, history: readonly ChatMessage[]): boolean {
  const last = [...history].reverse().find((m) => m.role === 'assistant')
  if (!last || !last.content.includes(SEAN_ELLIS_MARKER)) return false
  return message.trim().length >= 1
}

/** Pure: the reply with the question at the end. */
export function withSeanEllisQuestion(message: string): string {
  const body = message.trimEnd()
  return body ? `${body}\n\n${SEAN_ELLIS_WHATSAPP}` : SEAN_ELLIS_WHATSAPP
}

// ─── Store (DB) ───────────────────────────────────────────────────

export interface SeanEllisSaved {
  channel: 'app' | 'chat' | 'whatsapp'
  answer: SeanEllisAnswer | null
  text: string
}

export interface SeanEllisStore {
  load(userId: string, now: Date): Promise<SeanEllisState | null>
  /** Stamp it as asked/closed, only the first time; false when it already was. */
  claim(userId: string, now: Date): Promise<boolean>
  /** Save the answer as an opinion tagged `sean_ellis`, once per person; false when one is already there. */
  saveAnswer(userId: string, a: SeanEllisSaved, now: Date): Promise<boolean>
}

export function createDbSeanEllisStore(db: Db = defaultDb): SeanEllisStore {
  return {
    async load(userId, now) {
      const since = new Date(now.getTime() - SEAN_ELLIS_AFTER_DAYS * DAY_MS).toISOString()
      const res = await db.execute(sql`
        SELECT u.created_at, u.sean_ellis_at,
               EXISTS (SELECT 1 FROM user_feedback f WHERE f.user_id = u.id AND f.tag = ${SEAN_ELLIS_TAG}) AS answered,
               EXISTS (SELECT 1 FROM household_members hm WHERE hm.user_id = u.id AND hm.role = 'child') AS child,
               COALESCE((
                 SELECT json_agg(json_build_object('email', u2.email, 'role', u2.role))
                   FROM household_members hm JOIN household_members hm2 ON hm2.household_id = hm.household_id
                   JOIN users u2 ON u2.id = hm2.user_id
                  WHERE hm.user_id = u.id
               ), '[]'::json) AS housemates,
               EXISTS (
                 SELECT 1 FROM menus m
                  WHERE m.user_id = u.id
                     OR m.household_id IN (SELECT hm.household_id FROM household_members hm WHERE hm.user_id = u.id)
               ) AS has_menu,
               (SELECT count(DISTINCT d) FROM (
                  SELECT (e.created_at AT TIME ZONE 'Europe/Madrid')::date AS d FROM usage_events e
                   WHERE e.user_id = u.id AND e.created_at >= ${since}::timestamptz
                  UNION
                  SELECT (w.created_at AT TIME ZONE 'Europe/Madrid')::date FROM whatsapp_messages w
                   WHERE w.user_id = u.id AND w.direction = 'in' AND w.created_at >= ${since}::timestamptz
               ) days)::int AS active_days,
               (SELECT max(wl.last_inbound_at) FROM whatsapp_links wl WHERE wl.user_id = u.id) AS last_inbound_at
          FROM users u WHERE u.id = ${userId}::uuid
      `)
      const r = (res.rows as any[])[0]
      if (!r) return null
      const housemates = typeof r.housemates === 'string' ? JSON.parse(r.housemates) : r.housemates
      return {
        createdAt: new Date(r.created_at),
        askedAt: r.sean_ellis_at ? new Date(r.sean_ellis_at) : null,
        answered: Boolean(r.answered),
        child: Boolean(r.child),
        housemates: housemates.length ? housemates : [],
        hasMenu: Boolean(r.has_menu),
        activeDays: Number(r.active_days ?? 0),
        lastInboundAt: r.last_inbound_at ? new Date(r.last_inbound_at) : null,
      }
    },
    async claim(userId, now) {
      const res = await db.execute(sql`
        UPDATE users SET sean_ellis_at = ${now.toISOString()}::timestamptz
         WHERE id = ${userId}::uuid AND sean_ellis_at IS NULL
        RETURNING id
      `)
      return res.rows.length > 0
    },
    async saveAnswer(userId, a, now) {
      const res = await db.execute(sql`
        INSERT INTO user_feedback (user_id, channel, text, tag, answer)
        SELECT ${userId}::uuid, ${a.channel}, ${a.text}, ${SEAN_ELLIS_TAG}, ${a.answer}
         WHERE NOT EXISTS (
           SELECT 1 FROM user_feedback f WHERE f.user_id = ${userId}::uuid AND f.tag = ${SEAN_ELLIS_TAG}
         )
        RETURNING id
      `)
      await db.execute(sql`
        UPDATE users SET sean_ellis_at = ${now.toISOString()}::timestamptz
         WHERE id = ${userId}::uuid AND sean_ellis_at IS NULL
      `)
      return res.rows.length > 0
    },
  }
}

// ─── Glue ─────────────────────────────────────────────────────────

export interface SeanEllisDeps extends Partial<Omit<SeanEllisRules, 'now'>> {
  store?: SeanEllisStore
  now?: Date
}

/** Where it goes for this person right now (null = not due). Never throws. */
export async function seanEllisChannelFor(userId: string, deps: SeanEllisDeps = {}): Promise<'whatsapp' | 'web' | null> {
  const now = deps.now ?? new Date()
  try {
    const state = await (deps.store ?? createDbSeanEllisStore()).load(userId, now)
    return state ? seanEllisChannel(state, { ...deps, now }) : null
  } catch (err) {
    console.warn('[sean-ellis] skipped:', (err as Error)?.message ?? err)
    return null
  }
}

/**
 * The WhatsApp reply, with the question at the end when it is due there
 * (and stamped so it never repeats). Only for WhatsApp replies that carry no
 * other offer. Never throws: on any failure the reply goes as it was.
 */
export async function maybeAppendSeanEllis(
  userId: string,
  reply: string,
  opts: { mode: string; otherOffer: boolean } & SeanEllisDeps,
): Promise<string> {
  if (opts.mode !== 'whatsapp' || opts.otherOffer || !reply.trim()) return reply
  const now = opts.now ?? new Date()
  try {
    const store = opts.store ?? createDbSeanEllisStore()
    const state = await store.load(userId, now)
    if (!state || seanEllisChannel(state, { ...opts, now }) !== 'whatsapp') return reply
    // A reply, so inside Meta's 24 h window; the stamp makes it once.
    if (!state.lastInboundAt || now.getTime() - state.lastInboundAt.getTime() >= SERVICE_WINDOW_MS) return reply
    if (!(await store.claim(userId, now))) return reply
    return withSeanEllisQuestion(reply)
  } catch (err) {
    console.warn('[sean-ellis] skipped:', (err as Error)?.message ?? err)
    return reply
  }
}

/** The WhatsApp message right after the question: saved verbatim with its option, tagged `sean_ellis`. Never throws. */
export async function recordSeanEllisReply(
  userId: string,
  message: string,
  history: readonly ChatMessage[],
  opts: { store?: SeanEllisStore; now?: Date } = {},
): Promise<boolean> {
  try {
    if (!isSeanEllisReply(message, history)) return false
    const text = message.trim().slice(0, 2000)
    const store = opts.store ?? createDbSeanEllisStore()
    return await store.saveAnswer(userId, { channel: 'whatsapp', answer: parseSeanEllisAnswer(text), text }, opts.now ?? new Date())
  } catch (err) {
    console.warn('[sean-ellis] answer not recorded:', (err as Error)?.message ?? err)
    return false
  }
}
