/**
 * PRO-1305 (Seguridad de la dieta, D-1025, Legal E-103 y E-100) · An allergy
 * said to Mimo in the chat (WhatsApp or the web chat) is never lost.
 *
 * One permission, once in the life of the account, and then Mimo notes them
 * down without asking:
 *
 * - Whoever has the web's health box (v1, v2 or v3) already has it. Whoever
 *   doesn't is asked **once** («¿me das permiso…?», version
 *   `salud-chat-v1-2026-11`) with two buttons the code reads: only the tapped
 *   button counts, tied to its question by the button id (a typed «sí» gets
 *   the buttons again). Whoever withdrew the box on the web, or said «No,
 *   gracias», is never asked again.
 * - With the permission every allergy, intolerance or food not eaten for
 *   health that the person tells Mimo goes to the household's ficha, and the
 *   code (never the model) sends «Apuntado en la ficha de tu casa: …». A
 *   religion-based diet and the physical data still go to the web.
 * - Without it (or after «no»): what was said is kept out of every menu of
 *   the household for 30 days (`said_allergies_pending`: only the menu
 *   reads it, it expires by itself, the «no» clears it, the «sí» moves it to
 *   the ficha) — the menu Mimo makes, the autopilot's and every swap.
 * - Children of the house are covered by the same permission (the question
 *   says «si eres su madre, padre o tutor»); another adult without an
 *   account, by «¿{alias} está de acuerdo…?» once per person (C.3 of E-100).
 * - From the chat: «borra lo del gluten» deletes it; «retira el permiso»
 *   asks for a confirmation button and then deletes everything, as the web.
 *
 * The proof: `health_chat_consents` (append only: every question, answer and
 * withdrawal, with the text shown, its version, the button, the WhatsApp ids
 * and the app's sha) and `health_chat_saves` (one row per item saved or
 * deleted: what, for whom, channel, the person's message id, the permission
 * that covers it and the id of the notice). Never the person's text.
 *
 * The messages: a skill never sends anything. It leaves what has to be said
 * in the turn's outbox (`withChatAllergyOutbox`, set by the WhatsApp inbound
 * and the web chat route); after the reply the channel flushes it
 * (`flushChatAllergyOutbox`) and the records get the ids of what went out.
 * Without an outbox (Telegram, a script) nothing is saved from the chat.
 *
 * The tables live outside the Drizzle migrations (created here if missing,
 * like `erasure_log`): additive only.
 *
 * Spec: specs/privacy.md → «Alergias dichas en el chat».
 */
import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { HEALTH_CONSENT_VERSION, isHealthConsentActive, isMinorAgeBand, isReligiousDiet, type PersonAgeBand } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { env } from '../config/env.js'
import { normalizeText, restrictionKey } from './dietaryRestrictions.js'
import { cleanRestrictions, healthMentionByKeywords } from './fridgeReader.js'

type Db = { execute: (q: any) => Promise<any>; transaction?: any }

/** The version of the one-time question (Legal E-103 §2.2). */
export const CHAT_HEALTH_CONSENT_VERSION = 'salud-chat-v1-2026-11'
/** How long an allergy said without the permission is kept out of the menus (E-100 §5). */
export const PENDING_DAYS = 30

export type ChatAllergyChannel = 'whatsapp' | 'web'
export type Lang = 'es' | 'en'

/** Where a skill runs → the chat this applies to (null: Telegram, the sign-up on the web, voice-less scripts). */
export function chatAllergyChannel(ctx: { channel?: string; surface?: string }): ChatAllergyChannel | null {
  if (ctx.surface === 'telegram') return null
  if (ctx.channel === 'whatsapp') return 'whatsapp'
  if (ctx.channel === 'text' || ctx.channel === 'voice') return 'web'
  return null
}

// ─── Texts (Legal E-103 §2 and E-100 C) ─────────────────────────

const web = () => env.WEB_PUBLIC_URL.replace(/\/$/, '')

/** Pure: «sin gluten, marisco y huevo». */
export function listText(items: readonly string[], lang: Lang = 'es'): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} ${lang === 'en' ? 'and' : 'y'} ${items[items.length - 1]}`
}

export const ASK_BUTTONS: Record<Lang, { yes: string; no: string }> = {
  es: { yes: 'Sí, doy mi permiso', no: 'No, gracias' },
  en: { yes: 'Yes, I consent', no: 'No, thanks' },
}
export const PERSON_ASK_BUTTONS: Record<Lang, { yes: string; no: string }> = {
  es: { yes: 'Sí, está de acuerdo', no: 'No lo guardes' },
  en: { yes: 'Yes, they agree', no: "Don't save it" },
}
export const WITHDRAW_BUTTONS: Record<Lang, { yes: string; no: string }> = {
  es: { yes: 'Sí, retíralo', no: 'No' },
  en: { yes: 'Yes, withdraw it', no: 'No' },
}

export function askText(said: string, lang: Lang, url = web()): string {
  return lang === 'en'
    ? `You told me ${said}. So I never forget it, do you give me permission to save in your household profile the allergies, intolerances and food you can't eat that you mention, now or later (yours and, if you're their parent or guardian, the children's in your home), and keep them in mind in all your menus? It's health information: I don't save it without your permission. I'll tell you every time I save something, and you can delete it whenever you like by telling me or from your profile. More info: ${url}/privacidad`
    : `Me has dicho ${said}. Para que no se me olvide nunca, ¿me das permiso para apuntar en la ficha de tu casa las alergias, intolerancias y cosas que no podéis comer que me cuentes, ahora o más adelante (tuyas y, si eres su madre, padre o tutor, de los menores de tu casa), y tenerlas presentes en todos tus menús? Es un dato de salud: sin tu permiso no lo guardo. Te avisaré siempre que apunte algo, y puedes borrarlo cuando quieras diciéndomelo o desde tu perfil. Más información: ${url}/privacidad`
}

/** C.3 of E-100: another adult without an account, once per person. */
export function personAskText(alias: string, said: string, lang: Lang, url = web()): string {
  return lang === 'en'
    ? `So I don't forget: you told me that ${alias}: ${said}. It's health information about ${alias}, so I only save it if they agree. Does ${alias} agree that Mimoia saves it in your household profile and keeps it in mind in all your menus? You can delete it any time: just tell me or remove it from your profile. More info: ${url}/privacidad`
    : `Para no olvidarlo: me has dicho que ${alias}: ${said}. Es un dato de salud de ${alias}, así que solo lo guardo si está de acuerdo. ¿Está ${alias} de acuerdo en que Mimoia lo apunte en la ficha de tu casa y lo tenga presente en todos vuestros menús? Podéis borrarlo cuando queráis: dímelo o quítalo desde tu perfil. Más información: ${url}/privacidad`
}

/** §2.3: what the code says every time it saves. */
export function savedNotice(items: readonly string[], lang: Lang, opts: { alias?: string | null; firstWebLine?: boolean } = {}): string {
  const list = listText(items, lang)
  const main = opts.alias
    ? lang === 'en'
      ? `Saved for ${opts.alias}: ${list}. It won't appear in your menus. If you'd like me to delete it, just tell me.`
      : `Apuntado para ${opts.alias}: ${list}. No saldrá en vuestros menús. Si quieres que lo borre, dímelo.`
    : lang === 'en'
      ? `Saved to your household profile: ${list}. It won't appear in your menus. If you'd like me to delete it, just tell me.`
      : `Apuntado en la ficha de tu casa: ${list}. No saldrá en tus menús. Si quieres que lo borre, dímelo.`
  if (!opts.firstWebLine) return main
  return `${main} ${lang === 'en' ? "I'm saving it because you gave permission for your health data in your profile; you can withdraw it whenever you like." : 'Lo guardo porque diste tu permiso para tus datos de salud en tu perfil; puedes retirarlo cuando quieras.'}`
}

/** C.7. */
export function deletedNotice(items: readonly string[], lang: Lang): string {
  const list = listText(items, lang)
  return lang === 'en'
    ? `Deleted: ${list} is no longer in your profile. Heads up: from now on it may appear in your menus again.`
    : `Borrado: ${list} ya no está en tu ficha. Ojo: desde ahora puede volver a salir en tus menús.`
}

/** C.5. */
export function declinedReply(lang: Lang): string {
  return lang === 'en'
    ? "OK, I won't save it. This menu already respects it, but the following ones won't know: if you'd like me to keep it in mind, tell me again or add it to your profile whenever you like."
    : 'Vale, no lo guardo. Este menú ya lo respeta, pero los próximos no lo sabrán: si quieres que lo tenga presente, vuelve a decírmelo o guárdalo en tu perfil cuando quieras.'
}

/** After a «Sí, está de acuerdo»/«No lo guardes» for another adult, the «no». */
export function personDeclinedReply(alias: string, lang: Lang): string {
  return lang === 'en' ? `OK, I won't save it for ${alias}.` : `Vale, no lo guardo para ${alias}.`
}

/** C.8. */
export function tapButtonReply(lang: Lang): string {
  return lang === 'en'
    ? 'To save it I need you to tap one of the two buttons, so there is a record of your permission.'
    : 'Para guardarlo necesito que pulses uno de los dos botones: así queda constancia de tu permiso.'
}

/** C.6: the one reminder. */
export function reminderText(said: string, until: Date, lang: Lang): string {
  const date = until.toLocaleDateString(lang === 'en' ? 'en-GB' : 'es-ES', { day: 'numeric', month: 'long', timeZone: 'Europe/Madrid' })
  return lang === 'en'
    ? `I'm still keeping ${said} out of your menus, but it isn't saved and I'll stop on ${date}. Shall I save it?`
    : `Sigo teniendo en cuenta ${said} en vuestros menús, pero no está guardado y dejaré de hacerlo el ${date}. ¿Lo guardo?`
}

/**
 * §2.4: after «no», the next allergy said, once. The question is asked once
 * in the account's life, so «dímelo» would promise what the chat can't do:
 * the way left is the box of the profile.
 */
export function declinedHint(lang: Lang, url = web()): string {
  return lang === 'en'
    ? `If you ever want me to save it, tick it in your profile: ${url}/profile/casa/alergias`
    : `Si algún día quieres que lo apunte, márcalo en tu perfil: ${url}/profile/casa/alergias`
}

/** §2.4: withdrawing the whole permission. */
export function withdrawAskText(lang: Lang): string {
  return lang === 'en'
    ? "If I withdraw the permission, I'll delete all your allergies, intolerances and health data from your profile, and they may appear in your menus again. Shall I withdraw it?"
    : 'Si retiro el permiso, borraré de tu ficha todas tus alergias, intolerancias y datos de salud, y podrán volver a salir en tus menús. ¿Lo retiro?'
}
export function withdrawnReply(lang: Lang): string {
  return lang === 'en'
    ? "Done: I've withdrawn your permission and deleted your allergies, intolerances and health data from your profile. Heads up: they may show up in your menus again from now on."
    : 'Hecho: he retirado tu permiso y he borrado de tu ficha tus alergias, intolerancias y datos de salud. Ojo: desde ahora pueden volver a salir en tus menús.'
}
export function withdrawKeptReply(lang: Lang): string {
  return lang === 'en' ? 'OK, I keep it: everything stays as it was.' : 'Vale, no lo retiro: sigue todo como estaba.'
}
/** A button of a question already answered (or not this account's). */
export function staleButtonReply(lang: Lang): string {
  return lang === 'en' ? 'That question is already answered: nothing has changed.' : 'Esa pregunta ya está contestada: no he cambiado nada.'
}

// ─── Button ids (the code reads them, never the model) ───────────

export type ConsentButton = { kind: 'ask' | 'person' | 'withdraw'; answer: 'yes' | 'no'; questionId: string }

const BUTTON_PREFIX = { ask: 'hc', person: 'hcp', withdraw: 'hcw' } as const
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/

export function consentButtonId(kind: ConsentButton['kind'], answer: 'yes' | 'no', questionId: string): string {
  return `${BUTTON_PREFIX[kind]}:${answer}:${questionId}`
}

/** Pure: a tapped button id → which question it answers; anything else → null. */
export function parseConsentButton(replyId: string | null | undefined): ConsentButton | null {
  const m = /^(hc|hcp|hcw):(yes|no):(.+)$/.exec(replyId ?? '')
  if (!m || !UUID.test(m[3])) return null
  const kind = m[1] === 'hc' ? 'ask' : m[1] === 'hcp' ? 'person' : 'withdraw'
  return { kind, answer: m[2] as 'yes' | 'no', questionId: m[3] }
}

/** Pure: a typed «sí» (or «no») instead of a tap: it gets the buttons again (C.8). */
export function isTypedAnswer(text: string | null | undefined): boolean {
  const t = normalizeText(text ?? '').replace(/[.!¡¿?,]+/g, ' ').replace(/\s+/g, ' ').trim()
  return /^(si+|sip|vale|ok|okay|claro|venga|yes|de acuerdo|adelante|por supuesto|no|nop|no gracias|si (claro|vale|guardalo|doy mi permiso|por favor)|guardalo|doy mi permiso)$/.test(t)
}

// ─── What was said, read by the code ─────────────────────────────

const STRONG = /\b(alergi\w*|alergic\w*|intoleran\w*|celiac\w*|celiaqu\w*|anafila\w*)/

/**
 * Pure: the allergens named in one message, without the model. `strong`
 * when a clause says allergy, intolerance or celiac; the rest («no como
 * marisco») is doubtful: kept out of the menus, never asked about by the code.
 */
export function allergiesInMessage(text: string): { strong: string[]; doubtful: string[] } {
  const strong: string[] = []
  const doubtful: string[] = []
  for (const clause of text.split(/[.;()\n¡!¿?]/)) {
    const hit = healthMentionByKeywords(clause)
    if (!hit) continue
    const into = STRONG.test(normalizeText(clause)) ? strong : doubtful
    for (const r of hit.restrictions) if (!into.includes(r)) into.push(r)
  }
  return { strong, doubtful: doubtful.filter((r) => !strong.includes(r)) }
}

/** Pure: what can be saved from the chat (no religious diet: that one goes to the web). */
export function chatSavable(raw: unknown): string[] {
  return cleanRestrictions(raw).filter((r) => !isReligiousDiet(r))
}

// ─── Tables ──────────────────────────────────────────────────────

const CREATE = [
  sql`CREATE TABLE IF NOT EXISTS health_chat_consents (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    person_id uuid,
    event text NOT NULL,
    question_id uuid,
    scope text,
    restrictions jsonb NOT NULL DEFAULT '[]'::jsonb,
    text_shown text,
    lang text,
    version text,
    channel text NOT NULL,
    wamid text,
    button_id text,
    button_title text,
    app_sha text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE INDEX IF NOT EXISTS health_chat_consents_user_idx ON health_chat_consents (user_id, created_at)`,
  // One question in the life of the account (and one per other adult).
  sql`CREATE UNIQUE INDEX IF NOT EXISTS health_chat_consents_one_ask ON health_chat_consents (user_id, (coalesce(person_id::text, ''))) WHERE event = 'asked'`,
  // One answer per question.
  sql`CREATE UNIQUE INDEX IF NOT EXISTS health_chat_consents_one_answer ON health_chat_consents (question_id) WHERE event IN ('granted', 'declined', 'withdrawn', 'withdraw_kept')`,
  sql`CREATE TABLE IF NOT EXISTS health_chat_saves (
    id uuid PRIMARY KEY,
    user_id uuid NOT NULL,
    person_id uuid,
    action text NOT NULL,
    restrictions jsonb NOT NULL,
    channel text NOT NULL,
    message_id text,
    consent_ref text,
    notice_id text,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  sql`CREATE INDEX IF NOT EXISTS health_chat_saves_user_idx ON health_chat_saves (user_id, created_at)`,
  sql`CREATE TABLE IF NOT EXISTS said_allergies_pending (
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    person_key text NOT NULL DEFAULT '',
    restriction text NOT NULL,
    said_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (user_id, person_key, restriction)
  )`,
]

let ensured: Promise<unknown> | null = null

/** Creates the tables if missing (once per process on the app's own database). */
export async function ensureChatAllergyTables(db: Db = defaultDb): Promise<void> {
  const run = async () => {
    for (const q of CREATE) await db.execute(q)
  }
  if (db !== defaultDb) return run()
  ensured ??= run().catch((err) => {
    ensured = null
    throw err
  })
  await ensured
}

const rowsOf = (res: any): any[] => res?.rows ?? res ?? []

function appSha(): string | null {
  return process.env.RAILWAY_GIT_COMMIT_SHA || null
}

// ─── The permission ──────────────────────────────────────────────

export interface ConsentEvent {
  id: string
  event: string
  personId: string | null
  questionId: string | null
  createdAt: Date
}

export type ChatPermission =
  | { kind: 'web'; version: string | null; consentRef: string }
  | { kind: 'chat'; consentRef: string }
  /** Asked, no answer yet: never asked again; one reminder at most. */
  | { kind: 'asked'; questionId: string; askedAt: Date; reminded: boolean }
  /** «No, gracias», a withdrawal (chat or web): never asked again. */
  | { kind: 'declined' }
  | { kind: 'never' }

/**
 * Pure: the account's permission for the allergies said in the chat, from
 * the web box and the chat's events (the speaker's own, not another adult's).
 */
export function chatPermissionFrom(
  web: { consentAt: Date | string | null; version: string | null; withdrawnAt: Date | string | null },
  events: readonly ConsentEvent[],
): ChatPermission {
  if (isHealthConsentActive(web.consentAt, web.withdrawnAt)) {
    return { kind: 'web', version: web.version, consentRef: web.version ?? 'web' }
  }
  const own = events.filter((e) => !e.personId).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
  const last = (kind: string) => [...own].reverse().find((e) => e.event === kind) ?? null
  const grant = last('granted')
  const webWithdrawn = web.withdrawnAt ? new Date(web.withdrawnAt).getTime() : 0
  const chatWithdrawn = last('withdrawn')?.createdAt.getTime() ?? 0
  if (grant && grant.createdAt.getTime() > Math.max(webWithdrawn, chatWithdrawn)) return { kind: 'chat', consentRef: grant.id }
  if (webWithdrawn || chatWithdrawn || last('declined')) return { kind: 'declined' }
  const asked = last('asked')
  if (asked) return { kind: 'asked', questionId: asked.id, askedAt: asked.createdAt, reminded: own.some((e) => e.event === 'reminded' && e.questionId === asked.id) }
  return { kind: 'never' }
}

async function loadEvents(userId: string, db: Db): Promise<ConsentEvent[]> {
  await ensureChatAllergyTables(db)
  const res = await db.execute(sql`SELECT id, event, person_id, question_id, created_at FROM health_chat_consents WHERE user_id = ${userId} ORDER BY created_at`)
  return rowsOf(res).map((r) => ({ id: r.id, event: r.event, personId: r.person_id ?? null, questionId: r.question_id ?? null, createdAt: new Date(r.created_at) }))
}

export async function loadChatPermission(userId: string, db: Db = defaultDb): Promise<ChatPermission> {
  const res = await db.execute(
    sql`SELECT health_consent_at, health_consent_version, health_consent_withdrawn_at FROM users WHERE id = ${userId} LIMIT 1`,
  )
  const [u] = rowsOf(res)
  const webState = { consentAt: u?.health_consent_at ?? null, version: u?.health_consent_version ?? null, withdrawnAt: u?.health_consent_withdrawn_at ?? null }
  return chatPermissionFrom(webState, await loadEvents(userId, db))
}

/** The chat permission is in force (for the web: `getHealthConsent` doesn't ask its one-time screen then). */
export async function hasChatPermission(userId: string, db: Db = defaultDb): Promise<boolean> {
  const p = await loadChatPermission(userId, db).catch(() => null)
  return p?.kind === 'chat'
}

// ─── The 30 days ─────────────────────────────────────────────────

/** Keeps `items` out of the household's menus for 30 days from now (said again → 30 more). */
export async function addPending(userId: string, items: readonly string[], opts: { db?: Db; now?: Date; personId?: string | null } = {}): Promise<void> {
  if (items.length === 0) return
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const expires = new Date(now.getTime() + PENDING_DAYS * 86_400_000)
  await ensureChatAllergyTables(db)
  for (const r of items) {
    await db.execute(sql`INSERT INTO said_allergies_pending (user_id, person_key, restriction, said_at, expires_at)
      VALUES (${userId}, ${opts.personId ?? ''}, ${r}, ${now.toISOString()}, ${expires.toISOString()})
      ON CONFLICT (user_id, person_key, restriction) DO UPDATE SET said_at = EXCLUDED.said_at, expires_at = EXCLUDED.expires_at`)
  }
}

export interface PendingRow {
  personId: string | null
  restriction: string
  expiresAt: Date
}

export async function loadPending(userId: string, opts: { db?: Db; now?: Date } = {}): Promise<PendingRow[]> {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  await ensureChatAllergyTables(db)
  const res = await db.execute(sql`SELECT person_key, restriction, expires_at FROM said_allergies_pending WHERE user_id = ${userId} AND expires_at > ${now.toISOString()} ORDER BY said_at`)
  return rowsOf(res).map((r) => ({ personId: r.person_key || null, restriction: r.restriction, expiresAt: new Date(r.expires_at) }))
}

/** Clears what was pending: all of it (no `items`), or those (saved now, or answered). */
export async function clearPending(userId: string, opts: { db?: Db; items?: readonly string[]; personId?: string | null } = {}): Promise<void> {
  const db = opts.db ?? defaultDb
  await ensureChatAllergyTables(db)
  if (!opts.items) {
    await db.execute(sql`DELETE FROM said_allergies_pending WHERE user_id = ${userId}`)
    return
  }
  const keys = new Set(opts.items.map(restrictionKey))
  const pending = rowsOf(await db.execute(sql`SELECT person_key, restriction FROM said_allergies_pending WHERE user_id = ${userId}`))
  for (const p of pending) {
    if (opts.personId !== undefined && (p.person_key || null) !== (opts.personId ?? null)) continue
    if (!keys.has(restrictionKey(p.restriction))) continue
    await db.execute(sql`DELETE FROM said_allergies_pending WHERE user_id = ${userId} AND person_key = ${p.person_key} AND restriction = ${p.restriction}`)
  }
}

/**
 * What the household's members said and nobody saved, still within their 30
 * days: the menu pickers add it to the saved restrictions
 * (`withHouseholdRestrictions`). Nothing else reads it.
 */
export async function loadHouseholdPending(memberIds: readonly string[], opts: { db?: Db; now?: Date } = {}): Promise<string[]> {
  if (memberIds.length === 0) return []
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  await ensureChatAllergyTables(db)
  const ids = sql.join(memberIds.map((id) => sql`${id}`), sql`, `)
  const res = await db.execute(sql`SELECT DISTINCT restriction FROM said_allergies_pending WHERE user_id IN (${ids}) AND expires_at > ${now.toISOString()}`)
  return rowsOf(res).map((r) => r.restriction as string)
}

// ─── The turn's outbox ───────────────────────────────────────────

export interface AskItem {
  restriction: string
  personId: string | null
  alias: string | null
}

export type OutboxItem =
  | { type: 'saved'; personId: string | null; alias: string | null; items: string[]; consentRef: string; firstWebLine: boolean }
  | { type: 'deleted'; personId: string | null; alias: string | null; items: string[] }
  | { type: 'ask'; items: AskItem[] }
  | { type: 'ask_person'; personId: string; alias: string; items: string[] }
  | { type: 'hint' }
  | { type: 'withdraw_ask' }

export interface ChatAllergyOutbox {
  userId: string
  channel: ChatAllergyChannel
  /** The person's message this turn answers (its WhatsApp id, or the web turn's id). */
  messageId: string | null
  /** The WhatsApp sign-up is going on: nothing is asked now (the follow-up asks, ~10 min after the menu). */
  quiet: boolean
  items: OutboxItem[]
}

const outboxStore = new AsyncLocalStorage<ChatAllergyOutbox>()

/** Runs a chat turn with an outbox for what the code has to say about allergies. */
export function withChatAllergyOutbox<T>(
  init: { userId: string; channel: ChatAllergyChannel; messageId?: string | null; quiet?: boolean },
  fn: () => Promise<T>,
): { outbox: ChatAllergyOutbox; run: Promise<T> } {
  const outbox: ChatAllergyOutbox = { userId: init.userId, channel: init.channel, messageId: init.messageId ?? null, quiet: init.quiet === true, items: [] }
  return { outbox, run: outboxStore.run(outbox, fn) }
}

/** The outbox of the turn running now, for this user (null outside one: nothing is saved from the chat). */
export function currentOutbox(userId: string): ChatAllergyOutbox | null {
  const o = outboxStore.getStore()
  return o && o.userId === userId ? o : null
}

function pushAsk(outbox: ChatAllergyOutbox, items: AskItem[]) {
  const ask = outbox.items.find((i): i is Extract<OutboxItem, { type: 'ask' }> => i.type === 'ask')
  if (!ask) {
    outbox.items.push({ type: 'ask', items: [...items] })
    return
  }
  for (const it of items) {
    if (!ask.items.some((x) => x.personId === it.personId && restrictionKey(x.restriction) === restrictionKey(it.restriction))) ask.items.push(it)
  }
}

// ─── Noting what was said ────────────────────────────────────────

export interface SaidSubject {
  /** null = the person who writes. */
  personId: string | null
  alias: string | null
  ageBand?: PersonAgeBand | string | null
}

/**
 * Pure: a person without an account who agrees for themselves (C.3): an
 * adult, and from 13 to 17 (E-100 §4: from 14 they consent themselves; the
 * band starts at 13, so the safer side).
 */
export function isAdultForConsent(ageBand: string | null | undefined): boolean {
  return ageBand === 'adulto' || ageBand === '13-17' || (!!ageBand && !isMinorAgeBand(ageBand as PersonAgeBand))
}

export type NoteResult =
  | { kind: 'saved'; items: string[]; already: string[] }
  | { kind: 'asking'; items: string[] }
  | { kind: 'pending'; items: string[]; reason: 'declined' | 'asked' | 'quiet' | 'doubtful' }
  | { kind: 'nothing' }

export interface NoteDeps {
  db?: Db
  now?: Date
  /** The restrictions saved for the subject now (to tell what is new). */
  saved: () => Promise<string[]>
  /** Writes the full list for the subject (the permission is checked here). */
  write: (next: string[]) => Promise<void>
}

/**
 * An allergy said to Mimo (by the model's tool, or by the person's own words
 * read by the code). With the permission it is saved and the notice queued;
 * without, it is kept out of the menus for 30 days and, the first time in
 * the account's life, the question goes; after a «no», a hint once.
 * `doubtful`: never saved nor asked about by the code («no como marisco»).
 */
export async function noteSaidAllergies(
  userId: string,
  raw: unknown,
  subject: SaidSubject,
  deps: NoteDeps,
  opts: { doubtful?: boolean } = {},
): Promise<NoteResult> {
  const outbox = currentOutbox(userId)
  const db = deps.db ?? defaultDb
  const now = deps.now ?? new Date()
  const said = chatSavable(raw)
  if (!outbox || said.length === 0) return { kind: 'nothing' }
  const saved = await deps.saved().catch(() => [] as string[])
  const savedKeys = new Set(saved.map(restrictionKey))
  const fresh = said.filter((r) => !savedKeys.has(restrictionKey(r)))
  const already = said.filter((r) => savedKeys.has(restrictionKey(r)))
  if (fresh.length === 0) return { kind: 'saved', items: [], already }

  const isOtherAdult = !!subject.personId && isAdultForConsent(subject.ageBand)
  if (isOtherAdult) {
    // Another adult without an account: their own «está de acuerdo» (C.3 of E-100), once per person.
    const theirs = (await loadEvents(userId, db)).filter((e) => e.personId === subject.personId)
    const grant = theirs.find((e) => e.event === 'granted')
    if (grant && !opts.doubtful) {
      await deps.write([...saved, ...fresh])
      await clearPending(userId, { db, items: fresh, personId: subject.personId })
      outbox.items.push({ type: 'saved', personId: subject.personId, alias: subject.alias, items: fresh, consentRef: grant.id, firstWebLine: false })
      return { kind: 'saved', items: fresh, already }
    }
    await addPending(userId, fresh, { db, now, personId: subject.personId })
    if (opts.doubtful) return { kind: 'pending', items: fresh, reason: 'doubtful' }
    if (theirs.some((e) => e.event === 'asked')) return { kind: 'pending', items: fresh, reason: theirs.some((e) => e.event === 'declined') ? 'declined' : 'asked' }
    if (outbox.quiet) return { kind: 'pending', items: fresh, reason: 'quiet' }
    outbox.items.push({ type: 'ask_person', personId: subject.personId!, alias: subject.alias ?? '', items: fresh })
    return { kind: 'asking', items: fresh }
  }
  const permission = await loadChatPermission(userId, db)
  const covered = permission.kind === 'web' || permission.kind === 'chat' ? permission.consentRef : null
  if (covered && !opts.doubtful) {
    await deps.write([...saved, ...fresh])
    await clearPending(userId, { db, items: fresh, personId: subject.personId })
    // §2.3: the first time, to whoever came from the box's v1 or v2 (v3 already says it).
    const firstWebLine = permission.kind === 'web' && permission.version !== HEALTH_CONSENT_VERSION && !(await hasSaves(userId, db)) && !outbox.items.some((i) => i.type === 'saved')
    outbox.items.push({ type: 'saved', personId: subject.personId, alias: subject.alias, items: fresh, consentRef: covered, firstWebLine })
    return { kind: 'saved', items: fresh, already }
  }
  await addPending(userId, fresh, { db, now, personId: subject.personId })
  if (opts.doubtful) return { kind: 'pending', items: fresh, reason: 'doubtful' }
  if (permission.kind === 'declined') {
    if (!(await hintSent(userId, db)) && !outbox.items.some((i) => i.type === 'hint')) outbox.items.push({ type: 'hint' })
    return { kind: 'pending', items: fresh, reason: 'declined' }
  }
  if (permission.kind === 'asked') return { kind: 'pending', items: fresh, reason: 'asked' }
  if (outbox.quiet) return { kind: 'pending', items: fresh, reason: 'quiet' }
  pushAsk(outbox, fresh.map((r) => ({ restriction: r, personId: subject.personId, alias: subject.alias })))
  return { kind: 'asking', items: fresh }
}

async function hasSaves(userId: string, db: Db): Promise<boolean> {
  await ensureChatAllergyTables(db)
  return rowsOf(await db.execute(sql`SELECT 1 FROM health_chat_saves WHERE user_id = ${userId} AND action = 'saved' LIMIT 1`)).length > 0
}

async function hintSent(userId: string, db: Db): Promise<boolean> {
  await ensureChatAllergyTables(db)
  return rowsOf(await db.execute(sql`SELECT 1 FROM health_chat_consents WHERE user_id = ${userId} AND event = 'hint' LIMIT 1`)).length > 0
}

/** «Borra lo del gluten»: queues C.7 (the deletion itself is the caller's). */
export function noteDeleted(userId: string, items: readonly string[], subject: { personId: string | null; alias: string | null }): boolean {
  const outbox = currentOutbox(userId)
  if (!outbox || items.length === 0) return false
  outbox.items.push({ type: 'deleted', personId: subject.personId, alias: subject.alias, items: [...items] })
  return true
}

/** «Retira el permiso»: queues the confirmation buttons. */
export function noteWithdrawAsk(userId: string): boolean {
  const outbox = currentOutbox(userId)
  if (!outbox) return false
  if (!outbox.items.some((i) => i.type === 'withdraw_ask')) outbox.items.push({ type: 'withdraw_ask' })
  return true
}

/** What the tool tells the model (the code already says the rest). */
export function noteSummary(r: NoteResult): string {
  switch (r.kind) {
    case 'saved':
      return r.items.length
        ? `Guardado en la ficha: ${r.items.join(', ')}${r.already.length ? ` (ya estaba: ${r.already.join(', ')})` : ''}. El sistema le manda ahora el aviso «Apuntado…» en un mensaje aparte: no lo repitas ni pidas permiso.`
        : `Ya estaba guardado: ${r.already.join(', ')}. No he cambiado nada.`
    case 'asking':
      return `No guardado todavia (es un dato de salud y no ha dado su permiso): el sistema le hace ahora, en un mensaje aparte con dos botones, la pregunta del permiso. No le preguntes tu ni le digas que lo tendras en cuenta siempre. Mientras, sus menus de los proximos 30 dias no llevan ${r.items.join(', ')}.`
    case 'pending':
      return r.reason === 'doubtful'
        ? `No guardado: no esta claro que sea por salud. Sus menus de los proximos 30 dias no llevan ${r.items.join(', ')}. Si importa, preguntale si es una alergia o intolerancia.`
        : r.reason === 'quiet'
          ? `No guardado todavia: el sistema le pide el permiso al terminar el alta. Su primer menu y los de los proximos 30 dias no llevan ${r.items.join(', ')}.`
          : `No guardado (${r.reason === 'declined' ? 'no dio su permiso para guardar alergias' : 'no ha contestado aun a la pregunta del permiso'}): sus menus de los proximos 30 dias no llevan ${r.items.join(', ')}, pero no esta en su ficha. Diselo asi, sin prometer que lo recordaras siempre.`
    default:
      return 'No he guardado nada.'
  }
}

// ─── Flushing the outbox (after the reply) ───────────────────────

export interface FlushMessage {
  kind: string
  text: string
  buttons?: { id: string; title: string }[]
}

/**
 * Sends what the turn left in the outbox and writes the records with the ids
 * of what went out. `send` returns the message's id (the wamid on WhatsApp;
 * on the web, the id the client shows it with) or null when it failed.
 */
export async function flushChatAllergyOutbox(
  outbox: ChatAllergyOutbox,
  opts: { lang: Lang; send: (m: FlushMessage) => Promise<string | null>; db?: Db; now?: Date },
): Promise<void> {
  const db = opts.db ?? defaultDb
  const { lang } = opts
  if (outbox.items.length === 0) return
  await ensureChatAllergyTables(db)
  for (const item of mergeSaved(outbox.items)) {
    try {
      if (item.type === 'saved') {
        const noticeId = await opts.send({ kind: 'health_saved', text: savedNotice(item.items, lang, { alias: item.alias, firstWebLine: item.firstWebLine }) })
        await insertSave(db, { userId: outbox.userId, personId: item.personId, action: 'saved', items: item.items, channel: outbox.channel, messageId: outbox.messageId, consentRef: item.consentRef, noticeId })
      } else if (item.type === 'deleted') {
        const noticeId = await opts.send({ kind: 'health_deleted', text: deletedNotice(item.items, lang) })
        await insertSave(db, { userId: outbox.userId, personId: item.personId, action: 'deleted', items: item.items, channel: outbox.channel, messageId: outbox.messageId, consentRef: null, noticeId })
      } else if (item.type === 'ask') {
        await sendAsk(db, outbox, item.items, lang, opts.send)
      } else if (item.type === 'ask_person') {
        await sendPersonAsk(db, outbox, item, lang, opts.send)
      } else if (item.type === 'hint') {
        const id = await opts.send({ kind: 'health_hint', text: declinedHint(lang) })
        await insertEvent(db, { userId: outbox.userId, event: 'hint', channel: outbox.channel, wamid: id, lang })
      } else if (item.type === 'withdraw_ask') {
        const questionId = randomUUID()
        const text = withdrawAskText(lang)
        const b = WITHDRAW_BUTTONS[lang]
        const id = await opts.send({
          kind: 'health_withdraw_ask',
          text,
          buttons: [
            { id: consentButtonId('withdraw', 'yes', questionId), title: b.yes },
            { id: consentButtonId('withdraw', 'no', questionId), title: b.no },
          ],
        })
        await insertEvent(db, { id: questionId, userId: outbox.userId, event: 'withdraw_asked', channel: outbox.channel, wamid: id, textShown: text, lang })
      }
    } catch (err) {
      console.warn('[chat-allergies] flush item failed:', item.type, (err as Error)?.message ?? err)
    }
  }
  outbox.items = []
}

/** Pure: one notice per person saved for in the turn. */
export function mergeSaved(items: readonly OutboxItem[]): OutboxItem[] {
  const out: OutboxItem[] = []
  for (const it of items) {
    if (it.type !== 'saved') {
      out.push(it)
      continue
    }
    const same = out.find((o): o is Extract<OutboxItem, { type: 'saved' }> => o.type === 'saved' && o.personId === it.personId && o.consentRef === it.consentRef)
    if (!same) out.push({ ...it, items: [...it.items] })
    else {
      for (const r of it.items) if (!same.items.some((x) => restrictionKey(x) === restrictionKey(r))) same.items.push(r)
      same.firstWebLine ||= it.firstWebLine
    }
  }
  return out
}

/** The «Me has dicho X, Y y, de la peque, Z» part of the question. */
export function saidOf(items: readonly AskItem[], lang: Lang): string {
  const own = items.filter((i) => !i.personId || !i.alias).map((i) => i.restriction)
  const byPerson = new Map<string, string[]>()
  for (const i of items) if (i.personId && i.alias) byPerson.set(i.alias ?? '', [...(byPerson.get(i.alias ?? '') ?? []), i.restriction])
  const parts = own.length ? [listText(own, lang)] : []
  for (const [alias, rs] of byPerson) parts.push(lang === 'en' ? `for ${alias}, ${listText(rs, lang)}` : `de ${alias}, ${listText(rs, lang)}`)
  return parts.join('; ')
}

async function sendAsk(db: Db, outbox: ChatAllergyOutbox, items: AskItem[], lang: Lang, send: (m: FlushMessage) => Promise<string | null>) {
  // Asked already (another turn, or the sign-up follow-up): never twice.
  if ((await loadChatPermission(outbox.userId, db)).kind !== 'never') return
  const questionId = randomUUID()
  const text = askText(saidOf(items, lang), lang)
  const inserted = await insertEvent(db, {
    id: questionId, userId: outbox.userId, event: 'asked', scope: 'self_and_minors', channel: outbox.channel,
    restrictions: items, textShown: text, lang, version: CHAT_HEALTH_CONSENT_VERSION,
  })
  if (!inserted) return
  const b = ASK_BUTTONS[lang]
  const id = await send({
    kind: 'health_ask',
    text,
    buttons: [
      { id: consentButtonId('ask', 'yes', questionId), title: b.yes },
      { id: consentButtonId('ask', 'no', questionId), title: b.no },
    ],
  })
  if (id) await db.execute(sql`UPDATE health_chat_consents SET wamid = ${id} WHERE id = ${questionId} AND wamid IS NULL`)
}

async function sendPersonAsk(db: Db, outbox: ChatAllergyOutbox, item: Extract<OutboxItem, { type: 'ask_person' }>, lang: Lang, send: (m: FlushMessage) => Promise<string | null>) {
  const questionId = randomUUID()
  const text = personAskText(item.alias, listText(item.items, lang), lang)
  const inserted = await insertEvent(db, {
    id: questionId, userId: outbox.userId, personId: item.personId, event: 'asked', scope: 'adult_agrees', channel: outbox.channel,
    restrictions: item.items.map((r) => ({ restriction: r, personId: item.personId, alias: item.alias })), textShown: text, lang, version: CHAT_HEALTH_CONSENT_VERSION,
  })
  if (!inserted) return
  const b = PERSON_ASK_BUTTONS[lang]
  const id = await send({
    kind: 'health_ask',
    text,
    buttons: [
      { id: consentButtonId('person', 'yes', questionId), title: b.yes },
      { id: consentButtonId('person', 'no', questionId), title: b.no },
    ],
  })
  if (id) await db.execute(sql`UPDATE health_chat_consents SET wamid = ${id} WHERE id = ${questionId} AND wamid IS NULL`)
}

interface EventRow {
  id?: string
  userId: string
  personId?: string | null
  event: string
  questionId?: string | null
  scope?: string | null
  restrictions?: unknown
  textShown?: string | null
  lang?: string | null
  version?: string | null
  channel: string
  wamid?: string | null
  buttonId?: string | null
  buttonTitle?: string | null
}

/** Appends one event; false when the unique indexes say it was there already. */
async function insertEvent(db: Db, e: EventRow): Promise<boolean> {
  const res = await db.execute(sql`INSERT INTO health_chat_consents
    (id, user_id, person_id, event, question_id, scope, restrictions, text_shown, lang, version, channel, wamid, button_id, button_title, app_sha)
    VALUES (${e.id ?? randomUUID()}, ${e.userId}, ${e.personId ?? null}, ${e.event}, ${e.questionId ?? null}, ${e.scope ?? null},
      ${JSON.stringify(e.restrictions ?? [])}::jsonb, ${e.textShown ?? null}, ${e.lang ?? null}, ${e.version ?? null}, ${e.channel},
      ${e.wamid ?? null}, ${e.buttonId ?? null}, ${e.buttonTitle ?? null}, ${appSha()})
    ON CONFLICT DO NOTHING RETURNING id`)
  return rowsOf(res).length > 0
}

async function insertSave(db: Db, s: { userId: string; personId: string | null; action: 'saved' | 'deleted'; items: string[]; channel: string; messageId: string | null; consentRef: string | null; noticeId: string | null }) {
  await db.execute(sql`INSERT INTO health_chat_saves (id, user_id, person_id, action, restrictions, channel, message_id, consent_ref, notice_id)
    VALUES (${randomUUID()}, ${s.userId}, ${s.personId}, ${s.action}, ${JSON.stringify(s.items)}::jsonb, ${s.channel}, ${s.messageId}, ${s.consentRef}, ${s.noticeId})`)
}

// ─── Answering the buttons ───────────────────────────────────────

export interface AnswerDeps {
  db?: Db
  /** Sends one message (fixed text, no model); returns its id or null. */
  send: (m: FlushMessage) => Promise<string | null>
  /** Saves `items` for the subject with the permission just given (returns what was new). */
  save: (items: string[], subject: SaidSubject) => Promise<string[]>
  /** Withdraws the whole permission and deletes the health data (as the web). */
  withdraw: (userId: string) => Promise<void>
}

export interface ButtonAnswer {
  /** For the inbound's trace. */
  tools: string[]
}

/**
 * A tapped button of the permission question, the other adult's or the
 * withdrawal. Only the account the question went to can answer it, once.
 */
export async function answerConsentButton(
  userId: string,
  button: ConsentButton,
  tap: { channel: ChatAllergyChannel; wamid: string | null; title: string | null; lang: Lang },
  deps: AnswerDeps,
): Promise<ButtonAnswer> {
  const db = deps.db ?? defaultDb
  await ensureChatAllergyTables(db)
  const [q] = rowsOf(await db.execute(sql`SELECT id, event, person_id, restrictions FROM health_chat_consents WHERE id = ${button.questionId} AND user_id = ${userId} LIMIT 1`))
  const expected = button.kind === 'withdraw' ? 'withdraw_asked' : 'asked'
  const reply = async (kind: string, text: string, tools: string[] = []) => {
    await deps.send({ kind, text })
    return { tools }
  }
  if (!q || q.event !== expected) return reply('system', staleButtonReply(tap.lang))
  const event =
    button.kind === 'withdraw' ? (button.answer === 'yes' ? 'withdrawn' : 'withdraw_kept') : button.answer === 'yes' ? 'granted' : 'declined'
  const b = button.kind === 'withdraw' ? WITHDRAW_BUTTONS[tap.lang] : button.kind === 'person' ? PERSON_ASK_BUTTONS[tap.lang] : ASK_BUTTONS[tap.lang]
  const recorded = await insertEvent(db, {
    userId, personId: q.person_id ?? null, event, questionId: q.id, channel: tap.channel, wamid: tap.wamid,
    buttonId: consentButtonId(button.kind, button.answer, q.id), buttonTitle: tap.title ?? (button.answer === 'yes' ? b.yes : b.no),
    scope: button.kind === 'person' ? 'adult_agrees' : button.kind === 'ask' ? 'self_and_minors' : null,
  })
  if (!recorded) return reply('system', staleButtonReply(tap.lang))

  if (button.kind === 'withdraw') {
    if (button.answer === 'no') return reply('system', withdrawKeptReply(tap.lang))
    await deps.withdraw(userId)
    await clearPending(userId, { db })
    return reply('health_withdrawn', withdrawnReply(tap.lang), ['withdraw_health_permission'])
  }

  const asked: AskItem[] = Array.isArray(q.restrictions) ? q.restrictions : []
  if (button.answer === 'no') {
    // «Si dice no, se deja de aplicar» (E-100 §5.6): what was pending goes.
    if (button.kind === 'person') {
      await clearPending(userId, { db, personId: q.person_id })
      return reply('system', personDeclinedReply(asked[0]?.alias ?? '', tap.lang))
    }
    await clearPending(userId, { db })
    return reply('system', declinedReply(tap.lang))
  }

  // «Sí»: what the question named and what is still pending (of those it covers) go to the ficha.
  const pending = await loadPending(userId, { db })
  const bySubject = new Map<string, { subject: SaidSubject; items: string[] }>()
  const add = (personId: string | null, alias: string | null, r: string) => {
    const key = personId ?? ''
    const entry = bySubject.get(key) ?? { subject: { personId, alias }, items: [] }
    if (!entry.items.some((x) => restrictionKey(x) === restrictionKey(r))) entry.items.push(r)
    bySubject.set(key, entry)
  }
  for (const i of asked) add(i.personId ?? null, i.alias ?? null, i.restriction)
  if (button.kind === 'ask') {
    // The other adults' pending items still need their own «está de acuerdo».
    const others = new Set(rowsOf(await db.execute(sql`SELECT DISTINCT person_id FROM health_chat_consents WHERE user_id = ${userId} AND scope = 'adult_agrees' AND person_id IS NOT NULL`)).map((r) => r.person_id))
    for (const p of pending) if (!p.personId || (!others.has(p.personId) && asked.some((a) => a.personId === p.personId))) add(p.personId, asked.find((a) => a.personId === p.personId)?.alias ?? null, p.restriction)
  } else {
    for (const p of pending) if (p.personId === q.person_id) add(p.personId, asked[0]?.alias ?? null, p.restriction)
  }
  const outbox: ChatAllergyOutbox = { userId, channel: tap.channel, messageId: tap.wamid, quiet: true, items: [] }
  const consentRef = rowsOf(await db.execute(sql`SELECT id FROM health_chat_consents WHERE question_id = ${q.id} AND event = 'granted' LIMIT 1`))[0]?.id ?? q.id
  for (const { subject, items } of bySubject.values()) {
    const fresh = await deps.save(items, subject)
    await clearPending(userId, { db, items, personId: subject.personId })
    if (fresh.length) outbox.items.push({ type: 'saved', personId: subject.personId, alias: subject.alias, items: fresh, consentRef, firstWebLine: false })
  }
  if (outbox.items.length === 0) return reply('system', tap.lang === 'en' ? 'Thanks: I have your permission.' : 'Gracias: ya tengo tu permiso.')
  await flushChatAllergyOutbox(outbox, { lang: tap.lang, db, send: deps.send })
  return { tools: ['update_profile'] }
}

// ─── The reminder and the sign-up follow-up ──────────────────────

/**
 * Pure: the one reminder (C.6) is due — the question went in an earlier turn,
 * there is no answer and no reminder yet, and something is still pending.
 */
export function reminderDue(p: ChatPermission, pending: readonly PendingRow[], now: Date): boolean {
  if (p.kind !== 'asked' || p.reminded || pending.length === 0) return false
  return now.getTime() - p.askedAt.getTime() > 60 * 60 * 1000
}

/** Queues nothing: sends the reminder with the same question's buttons, through `send`. */
export async function sendReminderIfDue(
  userId: string,
  opts: { lang: Lang; channel: ChatAllergyChannel; send: (m: FlushMessage) => Promise<string | null>; db?: Db; now?: Date },
): Promise<boolean> {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const p = await loadChatPermission(userId, db)
  const pending = await loadPending(userId, { db, now })
  if (!reminderDue(p, pending, now) || p.kind !== 'asked') return false
  const until = new Date(Math.max(...pending.map((x) => x.expiresAt.getTime())))
  const said = listText([...new Set(pending.map((x) => x.restriction))], opts.lang)
  const recorded = await insertEvent(db, { userId, event: 'reminded', questionId: p.questionId, channel: opts.channel, lang: opts.lang, textShown: reminderText(said, until, opts.lang) })
  if (!recorded) return false
  const b = ASK_BUTTONS[opts.lang]
  await opts.send({
    kind: 'health_ask',
    text: reminderText(said, until, opts.lang),
    buttons: [
      { id: consentButtonId('ask', 'yes', p.questionId), title: b.yes },
      { id: consentButtonId('ask', 'no', p.questionId), title: b.no },
    ],
  })
  return true
}

/** C.8: the buttons again, for a typed answer to the question still open. */
export async function repeatAskButtons(userId: string, lang: Lang, db: Db = defaultDb): Promise<FlushMessage | null> {
  const p = await loadChatPermission(userId, db)
  if (p.kind !== 'asked') return null
  const b = ASK_BUTTONS[lang]
  return {
    kind: 'health_ask',
    text: tapButtonReply(lang),
    buttons: [
      { id: consentButtonId('ask', 'yes', p.questionId), title: b.yes },
      { id: consentButtonId('ask', 'no', p.questionId), title: b.no },
    ],
  }
}

/**
 * The WhatsApp sign-up's follow-up: when the person said an allergy and has
 * no permission and was never asked, the one-time question replaces the
 * link to the web (E-103 §3). Null when there is nothing to ask.
 */
export async function signupAsk(userId: string, lang: Lang, db: Db = defaultDb, now: Date = new Date()): Promise<{ outbox: ChatAllergyOutbox } | null> {
  const p = await loadChatPermission(userId, db)
  if (p.kind !== 'never') return null
  const pending = await loadPending(userId, { db, now })
  if (pending.length === 0) return null
  const outbox: ChatAllergyOutbox = { userId, channel: 'whatsapp', messageId: null, quiet: false, items: [] }
  pushAsk(outbox, pending.map((x) => ({ restriction: x.restriction, personId: x.personId, alias: null })))
  void lang
  return { outbox }
}

/** Pure: the allergies of a message the code keeps out of the menus (and asks about) before Mimo answers. */
export function saidByCode(text: string | null | undefined): { strong: string[]; doubtful: string[] } {
  if (!text) return { strong: [], doubtful: [] }
  return allergiesInMessage(text)
}

/**
 * After the reply: what the turn left goes out and, when nothing else was
 * asked this turn, the one reminder if it is due.
 */
export async function finishChatTurn(
  outbox: ChatAllergyOutbox,
  opts: { lang: Lang; send: (m: FlushMessage) => Promise<string | null>; db?: Db; now?: Date },
): Promise<void> {
  const asked = outbox.items.some((i) => i.type === 'ask' || i.type === 'ask_person' || i.type === 'hint' || i.type === 'withdraw_ask')
  await flushChatAllergyOutbox(outbox, opts)
  if (!asked && !outbox.quiet) await sendReminderIfDue(outbox.userId, { ...opts, channel: outbox.channel })
}
