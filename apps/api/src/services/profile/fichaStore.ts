/**
 * PRO-317 (D-064, D-110) — «Tu ficha»: read it as its reader may see it, and
 * act on it (confirm, correct, forget, undo what Mimo did, answer the pending
 * question, pause the learning, people without an account). Every change goes
 * through the writer (writer.ts) with its history row; a memory key about the
 * reader or the household also goes back to `user_memories`, the mirror the
 * menu generator still reads. Spec: specs/household-profile.md → «Tu ficha».
 */
import { and, asc, desc, eq, gte, inArray, isNull, or, sql } from 'drizzle-orm'
import {
  MEMORY_KEYS,
  FICHA_QUESTION_EVERY_DAYS,
  PROFILE_FACT_VALUE_SCHEMAS,
  canSeeProfileFact,
  canWriteProfileFact,
  householdPersonSchema,
  isHealthProfileFactType,
  memoryKeyIsHouseholdLevel,
  type FichaAskView,
  type FichaChangeView,
  type FichaFactView,
  type FichaView,
  type FichaWhyView,
  type ProfileViewer,
} from '@ona/shared'
import { db as defaultDb } from '../../db/connection.js'
import {
  householdMembers,
  householdPersons,
  householdProfiles,
  profileChanges,
  profileFacts,
  profileQuestions,
  userMemories,
  users,
  whatsappLinks,
} from '../../db/schema.js'
import { hasHealthConsent } from '../healthConsent.js'
import { factsInForce } from './reader.js'
import { SERVICE_WINDOW_MS } from '../whatsapp/proactive.js'
import { mentionsHealth } from './healthText.js'
import { changeView, confidenceFor, factSentence, factView, howIUse, peopleView, type ChangeRow, type FactRow } from './view.js'
import { madridDate, retireProfileFacts, signalEvidence, upsertProfileFact } from './writer.js'

type Db = typeof defaultDb

export class FichaError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message)
    this.name = 'FichaError'
  }
}

export interface FichaReader {
  userId: string
  householdId: string
  role: 'owner' | 'member' | 'child'
}

/** The reader's primary household and role; null without one. */
export async function fichaReader(userId: string, db: Db = defaultDb): Promise<FichaReader | null> {
  const [row] = await db
    .select({ householdId: users.primaryHouseholdId, role: householdMembers.role })
    .from(users)
    .leftJoin(householdMembers, and(eq(householdMembers.userId, users.id), eq(householdMembers.householdId, users.primaryHouseholdId)))
    .where(eq(users.id, userId))
    .limit(1)
  if (!row?.householdId) return null
  const role = (row.role === 'owner' || row.role === 'child' ? row.role : 'member') as FichaReader['role']
  return { userId, householdId: row.householdId, role }
}

const viewerOf = (r: FichaReader): ProfileViewer => ({ kind: 'member', userId: r.userId, role: r.role })

async function membersOf(householdId: string, db: Db) {
  return db.select({ userId: users.id, name: users.username, pausedAt: users.profileLearningPausedAt })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(asc(householdMembers.joinedAt))
}

/** Who last said each user-origin fact (the latest history row with an actor). */
async function actorsOf(factIds: string[], db: Db): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  if (!factIds.length) return out
  const rows = await db.select({ factId: profileChanges.factId, actor: profileChanges.actorUserId, at: profileChanges.createdAt })
    .from(profileChanges)
    .where(and(inArray(profileChanges.factId, factIds), eq(profileChanges.origin, 'user')))
    .orderBy(asc(profileChanges.createdAt))
  for (const r of rows) if (r.factId) out.set(r.factId, r.actor)
  return out
}

function factRow(f: typeof profileFacts.$inferSelect): FactRow {
  return {
    id: f.id, subjectUserId: f.subjectUserId, subjectPersonId: f.subjectPersonId, type: f.type, value: f.value,
    origin: f.origin, confidence: f.confidence, evidence: f.evidence, validUntil: f.validUntil, status: f.status,
    createdAt: f.createdAt, updatedAt: f.updatedAt,
  }
}

/**
 * The pending question the reader sees: one at a time, about them, the
 * household or a person without an account (never about another member,
 * who answers it themselves), not one they put off in the last 7 days.
 */
function pickQuestion(questions: Array<typeof profileQuestions.$inferSelect>, now: Date, readerId: string) {
  const week = 7 * 24 * 3600 * 1000
  return questions.find((q) => q.status === 'pending' && (!q.subjectUserId || q.subjectUserId === readerId)
    && (!q.askedAt || now.getTime() - q.askedAt.getTime() > week)) ?? null
}

/** «Tu ficha» for its reader (`FichaView`). A `child` member gets 403. */
export async function loadFichaView(userId: string, opts: { db?: Db; now?: Date } = {}): Promise<FichaView> {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  if (reader.role === 'child') throw new FichaError(403, 'CHILD', 'La ficha la ven los adultos de la casa')
  const viewer = viewerOf(reader)
  const [members, persons, portraitRows, facts, questions] = await Promise.all([
    membersOf(reader.householdId, db),
    db.select().from(householdPersons).where(eq(householdPersons.householdId, reader.householdId)).orderBy(asc(householdPersons.createdAt)),
    db.select().from(householdProfiles).where(eq(householdProfiles.householdId, reader.householdId)).limit(1),
    db.select().from(profileFacts).where(and(eq(profileFacts.householdId, reader.householdId), eq(profileFacts.status, 'active'))).orderBy(asc(profileFacts.createdAt), asc(profileFacts.id)),
    db.select().from(profileQuestions).where(and(eq(profileQuestions.householdId, reader.householdId), eq(profileQuestions.status, 'pending'))).orderBy(asc(profileQuestions.createdAt)),
  ])
  const visible = factsInForce(facts, now).filter((f) => canSeeProfileFact(f, viewer))
  const actors = await actorsOf(visible.map((f) => f.id), db)
  const names = Object.fromEntries(members.map((m) => [m.userId, m.name]))
  const factViews = visible
    .map((f) => factView(factRow(f), { viewerId: userId, viewerRole: reader.role, actorUserId: actors.get(f.id) ?? null, names }))
    .filter((f): f is FichaFactView => !!f)
  const q = pickQuestion(questions, now, userId)
  const factForQuestion = q ? visible.find((f) => f.type === q.factType && f.subjectUserId === q.subjectUserId && f.subjectPersonId === q.subjectPersonId) : undefined
  const recent = (await loadFichaChanges(userId, { db, now, days: 14, reader })).slice(0, 5)
  const portrait = portraitRows[0]
  return {
    householdId: reader.householdId,
    portrait: portrait?.portrait?.trim() ? { text: portrait.portrait.trim(), updatedAt: portrait.generatedAt.toISOString() } : null,
    people: peopleView(userId, reader.role, members, persons),
    facts: factViews,
    question: q ? { id: q.id, question: q.question, subjectKey: q.subjectUserId ? `u:${q.subjectUserId}` : q.subjectPersonId ? `p:${q.subjectPersonId}` : 'casa', factId: factForQuestion?.id ?? null } : null,
    recent,
    learningPaused: !!members.find((m) => m.userId === userId)?.pausedAt,
    readOnly: false,
  }
}

/** The history the reader may see, newest first (`days` back). */
export async function loadFichaChanges(userId: string, opts: { db?: Db; now?: Date; days?: number; reader?: FichaReader } = {}): Promise<FichaChangeView[]> {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const reader = opts.reader ?? await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  if (reader.role === 'child') throw new FichaError(403, 'CHILD', 'La ficha la ven los adultos de la casa')
  const since = new Date(now.getTime() - (opts.days ?? 60) * 24 * 3600 * 1000)
  const changes = await db.select().from(profileChanges)
    .where(and(eq(profileChanges.householdId, reader.householdId), gte(profileChanges.createdAt, since),
      inArray(profileChanges.action, ['fact_added', 'fact_updated', 'fact_retired', 'portrait_updated'])))
    .orderBy(desc(profileChanges.createdAt))
    .limit(200)
  const factIds = [...new Set(changes.map((c) => c.factId).filter((x): x is string => !!x))]
  const facts = factIds.length ? await db.select().from(profileFacts).where(inArray(profileFacts.id, factIds)) : []
  const byId = new Map(facts.map((f) => [f.id, factRow(f)]))
  const viewer = viewerOf(reader)
  const [portrait] = await db.select({ text: householdProfiles.portrait }).from(householdProfiles).where(eq(householdProfiles.householdId, reader.householdId)).limit(1)
  return changes
    .filter((c) => !c.factId || (byId.has(c.factId) && canSeeProfileFact(byId.get(c.factId)!, viewer)))
    .map((c) => changeView(c as ChangeRow, c.factId ? byId.get(c.factId) : undefined, userId, portrait?.text ?? null))
    .filter((c): c is FichaChangeView => !!c)
}

async function visibleFact(reader: FichaReader, factId: string, db: Db) {
  const [f] = await db.select().from(profileFacts).where(and(eq(profileFacts.id, factId), eq(profileFacts.householdId, reader.householdId))).limit(1)
  if (!f || !canSeeProfileFact(f, viewerOf(reader))) throw new FichaError(404, 'NOT_FOUND', 'No está en tu ficha')
  return f
}

/** «¿Por qué lo sé?». */
export async function loadFichaWhy(userId: string, factId: string, opts: { db?: Db } = {}): Promise<FichaWhyView> {
  const db = opts.db ?? defaultDb
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  if (reader.role === 'child') throw new FichaError(403, 'CHILD', 'La ficha la ven los adultos de la casa')
  const f = await visibleFact(reader, factId, db)
  const members = await membersOf(reader.householdId, db)
  const actors = await actorsOf([f.id], db)
  const view = factView(factRow(f), { viewerId: userId, viewerRole: reader.role, actorUserId: actors.get(f.id) ?? null, names: Object.fromEntries(members.map((m) => [m.userId, m.name])) })
  if (!view) throw new FichaError(404, 'NOT_FOUND', 'No está en tu ficha')
  const evidence = (Array.isArray(f.evidence) ? f.evidence : [])
    .map((e: any) => ({ date: String(e?.date ?? ''), text: String(e?.summary ?? '').trim() }))
    .filter((e) => e.text && e.text !== 'Copiado de la memoria de Mimo (lo escribió el usuario)')
    .reverse()
    .slice(0, 10)
  return { fact: view, confidence: confidenceFor(f), since: madridDate(f.createdAt), evidence, howIUse: howIUse(f.type, f.value) }
}

function assertCanEdit(reader: FichaReader, f: { subjectUserId: string | null }) {
  if (reader.role === 'child') throw new FichaError(403, 'CHILD', 'La ficha la cambian los adultos de la casa')
  if (f.subjectUserId && f.subjectUserId !== reader.userId) throw new FichaError(403, 'OTHER_PERSON', 'Esto lo cambia esa persona desde su ficha')
}

/** The members a household-level memory key is mirrored to; a personal one, to the person. */
async function memoryOwners(tx: any, reader: FichaReader, f: { type: string; subjectUserId: string | null; subjectPersonId: string | null }): Promise<string[]> {
  if (!(MEMORY_KEYS as readonly string[]).includes(f.type) || f.subjectPersonId) return []
  if (f.subjectUserId) return [f.subjectUserId]
  if (!memoryKeyIsHouseholdLevel(f.type)) return []
  const rows = await tx.select({ userId: householdMembers.userId }).from(householdMembers)
    .where(and(eq(householdMembers.householdId, reader.householdId), sql`${householdMembers.role} <> 'child'`))
  return rows.map((r: any) => r.userId)
}

/** Keep `user_memories` (the mirror the generator reads) in step with a change made in the ficha. */
async function mirrorToMemory(tx: any, owners: string[], key: string, value: unknown | null) {
  for (const userId of owners) {
    if (value === null) {
      await tx.delete(userMemories).where(and(eq(userMemories.userId, userId), eq(userMemories.key, key)))
    } else {
      await tx.insert(userMemories).values({ userId, key, value: value as object, source: 'manual', confidence: 1 })
        .onConflictDoUpdate({ target: [userMemories.userId, userMemories.key], set: { value: value as object, source: 'manual', confidence: 1, updatedAt: new Date() } })
    }
  }
}

async function assertHealthWrite(reader: FichaReader, type: string) {
  if (isHealthProfileFactType(type) && !(await hasHealthConsent(reader.userId))) {
    throw new FichaError(403, 'HEALTH_CONSENT_REQUIRED', 'Para guardar datos de salud necesitas dar tu consentimiento en Perfil')
  }
}

/** «Así es»: the reader confirms it (it becomes theirs). */
export async function confirmFact(userId: string, factId: string, opts: { db?: Db; now?: Date } = {}): Promise<void> {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  const f = await visibleFact(reader, factId, db)
  assertCanEdit(reader, f)
  await db.transaction(async (tx) => {
    await upsertProfileFact(tx, {
      householdId: f.householdId, subjectUserId: f.subjectUserId, subjectPersonId: f.subjectPersonId, type: f.type, value: f.value,
      origin: 'user', confidence: 1, evidence: { signal: 'profile', date: madridDate(now), summary: 'Lo confirmaste en tu ficha' },
      reason: 'Lo confirmó en su ficha', actorUserId: userId, now,
    })
    await mirrorToMemory(tx, await memoryOwners(tx, reader, f), f.type, f.value)
  })
}

/**
 * «Corregir»: the new value, already typed and checked against its schema
 * (the route turns the reader's words into it, correction.ts). It becomes the
 * reader's (origin `user`) and wins over what Mimo deduced.
 */
export async function correctFact(
  userId: string,
  factId: string,
  input: { value: unknown; validUntil?: Date | null; text: string },
  opts: { db?: Db; now?: Date } = {},
): Promise<void> {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  const f = await visibleFact(reader, factId, db)
  assertCanEdit(reader, f)
  await assertHealthWrite(reader, f.type)
  const schema = PROFILE_FACT_VALUE_SCHEMAS[f.type as keyof typeof PROFILE_FACT_VALUE_SCHEMAS]
  const parsed = schema?.safeParse(input.value)
  if (!parsed?.success) throw new FichaError(422, 'INVALID_VALUE', 'No he sabido apuntarlo así')
  await db.transaction(async (tx) => {
    // The corrected fact replaces this one (also for a multi-valued type: it's the same thing, said right).
    await tx.update(profileFacts).set({ value: parsed.data, origin: 'user', confidence: 1, validUntil: input.validUntil === undefined ? f.validUntil : input.validUntil,
      evidence: [...(Array.isArray(f.evidence) ? f.evidence : []), signalEvidence('profile', f.type, parsed.data, now)].slice(-20), updatedAt: now })
      .where(eq(profileFacts.id, f.id))
    await tx.insert(profileChanges).values({
      householdId: f.householdId, factId: f.id, action: 'fact_updated', factType: f.type,
      before: { value: f.value, confidence: f.confidence, origin: f.origin }, after: { value: parsed.data, confidence: 1 },
      reason: `Lo corrigió en su ficha: «${input.text.slice(0, 200)}»`, origin: 'user', actorUserId: userId,
    })
    await mirrorToMemory(tx, await memoryOwners(tx, reader, f), f.type, parsed.data)
  })
}

/** «Olvidar». Mimo won't add it back without asking (the refiner sees it as the reader's). */
export async function forgetFact(userId: string, factId: string, opts: { db?: Db; now?: Date } = {}): Promise<void> {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  const f = await visibleFact(reader, factId, db)
  assertCanEdit(reader, f)
  await db.transaction(async (tx) => {
    await tx.update(profileFacts).set({ status: 'retired', updatedAt: now }).where(eq(profileFacts.id, f.id))
    await tx.insert(profileChanges).values({
      householdId: f.householdId, factId: f.id, action: 'fact_retired', factType: f.type,
      before: { value: f.value, confidence: f.confidence, origin: f.origin }, after: null,
      reason: 'Lo olvidó en su ficha', origin: 'user', actorUserId: userId,
    })
    await mirrorToMemory(tx, await memoryOwners(tx, reader, f), f.type, null)
  })
}

/** «Deshacer» what Mimo did (a change by the AI); 409 when the fact has moved on since. */
export async function undoChange(userId: string, changeId: string, opts: { db?: Db; now?: Date } = {}): Promise<void> {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  if (reader.role === 'child') throw new FichaError(403, 'CHILD', 'La ficha la cambian los adultos de la casa')
  const [c] = await db.select().from(profileChanges).where(and(eq(profileChanges.id, changeId), eq(profileChanges.householdId, reader.householdId))).limit(1)
  if (!c || !['ai_realtime', 'ai_nightly', 'ai_weekly'].includes(c.origin)) throw new FichaError(404, 'NOT_FOUND', 'Eso no se puede deshacer')
  await db.transaction(async (tx) => {
    if (c.action === 'portrait_updated') {
      const before = (c.before as { portrait?: string } | null)?.portrait
      if (!before) throw new FichaError(409, 'NOTHING_BEFORE', 'No había otro retrato antes')
      await tx.update(householdProfiles).set({ portrait: before, updatedAt: now }).where(eq(householdProfiles.householdId, reader.householdId))
      await tx.insert(profileChanges).values({ householdId: reader.householdId, action: 'portrait_updated', before: c.after, after: c.before, reason: 'Deshizo el retrato nuevo', origin: 'user', actorUserId: userId })
      return
    }
    if (!c.factId) throw new FichaError(404, 'NOT_FOUND', 'Eso no se puede deshacer')
    const [f] = await tx.select().from(profileFacts).where(eq(profileFacts.id, c.factId)).limit(1)
    if (!f || !canSeeProfileFact(f, viewerOf(reader))) throw new FichaError(404, 'NOT_FOUND', 'Eso no se puede deshacer')
    assertCanEdit(reader, f)
    const before = c.before as { value?: unknown; confidence?: number; origin?: string } | null
    const owners = await memoryOwners(tx, reader, f)
    if (c.action === 'fact_added') {
      if (f.status !== 'active') throw new FichaError(409, 'MOVED_ON', 'Ya no está en tu ficha')
      await tx.update(profileFacts).set({ status: 'retired', updatedAt: now }).where(eq(profileFacts.id, f.id))
      await tx.insert(profileChanges).values({ householdId: f.householdId, factId: f.id, action: 'fact_retired', factType: f.type, before: { value: f.value, confidence: f.confidence, origin: f.origin }, after: null, reason: 'Deshizo lo que apuntó Mimo', origin: 'user', actorUserId: userId })
      await mirrorToMemory(tx, owners, f.type, null)
    } else if (c.action === 'fact_updated' && before && 'value' in before) {
      await tx.update(profileFacts).set({ value: before.value, origin: before.origin ?? 'user', confidence: before.confidence ?? 1, status: 'active', updatedAt: now }).where(eq(profileFacts.id, f.id))
      await tx.insert(profileChanges).values({ householdId: f.householdId, factId: f.id, action: 'fact_updated', factType: f.type, before: { value: f.value, confidence: f.confidence, origin: f.origin }, after: { value: before.value, confidence: before.confidence ?? 1 }, reason: 'Deshizo el cambio de Mimo', origin: 'user', actorUserId: userId })
      await mirrorToMemory(tx, owners, f.type, before.value)
    } else if (c.action === 'fact_retired') {
      if (f.status === 'active') throw new FichaError(409, 'MOVED_ON', 'Ya está en tu ficha')
      await tx.update(profileFacts).set({ status: 'active', updatedAt: now }).where(eq(profileFacts.id, f.id))
      await tx.insert(profileChanges).values({ householdId: f.householdId, factId: f.id, action: 'fact_updated', factType: f.type, before: null, after: { value: f.value, confidence: f.confidence }, reason: 'Deshizo que Mimo lo olvidara', origin: 'user', actorUserId: userId })
      await mirrorToMemory(tx, owners, f.type, f.value)
    } else {
      throw new FichaError(404, 'NOT_FOUND', 'Eso no se puede deshacer')
    }
  })
}

/**
 * The pending question: «yes» keeps the fact it is about (confirmed), «no»
 * forgets it; without such a fact the answer waits for the next night's
 * signals. «later» hides it for 7 days.
 */
export async function answerQuestion(userId: string, questionId: string, answer: 'yes' | 'no' | 'later', opts: { db?: Db; now?: Date } = {}): Promise<void> {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  if (reader.role === 'child') throw new FichaError(403, 'CHILD', 'La ficha la cambian los adultos de la casa')
  const [q] = await db.select().from(profileQuestions).where(and(eq(profileQuestions.id, questionId), eq(profileQuestions.householdId, reader.householdId))).limit(1)
  if (!q || q.status !== 'pending') throw new FichaError(404, 'NOT_FOUND', 'Esa pregunta ya está contestada')
  if (q.subjectUserId && q.subjectUserId !== userId) throw new FichaError(403, 'OTHER_PERSON', 'Esa pregunta es para otra persona de casa')
  if (answer === 'later') {
    await db.update(profileQuestions).set({ askedAt: now }).where(eq(profileQuestions.id, q.id))
    return
  }
  const [f] = q.factType
    ? await db.select().from(profileFacts).where(and(
      eq(profileFacts.householdId, reader.householdId), eq(profileFacts.type, q.factType), eq(profileFacts.status, 'active'),
      q.subjectUserId ? eq(profileFacts.subjectUserId, q.subjectUserId) : isNull(profileFacts.subjectUserId),
      q.subjectPersonId ? eq(profileFacts.subjectPersonId, q.subjectPersonId) : isNull(profileFacts.subjectPersonId),
    )).orderBy(desc(profileFacts.updatedAt)).limit(1)
    : []
  await db.update(profileQuestions).set({ status: 'answered', answer, answeredByUserId: userId, resolvedAt: now }).where(eq(profileQuestions.id, q.id))
  await db.insert(profileChanges).values({ householdId: reader.householdId, action: 'question_resolved', factType: q.factType, before: { question: q.question }, after: { answer }, reason: `Contestó «${answer === 'yes' ? 'Sí' : 'No'}» en su ficha`, origin: 'user', actorUserId: userId })
  if (f) {
    if (answer === 'yes') await confirmFact(userId, f.id, { db, now })
    else await forgetFact(userId, f.id, { db, now })
  }
}

/** «Aprender de lo que hago»: per person. */
export async function setLearningPaused(userId: string, paused: boolean, opts: { db?: Db; now?: Date } = {}): Promise<boolean> {
  const db = opts.db ?? defaultDb
  await db.update(users).set({ profileLearningPausedAt: paused ? opts.now ?? new Date() : null }).where(eq(users.id, userId))
  return paused
}

/** People without an account (alias + age band; a minor only with a generic alias). */
export async function addPerson(userId: string, input: { alias: string; ageBand: string }, opts: { db?: Db } = {}) {
  const db = opts.db ?? defaultDb
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  if (reader.role === 'child') throw new FichaError(403, 'CHILD', 'Las personas de la casa las cambian los adultos')
  const parsed = householdPersonSchema.safeParse({ alias: input.alias, ageBand: input.ageBand })
  if (!parsed.success) throw new FichaError(422, 'INVALID_PERSON', parsed.error.issues[0]?.message ?? 'Datos no válidos')
  return db.transaction(async (tx) => {
    const [p] = await tx.insert(householdPersons).values({ householdId: reader.householdId, alias: parsed.data.alias, ageBand: parsed.data.ageBand }).returning()
    await tx.insert(profileChanges).values({ householdId: reader.householdId, action: 'person_added', before: null, after: { alias: p.alias, ageBand: p.ageBand }, reason: 'Lo añadió en su ficha', origin: 'user', actorUserId: userId })
    return { id: p.id, alias: p.alias, ageBand: p.ageBand }
  })
}

export async function updatePerson(userId: string, personId: string, input: { alias: string; ageBand: string }, opts: { db?: Db } = {}) {
  const db = opts.db ?? defaultDb
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  if (reader.role === 'child') throw new FichaError(403, 'CHILD', 'Las personas de la casa las cambian los adultos')
  const parsed = householdPersonSchema.safeParse({ alias: input.alias, ageBand: input.ageBand })
  if (!parsed.success) throw new FichaError(422, 'INVALID_PERSON', parsed.error.issues[0]?.message ?? 'Datos no válidos')
  const [before] = await db.select().from(householdPersons).where(and(eq(householdPersons.id, personId), eq(householdPersons.householdId, reader.householdId))).limit(1)
  if (!before) throw new FichaError(404, 'NOT_FOUND', 'No está en tu casa')
  await db.transaction(async (tx) => {
    await tx.update(householdPersons).set({ alias: parsed.data.alias, ageBand: parsed.data.ageBand, updatedAt: new Date() }).where(eq(householdPersons.id, personId))
    await tx.insert(profileChanges).values({ householdId: reader.householdId, action: 'person_updated', before: { alias: before.alias, ageBand: before.ageBand }, after: { alias: parsed.data.alias, ageBand: parsed.data.ageBand }, reason: 'Lo cambió en su ficha', origin: 'user', actorUserId: userId })
  })
  return { id: personId, alias: parsed.data.alias, ageBand: parsed.data.ageBand }
}

/** «Quitar de la casa»: the person and what the ficha knew about them (cascade). */
export async function removePerson(userId: string, personId: string, opts: { db?: Db } = {}): Promise<void> {
  const db = opts.db ?? defaultDb
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  if (reader.role === 'child') throw new FichaError(403, 'CHILD', 'Las personas de la casa las cambian los adultos')
  const [before] = await db.select().from(householdPersons).where(and(eq(householdPersons.id, personId), eq(householdPersons.householdId, reader.householdId))).limit(1)
  if (!before) throw new FichaError(404, 'NOT_FOUND', 'No está en tu casa')
  await db.transaction(async (tx) => {
    await tx.delete(householdPersons).where(eq(householdPersons.id, personId))
    await tx.insert(profileChanges).values({ householdId: reader.householdId, action: 'person_removed', before: { alias: before.alias, ageBand: before.ageBand }, after: null, reason: 'Lo quitó de su ficha', origin: 'user', actorUserId: userId })
  })
}

/** «Descargar mi ficha» (derecho de acceso): everything the reader may see, with evidence and history. */
export async function exportFicha(userId: string, opts: { db?: Db; now?: Date } = {}) {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  if (reader.role === 'child') throw new FichaError(403, 'CHILD', 'La ficha la ven los adultos de la casa')
  const viewer = viewerOf(reader)
  const [portrait] = await db.select().from(householdProfiles).where(eq(householdProfiles.householdId, reader.householdId)).limit(1)
  const persons = await db.select().from(householdPersons).where(eq(householdPersons.householdId, reader.householdId))
  const facts = (await db.select().from(profileFacts).where(eq(profileFacts.householdId, reader.householdId)).orderBy(asc(profileFacts.createdAt)))
    .filter((f) => canSeeProfileFact(f, viewer))
  const ids = facts.map((f) => f.id)
  const changes = await db.select().from(profileChanges)
    .where(and(eq(profileChanges.householdId, reader.householdId), or(isNull(profileChanges.factId), ids.length ? inArray(profileChanges.factId, ids) : sql`false`)))
    .orderBy(asc(profileChanges.createdAt))
  const questions = await db.select().from(profileQuestions).where(eq(profileQuestions.householdId, reader.householdId))
  return {
    exportedAt: now.toISOString(),
    about: 'Todo lo que Mimoia sabe de ti y de tu casa (la salud de otras personas de la casa no va aquí).',
    householdId: reader.householdId,
    portrait: portrait ? { text: portrait.portrait, version: portrait.version, generatedAt: portrait.generatedAt.toISOString() } : null,
    peopleWithoutAccount: persons.map((p) => ({ id: p.id, alias: p.alias, ageBand: p.ageBand })),
    facts: facts.map((f) => ({
      id: f.id, about: f.subjectUserId ? (f.subjectUserId === userId ? 'tú' : 'otra persona de la casa') : f.subjectPersonId ? `persona sin cuenta ${f.subjectPersonId}` : 'la casa',
      type: f.type, value: f.value, origin: f.origin, confidence: f.confidence, evidence: f.evidence, validUntil: f.validUntil?.toISOString() ?? null,
      status: f.status, createdAt: f.createdAt.toISOString(), updatedAt: f.updatedAt.toISOString(),
    })),
    questions: questions.filter((q) => !q.subjectUserId || q.subjectUserId === userId).map((q) => ({ question: q.question, status: q.status, answer: q.answer, createdAt: q.createdAt.toISOString() })),
    history: changes.map((c) => ({ at: c.createdAt.toISOString(), action: c.action, factId: c.factId, type: c.factType, before: c.before, after: c.after, reason: c.reason, origin: c.origin })),
  }
}

/**
 * «Corregir» when the reader's words don't fit the type (a nuance, an
 * exception): the corrected fact is retired and their words are added to the
 * notes about the same subject, as theirs.
 */
export async function correctFactWithNote(userId: string, factId: string, input: { note: string; text: string }, opts: { db?: Db; now?: Date } = {}): Promise<void> {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  const f = await visibleFact(reader, factId, db)
  assertCanEdit(reader, f)
  await db.transaction(async (tx) => {
    await tx.update(profileFacts).set({ status: 'retired', updatedAt: now }).where(eq(profileFacts.id, f.id))
    await tx.insert(profileChanges).values({
      householdId: f.householdId, factId: f.id, action: 'fact_retired', factType: f.type,
      before: { value: f.value, confidence: f.confidence, origin: f.origin }, after: null,
      reason: `Lo corrigió en su ficha: «${input.text.slice(0, 200)}»`, origin: 'user', actorUserId: userId,
    })
    const [notes] = await tx.select().from(profileFacts).where(and(
      eq(profileFacts.householdId, f.householdId), eq(profileFacts.type, 'notes'), eq(profileFacts.status, 'active'),
      f.subjectUserId ? eq(profileFacts.subjectUserId, f.subjectUserId) : isNull(profileFacts.subjectUserId),
      f.subjectPersonId ? eq(profileFacts.subjectPersonId, f.subjectPersonId) : isNull(profileFacts.subjectPersonId),
    )).limit(1)
    const value = [...(Array.isArray(notes?.value) ? (notes!.value as string[]) : []), input.note].slice(-30)
    await upsertProfileFact(tx, {
      householdId: f.householdId, subjectUserId: f.subjectUserId, subjectPersonId: f.subjectPersonId, type: 'notes', value,
      origin: 'user', confidence: 1, evidence: { signal: 'profile', date: madridDate(now), summary: `Lo corrigió en su ficha: «${input.text.slice(0, 200)}»` },
      reason: 'Lo corrigió en su ficha', actorUserId: userId, now,
    })
    await mirrorToMemory(tx, await memoryOwners(tx, reader, f), f.type, null)
    await mirrorToMemory(tx, await memoryOwners(tx, reader, { type: 'notes', subjectUserId: f.subjectUserId, subjectPersonId: f.subjectPersonId }), 'notes', value)
  })
}

/** The fact as its reader sees it, for the correction prompt. */
export async function factForCorrection(userId: string, factId: string, opts: { db?: Db } = {}) {
  const db = opts.db ?? defaultDb
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  const f = await visibleFact(reader, factId, db)
  assertCanEdit(reader, f)
  const view = factView(factRow(f), { viewerId: userId, viewerRole: reader.role, actorUserId: null, names: {} })
  return { type: f.type, value: f.value, sentence: view?.sentence ?? f.type }
}

// ─── Mimo speaks about the ficha (PRO-319, D-051, D-064, D-110) ──────────

/** Whom «apunta que…» is about: the reader, the household, or a person without an account. */
export type FichaAbout = 'me' | 'household' | 'person'

/** Pure: two lists joined without repeats (case and accents as written; the same text twice is one). */
export function mergeListValues(current: unknown, next: unknown): unknown {
  if (!Array.isArray(current) || !Array.isArray(next)) return next
  const seen = new Set<string>()
  const out: unknown[] = []
  for (const x of [...current, ...next]) {
    const k = typeof x === 'string' ? x.trim().toLowerCase() : JSON.stringify(x)
    if (seen.has(k)) continue
    seen.add(k)
    out.push(x)
  }
  return out
}

/**
 * Pure: the subject of a fact Mimo writes. Health is always about a person;
 * «proteína en cada plato» is about whoever says it (or a person without an
 * account), never the whole household.
 */
export function fichaSubjectFor(
  type: string,
  about: FichaAbout,
  readerId: string,
  personId: string | null,
): { subjectUserId: string | null; subjectPersonId: string | null } {
  if (about === 'person' && personId) return { subjectUserId: null, subjectPersonId: personId }
  if (about === 'household' && (isHealthProfileFactType(type) || type === 'protein_minimum')) return { subjectUserId: readerId, subjectPersonId: null }
  if (about === 'household') return { subjectUserId: null, subjectPersonId: null }
  return { subjectUserId: readerId, subjectPersonId: null }
}

/**
 * «Apunta que…» (Mimo, web chat and WhatsApp): the reader says something
 * about themselves, the household or a person without an account. Origin
 * `user`, confidence 1, evidence «Se lo dijiste a Mimo…». Never health from
 * WhatsApp (`canWriteProfileFact`), health on the web only with the consent.
 * A list (dislikes, notes…) adds to what is there instead of replacing it.
 */
export async function writeProfileFact(
  userId: string,
  input: { type: string; value: unknown; about: FichaAbout; personId?: string | null; validUntil?: Date | null; channel: 'web' | 'whatsapp' },
  opts: { db?: Db; now?: Date } = {},
): Promise<{ factId: string; action: 'added' | 'updated' | 'unchanged'; sentence: string | null }> {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  if (reader.role === 'child') throw new FichaError(403, 'CHILD', 'La ficha la cambian los adultos de la casa')
  const schema = PROFILE_FACT_VALUE_SCHEMAS[input.type as keyof typeof PROFILE_FACT_VALUE_SCHEMAS]
  if (!schema) throw new FichaError(422, 'UNKNOWN_TYPE', `No conozco el tipo «${input.type}»`)
  const allowed = canWriteProfileFact({ type: input.type, channel: input.channel, hasHealthConsent: await hasHealthConsent(userId) })
  if (!allowed.ok) {
    throw allowed.reason === 'health_from_whatsapp'
      ? new FichaError(403, 'HEALTH_FROM_WHATSAPP', 'Por WhatsApp no guardo datos de salud: se cambian en Tu ficha, en la web')
      : new FichaError(403, 'HEALTH_CONSENT_REQUIRED', 'Para guardar datos de salud necesitas dar tu consentimiento en Perfil')
  }
  // Over WhatsApp not even a note that talks about health (LEG-03): «apunta que soy celíaca» stays out.
  if (input.channel === 'whatsapp' && mentionsHealth(JSON.stringify(input.value ?? ''))) {
    throw new FichaError(403, 'HEALTH_FROM_WHATSAPP', 'Por WhatsApp no guardo datos de salud: se cambian en Tu ficha, en la web')
  }
  let personId: string | null = null
  if (input.about === 'person') {
    const [p] = input.personId
      ? await db.select({ id: householdPersons.id }).from(householdPersons)
        .where(and(eq(householdPersons.id, input.personId), eq(householdPersons.householdId, reader.householdId))).limit(1)
      : []
    if (!p) throw new FichaError(404, 'NO_PERSON', 'Esa persona no está en tu casa')
    personId = p.id
  }
  const subject = fichaSubjectFor(input.type, input.about, userId, personId)
  const signal = input.channel === 'whatsapp' ? 'whatsapp' : 'chat'
  return db.transaction(async (tx) => {
    const [current] = await tx.select().from(profileFacts).where(and(
      eq(profileFacts.householdId, reader.householdId), eq(profileFacts.type, input.type), eq(profileFacts.status, 'active'),
      subject.subjectUserId ? eq(profileFacts.subjectUserId, subject.subjectUserId) : isNull(profileFacts.subjectUserId),
      subject.subjectPersonId ? eq(profileFacts.subjectPersonId, subject.subjectPersonId) : isNull(profileFacts.subjectPersonId),
    )).orderBy(desc(profileFacts.updatedAt)).limit(1)
    const merged = current ? mergeListValues(current.value, input.value) : input.value
    const parsed = schema.safeParse(merged)
    if (!parsed.success) {
      throw new FichaError(422, 'INVALID_VALUE', `No he sabido apuntarlo así: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'valor'} ${i.message}`).join('; ')}`)
    }
    const out = await upsertProfileFact(tx, {
      householdId: reader.householdId, ...subject, type: input.type, value: parsed.data,
      origin: 'user', confidence: 1, evidence: signalEvidence(signal, input.type, parsed.data, now),
      validUntil: input.validUntil, reason: signal === 'whatsapp' ? 'Se lo dijo a Mimo por WhatsApp' : 'Se lo dijo a Mimo en la web',
      actorUserId: userId, now,
    })
    await mirrorToMemory(tx, await memoryOwners(tx, reader, { type: input.type, ...subject }), input.type, parsed.data)
    const who = subject.subjectUserId ? 'tu' : subject.subjectPersonId ? 'otra' : 'casa'
    return { ...out, sentence: factSentence(input.type, parsed.data, who, input.validUntil ?? null) }
  })
}

/**
 * Pure: may Mimo ask the pending question now? At most one a week to each
 * person, and on WhatsApp only inside the 24 h window (Meta: free text only
 * within 24 h of the person's last message).
 */
export function mimoMayAskQuestion(input: {
  lastAskedAt: Date | null
  channel: 'web' | 'whatsapp'
  lastInboundAt: Date | null
  now: Date
}): { ok: true } | { ok: false; reason: 'weekly_cap' | 'outside_window' } {
  const { now } = input
  if (input.channel === 'whatsapp' && (!input.lastInboundAt || now.getTime() - input.lastInboundAt.getTime() >= SERVICE_WINDOW_MS)) {
    return { ok: false, reason: 'outside_window' }
  }
  if (input.lastAskedAt && now.getTime() - input.lastAskedAt.getTime() < FICHA_QUESTION_EVERY_DAYS * 24 * 3600 * 1000) {
    return { ok: false, reason: 'weekly_cap' }
  }
  return { ok: true }
}

/** When Mimo last asked this person a pending question (a `question_asked` history row). */
async function lastMimoQuestionAt(householdId: string, userId: string, db: Db): Promise<Date | null> {
  const [row] = await db.select({ at: profileChanges.createdAt }).from(profileChanges)
    .where(and(eq(profileChanges.householdId, householdId), eq(profileChanges.action, 'question_asked'), eq(profileChanges.actorUserId, userId)))
    .orderBy(desc(profileChanges.createdAt)).limit(1)
  return row?.at ?? null
}

/** The question Mimo may ask this reader (pending, theirs or the household's, none of health on WhatsApp). */
async function questionForMimo(reader: FichaReader, channel: 'web' | 'whatsapp', now: Date, db: Db) {
  const questions = await db.select().from(profileQuestions)
    .where(and(eq(profileQuestions.householdId, reader.householdId), eq(profileQuestions.status, 'pending')))
    .orderBy(asc(profileQuestions.createdAt))
  const fit = questions.filter((q) => !(channel === 'whatsapp' && (mentionsHealth(q.question) || (q.factType && isHealthProfileFactType(q.factType)))))
  return pickQuestion(fit, now, reader.userId)
}

/**
 * Mimo asks the pending question (PRO-319): the question, when one is due,
 * recorded as asked (`question_asked`, so the next one waits a week); or why
 * not. The reader answers with «Sí» / «No» / «Ahora no», as on the screen.
 */
export async function askPendingQuestion(userId: string, input: { channel: 'web' | 'whatsapp' }, opts: { db?: Db; now?: Date } = {}): Promise<FichaAskView> {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  if (reader.role === 'child') return { question: null, reason: 'none' }
  const [link] = input.channel === 'whatsapp'
    ? await db.select({ at: whatsappLinks.lastInboundAt }).from(whatsappLinks).where(eq(whatsappLinks.userId, userId)).limit(1)
    : []
  const may = mimoMayAskQuestion({ lastAskedAt: await lastMimoQuestionAt(reader.householdId, userId, db), channel: input.channel, lastInboundAt: link?.at ?? null, now })
  if (!may.ok) return { question: null, reason: may.reason }
  const q = await questionForMimo(reader, input.channel, now, db)
  if (!q) return { question: null, reason: 'none' }
  const [fact] = q.factType
    ? await db.select({ id: profileFacts.id }).from(profileFacts).where(and(
      eq(profileFacts.householdId, reader.householdId), eq(profileFacts.type, q.factType), eq(profileFacts.status, 'active'),
      q.subjectUserId ? eq(profileFacts.subjectUserId, q.subjectUserId) : isNull(profileFacts.subjectUserId),
      q.subjectPersonId ? eq(profileFacts.subjectPersonId, q.subjectPersonId) : isNull(profileFacts.subjectPersonId),
    )).orderBy(desc(profileFacts.updatedAt)).limit(1)
    : []
  await db.insert(profileChanges).values({
    householdId: reader.householdId, action: 'question_asked', factType: q.factType, before: null,
    after: { questionId: q.id, channel: input.channel }, reason: input.channel === 'whatsapp' ? 'Mimo lo preguntó por WhatsApp' : 'Mimo lo preguntó en la web',
    origin: 'ai_realtime', actorUserId: userId,
  })
  return {
    question: { id: q.id, question: q.question, subjectKey: q.subjectUserId ? `u:${q.subjectUserId}` : q.subjectPersonId ? `p:${q.subjectPersonId}` : 'casa', factId: fact?.id ?? null },
    reason: 'asked',
  }
}

/**
 * For Mimo's context: one line when a pending question is due for this
 * person this week (the tool then checks the WhatsApp window). Empty otherwise.
 */
export async function fichaQuestionHint(userId: string, opts: { db?: Db; now?: Date } = {}): Promise<string> {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const reader = await fichaReader(userId, db)
  if (!reader || reader.role === 'child') return ''
  const may = mimoMayAskQuestion({ lastAskedAt: await lastMimoQuestionAt(reader.householdId, userId, db), channel: 'web', lastInboundAt: null, now })
  if (!may.ok) return ''
  const q = await questionForMimo(reader, 'web', now, db)
  if (!q) return ''
  return 'Ficha: tienes una pregunta pendiente para esta persona esta semana. Hazla solo en un momento natural (al ensenar el menu, al cerrar algo que pidio), nunca en medio de otra tarea ni junto a otra pregunta: llama a get_ficha_question y, si te la da, preguntala con tus palabras con [[opciones: Sí | No | Ahora no]].'
}
