/**
 * PRO-1203 · «Quién come», persona a persona (maqueta del perfil, Miguel 2026-11-12).
 *
 * One row per person of the house in Perfil: the members with an account and
 * the people without one (`household_persons`, as in «Tu ficha»), each with
 * their age or «adulto», their allergies and diet and what they don't like.
 *
 * **The size of the house comes from the people.** The shopping list and the
 * menu keep reading the account's counts (`users.adults`, `users.kids_2_to_10`,
 * `multiplierForUser`), so nothing changes for a house whose people are
 * already there. The counts only move when the people do:
 *   - adding someone raises their group up to the people listed;
 *   - removing someone lowers it by one, never below the people listed.
 * A house that only has the old counter (2 adults, 1 child and nobody listed)
 * keeps it: what the counter says and nobody describes yet shows as a row
 * «Otro adulto» / «Un niño» that can be described (it becomes that person) or
 * removed (the counter goes down). So `householdMultiplier` is the same as
 * before the change until the household touches its people.
 *
 * **Allergies of a person without an account** live in the ficha
 * (`profile_facts`, type `restrictions`, about that person) and the menu reads
 * them with everyone else's (`householdAllergies.loadHouseholdRestrictions`).
 * They are health data: written only with the writer's consent (PRO-21).
 * Another member's allergies are theirs (art. 9): their row only says whether
 * they've answered.
 *
 * Spec: specs/household.md → «Quién come».
 */
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm'
import {
  householdSizeToCounts,
  isHealthConsentActive,
  PROFILE_FACT_VALUE_SCHEMAS,
  type HouseholdSize,
} from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { householdMembers, householdPersons, households, profileFacts, userMemories, users } from '../db/schema.js'
import { mergeRestrictions } from './dietaryRestrictions.js'
import { allergiesAnswered } from './householdAllergies.js'
import { hasHealthConsent, healthConsentCoversReligion, religiousDietsIn, RELIGION_CONSENT_MESSAGE } from './healthConsent.js'
import { fichaReader, FichaError } from './profile/fichaStore.js'
import { retireProfileFacts, signalEvidence, upsertProfileFact } from './profile/writer.js'
import { alignHouseholdMemory } from './userMemoryStore.js'

type Db = typeof defaultDb

/** How a person counts for the shopping list: adults from 11, children 2–10 (half a serving), under 2 not at all. */
export type SizeGroup = 'adult' | 'kid' | 'none'

export interface HouseholdCounts {
  adults: number
  kidsCount: number
}

/** Pure: a person without an account by age band. «6–12» counts as a child, «13–17» as an adult. */
export function groupOfAgeBand(band: string | null | undefined): SizeGroup {
  if (band === 'adulto' || band === '13-17') return 'adult'
  if (band === '3-5' || band === '6-12') return 'kid'
  return 'none'
}

/** Pure: a member with an account by role (a «Niñ@» account counts as a child). */
export function groupOfRole(role: string | null | undefined): SizeGroup {
  return role === 'child' ? 'kid' : 'adult'
}

/** Pure: how many adults and children the listed people are. */
export function countGroups(groups: readonly SizeGroup[]): HouseholdCounts {
  return {
    adults: groups.filter((g) => g === 'adult').length,
    kidsCount: groups.filter((g) => g === 'kid').length,
  }
}

/** Pure: the counts the shopping list reads today (the old enum for a very old account, as `multiplierForUser`). */
export function storedCounts(u: { adults?: number | null; kidsCount?: number | null; householdSize?: string | null } | null | undefined): HouseholdCounts {
  if (u && typeof u.adults === 'number' && u.adults > 0) return { adults: u.adults, kidsCount: u.kidsCount ?? 0 }
  return householdSizeToCounts(u?.householdSize as HouseholdSize | null | undefined)
}

/**
 * Pure: the counts after the people changed. `listed` = the people listed
 * after the change. Removing lowers that group by one (never below the
 * listed); adding raises it up to the listed (an undescribed «Otro adulto»
 * becomes the one just added). At least one adult.
 */
export function countsAfterChange(
  stored: HouseholdCounts,
  listed: HouseholdCounts,
  change: { added?: SizeGroup; removed?: SizeGroup },
): HouseholdCounts {
  let { adults, kidsCount } = stored
  if (change.removed === 'adult') adults -= 1
  if (change.removed === 'kid') kidsCount -= 1
  return {
    adults: Math.max(1, adults, listed.adults),
    kidsCount: Math.max(0, kidsCount, listed.kidsCount),
  }
}

/** Pure: the rows the counts have and nobody describes yet («Otro adulto», «Un niño»). */
export function undescribed(stored: HouseholdCounts, listed: HouseholdCounts): HouseholdCounts {
  return {
    adults: Math.max(0, stored.adults - listed.adults),
    kidsCount: Math.max(0, stored.kidsCount - listed.kidsCount),
  }
}

/** Pure: a list as written by hand: trimmed, lower case, without repeats. */
export function cleanList(values: readonly unknown[]): string[] {
  const out: string[] = []
  for (const v of values) {
    if (typeof v !== 'string') continue
    const t = v.trim().toLowerCase()
    if (t && !out.includes(t)) out.push(t)
  }
  return out
}

const inForce = (f: { status: string; validUntil: Date | null }, now: Date) =>
  f.status === 'active' && (!f.validUntil || f.validUntil.getTime() > now.getTime())

function stringList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0) : []
}

// ─── The view ───────────────────────────────────────────────────

export interface PersonRow {
  /** `me`, the member's user id, the person's id, or `extra-adult-1` / `extra-kid-1`. */
  id: string
  kind: 'me' | 'member' | 'person' | 'extra'
  /** Username, the alias of a person without an account, or «Otro adulto» / «Un niño». */
  name: string
  role: 'owner' | 'member' | 'child' | null
  ageBand: string | null
  group: SizeGroup
  /** Allergies and diet; null when the reader may not see them (another member's, art. 9). */
  restrictions: string[] | null
  /** Another member: has told us their allergies and diet (PRO-271). */
  answered: boolean | null
  dislikes: string[] | null
  /** The reader may change this row (themselves, a person without an account, an undescribed one). */
  canEdit: boolean
}

export interface HouseholdPeopleView {
  people: PersonRow[]
  /** What the shopping list and the menu count. */
  counts: HouseholdCounts
  /** The reader's health-data consent (needed to write allergies). */
  healthConsent: boolean
  /** A «Niñ@» account reads the list but changes only itself. */
  canEdit: boolean
}

async function ownerCounts(householdId: string, db: Db): Promise<HouseholdCounts> {
  const [row] = await db
    .select({ adults: users.adults, kidsCount: users.kidsCount, householdSize: users.householdSize })
    .from(households)
    .innerJoin(users, eq(users.id, households.ownerId))
    .where(eq(households.id, householdId))
    .limit(1)
  return storedCounts(row)
}

async function listedGroups(householdId: string, db: Db): Promise<SizeGroup[]> {
  const [members, persons] = await Promise.all([
    db.select({ role: householdMembers.role }).from(householdMembers).where(eq(householdMembers.householdId, householdId)),
    db.select({ ageBand: householdPersons.ageBand }).from(householdPersons).where(eq(householdPersons.householdId, householdId)),
  ])
  return [...members.map((m) => groupOfRole(m.role)), ...persons.map((p) => groupOfAgeBand(p.ageBand))]
}

/** `GET /households/me/people`: «Quién come» for its reader. */
export async function loadHouseholdPeople(userId: string, opts: { db?: Db; now?: Date } = {}): Promise<HouseholdPeopleView> {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  const adult = reader.role !== 'child'

  const members = await db
    .select({
      id: users.id,
      username: users.username,
      role: householdMembers.role,
      restrictions: users.restrictions,
      consentAt: users.healthConsentAt,
      withdrawnAt: users.healthConsentWithdrawnAt,
      noneAt: users.allergiesNoneAt,
    })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, reader.householdId))
    .orderBy(asc(householdMembers.joinedAt))
  const memberIds = members.map((m) => m.id)
  const [memories, persons, counts] = await Promise.all([
    memberIds.length
      ? db.select({ userId: userMemories.userId, key: userMemories.key, value: userMemories.value })
        .from(userMemories)
        .where(and(inArray(userMemories.userId, memberIds), inArray(userMemories.key, ['restrictions', 'dislikes'])))
      : Promise.resolve([] as Array<{ userId: string; key: string; value: unknown }>),
    db.select().from(householdPersons).where(eq(householdPersons.householdId, reader.householdId)).orderBy(asc(householdPersons.createdAt)),
    ownerCounts(reader.householdId, db),
  ])
  const personIds = persons.map((p) => p.id)
  const facts = personIds.length
    ? await db.select().from(profileFacts).where(and(
      eq(profileFacts.householdId, reader.householdId),
      inArray(profileFacts.subjectPersonId, personIds),
      inArray(profileFacts.type, ['restrictions', 'dislikes']),
    ))
    : []
  const memoryOf = (id: string, key: string) => memories.find((m) => m.userId === id && m.key === key)?.value
  const factList = (personId: string, type: string) => {
    const out: string[] = []
    for (const f of facts) if (f.subjectPersonId === personId && f.type === type && inForce(f, now)) out.push(...stringList(f.value))
    return cleanList(out)
  }

  const people: PersonRow[] = []
  const me = members.find((m) => m.id === userId)
  if (me) {
    people.push({
      id: 'me', kind: 'me', name: me.username, role: me.role as PersonRow['role'], ageBand: null, group: groupOfRole(me.role),
      // What the menu reads for this person: the account and Mimo's memory (`mergeRestrictions`).
      restrictions: mergeRestrictions(me.restrictions, { restrictions: { value: memoryOf(me.id, 'restrictions') } }),
      answered: allergiesAnswered({ restrictions: me.restrictions, memoryRestrictions: memoryOf(me.id, 'restrictions'), consentAt: me.consentAt, withdrawnAt: me.withdrawnAt, noneAt: me.noneAt }),
      dislikes: cleanList(stringList(memoryOf(me.id, 'dislikes'))),
      canEdit: true,
    })
  }
  for (const m of members) {
    if (m.id === userId) continue
    people.push({
      id: m.id, kind: 'member', name: m.username, role: m.role as PersonRow['role'], ageBand: null, group: groupOfRole(m.role),
      restrictions: null,
      answered: allergiesAnswered({ restrictions: m.restrictions, memoryRestrictions: memoryOf(m.id, 'restrictions'), consentAt: m.consentAt, withdrawnAt: m.withdrawnAt, noneAt: m.noneAt }),
      dislikes: adult ? cleanList(stringList(memoryOf(m.id, 'dislikes'))) : null,
      canEdit: false,
    })
  }
  for (const p of persons) {
    people.push({
      id: p.id, kind: 'person', name: p.alias, role: null, ageBand: p.ageBand, group: groupOfAgeBand(p.ageBand),
      restrictions: adult ? factList(p.id, 'restrictions') : null,
      answered: null,
      dislikes: adult ? factList(p.id, 'dislikes') : null,
      canEdit: adult,
    })
  }
  const extra = undescribed(counts, countGroups(people.map((p) => p.group)))
  for (let i = 1; i <= extra.adults; i++) {
    people.push({ id: `extra-adult-${i}`, kind: 'extra', name: 'Otro adulto', role: null, ageBand: null, group: 'adult', restrictions: null, answered: null, dislikes: null, canEdit: adult })
  }
  for (let i = 1; i <= extra.kidsCount; i++) {
    people.push({ id: `extra-kid-${i}`, kind: 'extra', name: 'Un niño', role: null, ageBand: null, group: 'kid', restrictions: null, answered: null, dislikes: null, canEdit: adult })
  }
  return {
    people,
    counts,
    healthConsent: isHealthConsentActive(me?.consentAt ?? null, me?.withdrawnAt ?? null),
    canEdit: adult,
  }
}

// ─── The size of the house ──────────────────────────────────────

/**
 * After the people changed: the household's new counts, written to every
 * account whose primary household this is (the list and the menu read the
 * account of whoever made the menu) and to Mimo's memory copy when it has
 * one. Returns the counts.
 */
export async function syncHouseholdSize(
  householdId: string,
  change: { added?: SizeGroup; removed?: SizeGroup },
  opts: { db?: Db } = {},
): Promise<HouseholdCounts> {
  const db = opts.db ?? defaultDb
  const [stored, groups] = await Promise.all([ownerCounts(householdId, db), listedGroups(householdId, db)])
  const next = countsAfterChange(stored, countGroups(groups), change)
  if (next.adults === stored.adults && next.kidsCount === stored.kidsCount) return next
  const accounts = await db
    .update(users)
    .set({ adults: next.adults, kidsCount: next.kidsCount })
    .where(and(eq(users.primaryHouseholdId, householdId), isNotNull(users.primaryHouseholdId)))
    .returning({ id: users.id })
  for (const a of accounts) await alignHouseholdMemory(a.id, next).catch((err) => console.warn('[quien-come] memory counts:', (err as Error)?.message ?? err))
  return next
}

/** Same, never failing the request that changed the people (logged). */
export async function syncHouseholdSizeSafely(householdId: string | null | undefined, change: { added?: SizeGroup; removed?: SizeGroup }): Promise<void> {
  if (!householdId) return
  try {
    await syncHouseholdSize(householdId, change)
  } catch (err) {
    console.warn('[quien-come] household size:', (err as Error)?.message ?? err)
  }
}

/** «No está» on an undescribed «Otro adulto» / «Un niño»: one fewer. */
export async function removeUndescribed(userId: string, group: 'adult' | 'kid', opts: { db?: Db } = {}): Promise<HouseholdCounts> {
  const db = opts.db ?? defaultDb
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  if (reader.role === 'child') throw new FichaError(403, 'CHILD', 'Las personas de la casa las cambian los adultos')
  const [stored, groups] = await Promise.all([ownerCounts(reader.householdId, db), listedGroups(reader.householdId, db)])
  const extra = undescribed(stored, countGroups(groups))
  if ((group === 'adult' ? extra.adults : extra.kidsCount) < 1) throw new FichaError(404, 'NOT_FOUND', 'No hay nadie así sin describir')
  return syncHouseholdSize(reader.householdId, { removed: group }, { db })
}

// ─── Allergies and dislikes of a person without an account ──────

export type PersonListType = 'restrictions' | 'dislikes'

/**
 * The whole list of a person without an account (what is there is replaced;
 * empty = none). Allergies and diet are health data: only with the writer's
 * consent, and halal only with the current text (E-19). The household's saved
 * menus are reviewed after a change of allergies (PRO-364).
 */
export async function setPersonList(
  userId: string,
  personId: string,
  type: PersonListType,
  values: readonly unknown[],
  opts: { db?: Db; now?: Date } = {},
): Promise<string[]> {
  const db = opts.db ?? defaultDb
  const now = opts.now ?? new Date()
  const reader = await fichaReader(userId, db)
  if (!reader) throw new FichaError(404, 'NO_HOUSEHOLD', 'Sin hogar')
  if (reader.role === 'child') throw new FichaError(403, 'CHILD', 'Las personas de la casa las cambian los adultos')
  const [person] = await db.select({ id: householdPersons.id }).from(householdPersons)
    .where(and(eq(householdPersons.id, personId), eq(householdPersons.householdId, reader.householdId))).limit(1)
  if (!person) throw new FichaError(404, 'NO_PERSON', 'Esa persona no está en tu casa')
  const list = cleanList(values)
  if (type === 'restrictions') {
    if (!(await hasHealthConsent(userId))) {
      throw new FichaError(403, 'HEALTH_CONSENT_REQUIRED', 'Para guardar alergias necesitas dar tu consentimiento de datos de salud')
    }
    if (religiousDietsIn(list).length > 0 && !(await healthConsentCoversReligion(userId))) {
      throw new FichaError(403, 'RELIGION_CONSENT_REQUIRED', RELIGION_CONSENT_MESSAGE)
    }
  }
  const parsed = PROFILE_FACT_VALUE_SCHEMAS[type].safeParse(list)
  if (!parsed.success) throw new FichaError(422, 'INVALID_VALUE', 'Lista no válida')

  let review: (() => Promise<void>) | null = null
  if (type === 'restrictions') {
    const { householdRestrictionsBefore, reviewHouseholdMenusSafely } = await import('./menuRestrictionsReview.js')
    const before = await householdRestrictionsBefore(userId)
    review = async () => { await reviewHouseholdMenusSafely(userId, before) }
  }
  const subject = { householdId: reader.householdId, subjectUserId: null, subjectPersonId: person.id, type }
  await db.transaction(async (tx) => {
    // The menu reads every fact in force: with more than one (Mimo wrote one too), start again from one.
    const current = await tx.select({ id: profileFacts.id }).from(profileFacts).where(and(
      eq(profileFacts.householdId, reader.householdId), eq(profileFacts.subjectPersonId, person.id),
      eq(profileFacts.type, type), eq(profileFacts.status, 'active'),
    ))
    if (list.length === 0 || current.length > 1) {
      await retireProfileFacts(tx, { ...subject, reason: 'Lo cambió en Quién come', origin: 'user', actorUserId: userId, now })
      if (list.length === 0) return
    }
    await upsertProfileFact(tx, {
      ...subject, value: list, origin: 'user', confidence: 1,
      evidence: signalEvidence('profile', type, list, now),
      reason: 'Lo cambió en Quién come', actorUserId: userId, now,
    })
  })
  if (review) await review()
  return list
}

/** The household and size group of a person without an account, before a change (null if not in the reader's house). */
export async function personBefore(userId: string, personId: string, opts: { db?: Db } = {}): Promise<{ householdId: string; group: SizeGroup } | null> {
  const db = opts.db ?? defaultDb
  const reader = await fichaReader(userId, db)
  if (!reader) return null
  const [p] = await db.select({ ageBand: householdPersons.ageBand }).from(householdPersons)
    .where(and(eq(householdPersons.id, personId), eq(householdPersons.householdId, reader.householdId))).limit(1)
  return p ? { householdId: reader.householdId, group: groupOfAgeBand(p.ageBand) } : null
}

/** The reader's primary household (for the routes that changed the people). */
export async function readerHouseholdId(userId: string, opts: { db?: Db } = {}): Promise<string | null> {
  return (await fichaReader(userId, opts.db ?? defaultDb))?.householdId ?? null
}
