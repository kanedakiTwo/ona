/**
 * Conversation flags for the Mimoia HQ agents — GET /admin/assistant-reviews/flags
 * (specs/whatsapp.md "Conversation reviewer agent"). Aggregates and anonymised
 * items only: the agents never see a name, phone, email, address or the
 * user's own words.
 *
 * Deterministic detectors over Mimo's WhatsApp replies (pure, unit-tested):
 *   - `health_talk`: the reply talks about body effects (glucose, insulin…,
 *     `talksHealthEffects`, PRO-62) or the engine flagged it `health_talk`;
 *   - `health_claim`: the reply uses a constitution §6 guard-list claim
 *     (`HEALTH_CLAIM_PATTERNS`, the same list publicHealthClaims.test.ts uses);
 *   - `unverified_done`: the reply says it did something ("Hecho:", "he
 *     cambiado…") but the turn's tool trace (the ⟦hecho: …⟧ facts) shows no
 *     tool that changed anything; or the engine flagged `unverified_claim`;
 *   - `error_refusal`: the turn failed, the reply didn't go out, or the engine
 *     flagged a refusal / truncated reply.
 * Plus the daily reviewer's own findings (`assistant_reviews.findings`),
 * mapped onto those categories (`other` for the rest).
 */
import { and, asc, desc, gte, inArray, lte } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { assistantReviews, households, users, whatsappLinks, whatsappMessages } from '../db/schema.js'
import { addDays, madridMidnightUtc, madridParts } from './madridTime.js'
import { claimsAction } from './assistant/claims.js'
import { healthClaimWords, talksHealthEffects } from './assistant/healthGuard.js'
import type { ToolTrace } from './assistant/types.js'
import { anonymise, discoverNames, nameTokens } from './anonymise.js'

export const FLAG_CATEGORIES = ['health_talk', 'health_claim', 'unverified_done', 'error_refusal', 'other'] as const
export type FlagCategory = (typeof FLAG_CATEGORIES)[number]

/**
 * Tools that only read (or only answer): running one of them doesn't make a
 * "Hecho:" true. Anything else that ran without error counts as a change.
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'get_todays_menu', 'get_weekly_menu', 'get_recipe_details', 'get_weekly_nutrition', 'suggest_recipes', 'cook_with_what_i_have',
  'search_recipes', 'nutrition_advice', 'recipe_variation', 'get_pantry_stock', 'get_my_recipes', 'get_menu_history',
  'scale_recipe', 'evaluate_food_health', 'suggest_substitution', 'get_variety_score', 'get_eating_window',
  'get_week_balance', 'start_cooking_mode', 'set_timer', 'cooking_step', 'get_shopping_list', 'get_shop_orders', 'get_fixed_meals',
])

/** A tool that ran but reported that nothing changed. */
const NO_CHANGE_RE = /\bno (?:he|se ha|hay|tienes|existe|encuentro)\b|\bno he (?:cambiado|guardado|encontrado|podido)\b|^error\b/i

/** "Hecho:" opening a line, the format Mimo uses after a change. */
const HECHO_LINE_RE = /(?:^|\n)\s*\*?hecho\*?\s*[:.!]/i

export interface TurnMeta {
  tools?: string[]
  corrections?: string[]
  toolTrace?: ToolTrace[]
}

/** Pure: did any tool of this turn actually change something? */
export function traceHasChange(trace: ReadonlyArray<ToolTrace> | undefined): boolean {
  return (trace ?? []).some((t) => !t.error && !READ_ONLY_TOOLS.has(t.name) && !NO_CHANGE_RE.test(String(t.summary ?? '').trim()))
}

/**
 * Pure: the reply claims an action ("Hecho:", "he cambiado…") but the turn's
 * trace has no tool that changed anything. Turns from before the tool trace
 * (2026-10-12, `meta` without `toolTrace`) can't be judged → false.
 */
export function isUnverifiedDone(reply: string, meta: TurnMeta | null | undefined): boolean {
  if (meta?.corrections?.includes('unverified_claim')) return true
  if (!meta || !Array.isArray(meta.toolTrace)) return false
  const claims = HECHO_LINE_RE.test(reply) || claimsAction(reply)
  return claims && !traceHasChange(meta.toolTrace)
}

/** Pure: the flags a single Mimo reply raises, given its turn's metadata. */
export function replyFlags(reply: string, meta: TurnMeta | null | undefined): { categories: FlagCategory[]; claimWords: string[] } {
  const categories: FlagCategory[] = []
  const claimWords = healthClaimWords(reply)
  if (talksHealthEffects(reply) || meta?.corrections?.includes('health_talk')) categories.push('health_talk')
  if (claimWords.length) categories.push('health_claim')
  if (isUnverifiedDone(reply, meta)) categories.push('unverified_done')
  if (meta?.corrections?.some((c) => c === 'refusal' || c === 'truncated')) categories.push('error_refusal')
  return { categories, claimWords }
}

export interface FlagRow {
  phone: string
  userId: string | null
  direction: string
  kind: string
  body: string | null
  status: string
  meta: TurnMeta | null
  createdAt: Date
}

export interface DetectedFlag {
  at: Date
  day: string
  category: FlagCategory
  /** Mimo's reply, raw (anonymised later). null when the turn produced none. */
  reply: string | null
  /** Deterministic note: why it was flagged. No user text. */
  note: string
}

/**
 * Pure: walk each conversation (per phone, in time order) pairing every
 * inbound turn with Mimo's reply to it, and flag the replies.
 */
export function detectFlags(rows: ReadonlyArray<FlagRow>): { turns: number; flags: DetectedFlag[] } {
  const byPhone = new Map<string, FlagRow[]>()
  for (const r of rows) byPhone.set(r.phone, [...(byPhone.get(r.phone) ?? []), r])
  const flags: DetectedFlag[] = []
  let turns = 0
  for (const convo of byPhone.values()) {
    const sorted = [...convo].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    let turn: FlagRow | null = null
    let answered = false
    const closeTurn = () => {
      if (turn && turn.status === 'failed') {
        flags.push({ at: turn.createdAt, day: madridParts(turn.createdAt).isoDate, category: 'error_refusal', reply: null, note: 'El turno falló: Mimo no pudo responder.' })
      }
    }
    for (const r of sorted) {
      if (r.direction === 'in') {
        closeTurn()
        turn = r
        answered = false
        if (r.status === 'processed' || r.status === 'failed') turns += 1
        continue
      }
      if (r.kind !== 'reply' || !turn || answered) continue
      answered = true
      const reply = r.body ?? ''
      const day = madridParts(r.createdAt).isoDate
      const { categories, claimWords } = replyFlags(reply, turn.meta)
      for (const category of categories) {
        flags.push({ at: r.createdAt, day, category, reply, note: noteFor(category, turn.meta, claimWords) })
      }
      if (r.status === 'failed') {
        flags.push({ at: r.createdAt, day, category: 'error_refusal', reply, note: 'La respuesta no se pudo entregar por WhatsApp.' })
      }
    }
    closeTurn()
  }
  return { turns, flags: flags.sort((a, b) => a.at.getTime() - b.at.getTime()) }
}

function noteFor(category: FlagCategory, meta: TurnMeta | null | undefined, claimWords: string[]): string {
  switch (category) {
    case 'health_talk':
      return 'Habla de efectos en el cuerpo (regla de salud PRO-62): debería derivar al médico o pediatra y dar solo ideas de cocina.'
    case 'health_claim':
      return `Usa un reclamo de salud prohibido (§6): ${claimWords.join(', ')}.`
    case 'unverified_done': {
      const tools = (meta?.toolTrace ?? []).map((t) => `${t.name}${t.error ? ' (error)' : ''}`)
      return tools.length
        ? `Dice que lo ha hecho, pero ninguna herramienta cambió nada (solo: ${tools.join(', ')}).`
        : 'Dice que lo ha hecho, pero no usó ninguna herramienta en ese turno.'
    }
    case 'error_refusal':
      return meta?.corrections?.includes('refusal') ? 'El modelo se negó a responder.' : 'Respuesta cortada (límite de longitud).'
    default:
      return ''
  }
}

/** Reviewer categories (services/whatsapp/reviewer.ts REVIEW_SCHEMA) → flag categories. */
export function reviewerCategory(category: string): FlagCategory {
  if (['afirmacion_falsa', 'accion_no_hecha', 'promesa_incumplida'].includes(category)) return 'unverified_done'
  if (['error_tecnico', 'rechazo_indebido'].includes(category)) return 'error_refusal'
  return 'other'
}

export interface ReviewerFinding {
  severity?: string
  category?: string
  when?: string
  whatHappened?: string
  suggestedFix?: string
}

export interface FlagItem {
  date: string
  channel: 'whatsapp'
  category: FlagCategory
  /** detector | reviewer | both (a detector flag the reviewer also reported). */
  source: 'detector' | 'reviewer' | 'both'
  /** Reviewer's own category (reviewer findings only). */
  reviewerCategory: string | null
  severity: string | null
  /** Mimo's reply, anonymised; null for reviewer-only findings and failed turns. */
  reply: string | null
  /** Detector reason and/or the reviewer's note (what happened → suggested fix), anonymised. */
  note: string
}

const HHMM_RE = /\b([01]?\d|2[0-3])[:.h]([0-5]\d)\b/

function minutesOfDay(d: Date): number {
  const p = madridParts(d)
  return p.hour * 60 + p.minute
}

/**
 * Pure: detector flags + reviewer findings → anonymised items. A reviewer
 * finding in the same category, day and (±3 min) time as a detector flag is
 * merged into it, so one problem shows once with the reviewer's note.
 */
export function buildFlagItems(
  detected: ReadonlyArray<DetectedFlag>,
  reviews: ReadonlyArray<{ day: string; findings: unknown }>,
  knownNames: ReadonlyArray<string>,
  maxReplyChars = 600,
): FlagItem[] {
  const clip = (s: string) => (s.length > maxReplyChars ? `${s.slice(0, maxReplyChars - 1)}…` : s)
  // Names revealed anywhere in the batch are masked everywhere in it.
  const findings = reviews.flatMap((r) => (Array.isArray(r.findings) ? (r.findings as ReviewerFinding[]) : []))
  knownNames = nameTokens([
    ...knownNames,
    ...detected.flatMap((f) => discoverNames(f.reply)),
    ...findings.flatMap((f) => [...discoverNames(f?.whatHappened), ...discoverNames(f?.suggestedFix)]),
  ])
  const items: Array<FlagItem & { minute: number | null }> = detected.map((f) => ({
    date: f.day,
    channel: 'whatsapp',
    category: f.category,
    source: 'detector',
    reviewerCategory: null,
    severity: null,
    reply: f.reply == null ? null : clip(anonymise(f.reply, knownNames)),
    note: f.note,
    minute: minutesOfDay(f.at),
  }))
  for (const r of reviews) {
    for (const raw of Array.isArray(r.findings) ? (r.findings as ReviewerFinding[]) : []) {
      const category = reviewerCategory(String(raw?.category ?? ''))
      const note = anonymise([raw?.whatHappened, raw?.suggestedFix].filter(Boolean).join(' → '), knownNames)
      const m = String(raw?.when ?? '').match(HHMM_RE)
      const minute = m ? Number(m[1]) * 60 + Number(m[2]) : null
      const match =
        minute == null || category === 'other'
          ? undefined
          : items.find((i) => i.source === 'detector' && i.date === r.day && i.category === category && i.minute != null && Math.abs(i.minute - minute) <= 3)
      if (match) {
        match.source = 'both'
        match.reviewerCategory = raw?.category ?? null
        match.severity = raw?.severity ?? null
        match.note = `${match.note} Revisor: ${note}`
        continue
      }
      items.push({
        date: r.day,
        channel: 'whatsapp',
        category,
        source: 'reviewer',
        reviewerCategory: raw?.category ?? null,
        severity: raw?.severity ?? null,
        reply: null,
        note,
        minute,
      })
    }
  }
  return items
    .sort((a, b) => a.date.localeCompare(b.date) || (a.minute ?? 0) - (b.minute ?? 0))
    .map(({ minute: _m, ...i }) => i)
}

export function countFlags(items: ReadonlyArray<FlagItem>) {
  const byCategory = Object.fromEntries(FLAG_CATEGORIES.map((c) => [c, 0])) as Record<FlagCategory, number>
  const reviewerByCategory: Record<string, number> = {}
  const reviewerBySeverity: Record<string, number> = {}
  for (const i of items) {
    byCategory[i.category] += 1
    if (i.source !== 'detector' && i.reviewerCategory) {
      reviewerByCategory[i.reviewerCategory] = (reviewerByCategory[i.reviewerCategory] ?? 0) + 1
      if (i.severity) reviewerBySeverity[i.severity] = (reviewerBySeverity[i.severity] ?? 0) + 1
    }
  }
  return { byCategory, reviewerByCategory, reviewerBySeverity }
}

type Db = typeof defaultDb

export async function loadAssistantFlags(opts: { days: number; now?: Date }, db: Db = defaultDb) {
  const now = opts.now ?? new Date()
  const today = madridParts(now).isoDate
  const fromDay = addDays(today, -(opts.days - 1))
  const from = madridMidnightUtc(fromDay)

  const rows = (await db
    .select({
      phone: whatsappMessages.phone,
      userId: whatsappMessages.userId,
      direction: whatsappMessages.direction,
      kind: whatsappMessages.kind,
      body: whatsappMessages.body,
      status: whatsappMessages.status,
      meta: whatsappMessages.meta,
      createdAt: whatsappMessages.createdAt,
    })
    .from(whatsappMessages)
    .where(gte(whatsappMessages.createdAt, from))
    .orderBy(asc(whatsappMessages.createdAt))) as FlagRow[]

  const reviews = await db
    .select({ day: assistantReviews.day, status: assistantReviews.status, findings: assistantReviews.findings })
    .from(assistantReviews)
    .where(and(gte(assistantReviews.day, fromDay), lte(assistantReviews.day, today)))
    .orderBy(desc(assistantReviews.day))

  // Every name that could show up: the people in the window, their WhatsApp
  // profile names, their households' names and the other members' usernames.
  const userIds = [...new Set(rows.map((r) => r.userId).filter((u): u is string => !!u))]
  const names: Array<string | null> = []
  if (userIds.length) {
    const people = await db
      .select({ username: users.username, email: users.email, householdId: users.primaryHouseholdId })
      .from(users)
      .where(inArray(users.id, userIds))
    const links = await db.select({ profileName: whatsappLinks.profileName }).from(whatsappLinks).where(inArray(whatsappLinks.userId, userIds))
    const hhIds = [...new Set(people.map((p) => p.householdId).filter((h): h is string => !!h))]
    const hh = hhIds.length ? await db.select({ name: households.name }).from(households).where(inArray(households.id, hhIds)) : []
    const members = hhIds.length
      ? await db.select({ username: users.username, email: users.email }).from(users).where(inArray(users.primaryHouseholdId, hhIds))
      : []
    names.push(...people.flatMap((p) => [p.username, p.email]), ...links.map((l) => l.profileName), ...hh.map((h) => h.name))
    names.push(...members.flatMap((m) => [m.username, m.email]))
  }
  // Names the users themselves mention ("para Antonio") — their messages never leave.
  names.push(...rows.filter((r) => r.direction === 'in').flatMap((r) => discoverNames(r.body)))
  const knownNames = nameTokens(names)

  const { turns, flags } = detectFlags(rows)
  const items = buildFlagItems(flags, reviews, knownNames)
  return {
    generatedAt: now.toISOString(),
    windowDays: opts.days,
    from: fromDay,
    to: today,
    channels: ['whatsapp'],
    turns,
    reviews: {
      ok: reviews.filter((r) => r.status === 'ok').length,
      empty: reviews.filter((r) => r.status === 'empty').length,
      failed: reviews.filter((r) => r.status === 'failed').length,
    },
    counts: countFlags(items),
    items,
  }
}
