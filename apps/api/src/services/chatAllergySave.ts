/**
 * PRO-1305 · The glue between Mimo's tools and `chatAllergies`: who the
 * allergy is about (the person who writes or someone without an account, by
 * the alias), what is saved for them now and how it is written under the
 * chat's permission. Spec: specs/privacy.md → «Alergias dichas en el chat».
 */
import { and, eq } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { householdPersons, profileFacts, users, userMemories } from '../db/schema.js'
import {
  chatAllergyChannel,
  currentOutbox,
  noteDeleted,
  noteSaidAllergies,
  noteSummary,
  noteWithdrawAsk,
  saidByCode,
  chatSavable,
  type AnswerDeps,
  type ChatAllergyChannel,
  type SaidSubject,
} from './chatAllergies.js'
import { mergeRestrictions, restrictionKey } from './dietaryRestrictions.js'
import { personRestrictionsInForce } from './householdAllergies.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'

type Db = typeof defaultDb

interface Ctx {
  userId: string
  db?: any
  channel?: string
  surface?: string
}

/** The person's own saved restrictions (profile column + Mimo's memory). */
export async function ownRestrictions(userId: string, db: Db = defaultDb): Promise<string[]> {
  const [[u], mem] = await Promise.all([
    db.select({ restrictions: users.restrictions }).from(users).where(eq(users.id, userId)).limit(1),
    db.select({ value: userMemories.value }).from(userMemories).where(and(eq(userMemories.userId, userId), eq(userMemories.key, 'restrictions'))).limit(1),
  ])
  return mergeRestrictions(u?.restrictions ?? [], { restrictions: { value: mem[0]?.value } })
}

async function personRestrictions(userId: string, personId: string, db: Db): Promise<string[]> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return []
  const facts = await db
    .select({ value: profileFacts.value, status: profileFacts.status, validUntil: profileFacts.validUntil })
    .from(profileFacts)
    .where(and(eq(profileFacts.householdId, householdId), eq(profileFacts.subjectPersonId, personId), eq(profileFacts.type, 'restrictions'), eq(profileFacts.status, 'active')))
  return personRestrictionsInForce(facts)
}

/** «la peque» → the person without an account of the household (null: not found). */
export async function findPerson(userId: string, alias: string, db: Db = defaultDb): Promise<{ id: string; alias: string; ageBand: string } | null> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return null
  const people = await db.select({ id: householdPersons.id, alias: householdPersons.alias, ageBand: householdPersons.ageBand }).from(householdPersons).where(eq(householdPersons.householdId, householdId))
  const wanted = alias.trim().toLowerCase()
  return people.find((p) => p.alias.trim().toLowerCase() === wanted) ?? null
}

function signalOf(channel: ChatAllergyChannel): 'whatsapp' | 'chat' {
  return channel === 'whatsapp' ? 'whatsapp' : 'chat'
}

/** Saves the whole list for a subject, under the chat's permission (checked by the caller). */
export async function writeSubjectList(userId: string, subject: SaidSubject, next: string[], channel: ChatAllergyChannel, db: Db = defaultDb): Promise<void> {
  if (subject.personId) {
    const { setPersonList } = await import('./householdPeople.js')
    await setPersonList(userId, subject.personId, 'restrictions', next, { db, chatAllergyPermit: true, reason: channel === 'whatsapp' ? 'Se lo dijo a Mimo por WhatsApp' : 'Se lo dijo a Mimo en la web' })
    return
  }
  const { setMemoryBatch } = await import('./userMemoryStore.js')
  await setMemoryBatch(userId, [{ key: 'restrictions', value: mergeRestrictions(next), source: 'manual', confidence: 1 }], 'manual', { signal: signalOf(channel), chatAllergyPermit: true })
}

function subjectSaved(userId: string, subject: SaidSubject, db: Db) {
  return () => (subject.personId ? personRestrictions(userId, subject.personId, db) : ownRestrictions(userId, db))
}

/**
 * A tool got an allergy (`raw`, about `person` when it's someone without an
 * account). Returns what to tell the model, or null when this chat doesn't
 * take allergies (Telegram, no outbox): then the caller keeps its old reply.
 */
export async function noteChatAllergies(ctx: Ctx, raw: unknown, person?: string | null): Promise<string | null> {
  const channel = chatAllergyChannel(ctx)
  if (!channel || !currentOutbox(ctx.userId)) return null
  if (chatSavable(raw).length === 0) return null
  const db: Db = ctx.db ?? defaultDb
  let subject: SaidSubject = { personId: null, alias: null }
  if (person && person.trim()) {
    const p = await findPerson(ctx.userId, person, db)
    if (!p) return `No he guardado nada: no hay nadie sin cuenta llamado «${person}» en la casa. Si es quien escribe, llama sin person; si es otra persona sin cuenta, que la añada en Perfil → Tu ficha → «+ Persona» (y mientras, sus menus no lo llevan si lo vuelve a decir).`
    subject = { personId: p.id, alias: p.alias, ageBand: p.ageBand }
  }
  const result = await noteSaidAllergies(ctx.userId, raw, subject, {
    db,
    saved: subjectSaved(ctx.userId, subject, db),
    write: (next) => writeSubjectList(ctx.userId, subject, next, channel, db),
  })
  return noteSummary(result)
}

/** «Borra lo del gluten» (C.7): takes it off and queues the notice. Null: not this chat. */
export async function deleteChatAllergies(ctx: Ctx, raw: unknown, person?: string | null): Promise<string | null> {
  const channel = chatAllergyChannel(ctx)
  if (!channel || !currentOutbox(ctx.userId)) return null
  const db: Db = ctx.db ?? defaultDb
  const wanted = (Array.isArray(raw) ? raw : [raw]).filter((v): v is string => typeof v === 'string' && !!v.trim())
  if (wanted.length === 0) return null
  let subject: SaidSubject = { personId: null, alias: null }
  if (person && person.trim()) {
    const p = await findPerson(ctx.userId, person, db)
    if (!p) return `No he borrado nada: no hay nadie sin cuenta llamado «${person}» en la casa.`
    subject = { personId: p.id, alias: p.alias, ageBand: p.ageBand }
  }
  const saved = await subjectSaved(ctx.userId, subject, db)()
  const keys = new Set([...wanted.map(restrictionKey), ...chatSavable(wanted).map(restrictionKey)])
  const gone = saved.filter((r) => keys.has(restrictionKey(r)) || wanted.some((w) => restrictionKey(r).includes(restrictionKey(w)) && restrictionKey(w).length >= 4))
  if (gone.length === 0) return `No estaba guardado: ${wanted.join(', ')}. Lo guardado es: ${saved.join(', ') || 'nada'}. No he borrado nada.`
  const next = saved.filter((r) => !gone.includes(r))
  if (subject.personId) {
    const { setPersonList } = await import('./householdPeople.js')
    await setPersonList(ctx.userId, subject.personId, 'restrictions', next, { db, chatAllergyPermit: true, reason: 'Pidió a Mimo que lo borrara' })
  } else {
    // Off the profile's column and Mimo's memory (and its ficha copy).
    const [u] = await db.select({ restrictions: users.restrictions }).from(users).where(eq(users.id, ctx.userId)).limit(1)
    const goneKeys = new Set(gone.map(restrictionKey))
    await db.update(users).set({ restrictions: (u?.restrictions ?? []).filter((r) => !goneKeys.has(restrictionKey(r))) }).where(eq(users.id, ctx.userId))
    const { setMemoryBatch } = await import('./userMemoryStore.js')
    await setMemoryBatch(ctx.userId, [{ key: 'restrictions', value: next, source: 'manual', confidence: 1 }], 'manual', { signal: signalOf(channel), chatAllergyPermit: true })
  }
  const { clearPending } = await import('./chatAllergies.js')
  await clearPending(ctx.userId, { db, items: gone, personId: subject.personId })
  noteDeleted(ctx.userId, gone, subject)
  return `Borrado: ${gone.join(', ')}. El sistema le manda ahora el aviso «Borrado…» en un mensaje aparte: no lo repitas.`
}

/** «Retira el permiso»: the confirmation goes with two buttons. Null: not this chat. */
export function askWithdraw(ctx: Ctx): string | null {
  if (!chatAllergyChannel(ctx)) return null
  if (!noteWithdrawAsk(ctx.userId)) return null
  return 'El sistema le manda ahora la confirmacion con dos botones («Sí, retíralo» / «No»): no retires nada tu ni lo repitas. Hasta que pulse, no cambia nada.'
}

/**
 * Before Mimo answers: the allergies the person names in their own words
 * («soy alérgica al marisco»), read by the code. They are kept out of the
 * menus for 30 days at once and, the first time, the permission question
 * goes; saving is Mimo's (it knows whose they are).
 */
export async function noteSaidByCode(userId: string, text: string | null | undefined, db: Db = defaultDb): Promise<void> {
  const { strong, doubtful } = saidByCode(text)
  if (strong.length === 0 && doubtful.length === 0) return
  const { addPending, loadChatPermission } = await import('./chatAllergies.js')
  const saved = await ownRestrictions(userId, db).catch(() => [] as string[])
  const savedKeys = new Set(saved.map(restrictionKey))
  const fresh = [...strong, ...doubtful].filter((r) => !savedKeys.has(restrictionKey(r)))
  if (fresh.length === 0) return
  await addPending(userId, fresh, { db })
  // Never asked, a clear allergy: the question goes after this turn (it names what was said).
  const strongFresh = strong.filter((r) => !savedKeys.has(restrictionKey(r)))
  const outbox = currentOutbox(userId)
  if (!outbox || outbox.quiet || strongFresh.length === 0) return
  if ((await loadChatPermission(userId, db)).kind !== 'never') return
  const ask = outbox.items.find((i) => i.type === 'ask')
  if (ask && ask.type === 'ask') {
    for (const r of strongFresh) if (!ask.items.some((x) => restrictionKey(x.restriction) === restrictionKey(r))) ask.items.push({ restriction: r, personId: null, alias: null })
  } else outbox.items.push({ type: 'ask', items: strongFresh.map((r) => ({ restriction: r, personId: null, alias: null })) })
}

/** What answering a button needs (save and withdraw), for the channel that got the tap. */
export function answerDeps(userId: string, channel: ChatAllergyChannel, send: AnswerDeps['send'], db: Db = defaultDb): AnswerDeps {
  return {
    db,
    send,
    save: async (items, subject) => {
      const saved = await subjectSaved(userId, subject, db)()
      const keys = new Set(saved.map(restrictionKey))
      const fresh = chatSavable(items).filter((r) => !keys.has(restrictionKey(r)))
      if (fresh.length) await writeSubjectList(userId, subject, [...saved, ...fresh], channel, db)
      return fresh
    },
    withdraw: async (id) => {
      const { withdrawHealthConsent } = await import('./healthConsent.js')
      await withdrawHealthConsent(id, { db })
    },
  }
}
