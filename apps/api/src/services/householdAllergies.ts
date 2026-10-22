/**
 * PRO-271 · «Preguntar alergias y dieta al entrar en una casa» (Seguridad).
 *
 * Who in the household has told Mimoia their allergies and diet, and every
 * member's restrictions together for the menu.
 *
 * «Ha contestado» (answered) is: the person has restrictions saved (profile
 * or Mimo's memory) **or** the health-data consent in force. Restrictions are
 * only stored with that consent (PRO-21), and every screen that asks them
 * (the web sign-up, «Tu menú está listo», the profile and the new screen after
 * accepting an invitation) only saves with the box ticked; so consent in force
 * with nothing saved means «contestó que ninguna». No consent and nothing
 * saved means «no ha contestado» (WhatsApp sign-up that skipped the question,
 * a member who joined by invitation before PRO-271, consent withdrawn…).
 *
 * Spec: specs/household.md → «Alergias y dieta al entrar en una casa».
 */
import { inArray } from 'drizzle-orm'
import { isHealthConsentActive } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { userMemories, users } from '../db/schema.js'
import { mergeRestrictions } from './dietaryRestrictions.js'
import { householdMemberIds } from './tasteStore.js'

/** `GET /households/me/allergies` (mirrored in the web's `HouseholdAllergiesNotice`). */
export interface HouseholdAllergiesStatus {
  /** The caller has answered (allergies saved, or consent with «ninguna»). */
  meAnswered: boolean
  /** Other members who haven't answered, by username. */
  pending: string[]
  /** At least one person in the household has answered. */
  anyAnswered: boolean
}

export interface AllergyAnswerInput {
  restrictions?: readonly string[] | null
  memoryRestrictions?: unknown
  consentAt: Date | string | null
  withdrawnAt: Date | string | null
}

/** Pure: has this person answered the allergies and diet question? */
export function allergiesAnswered(p: AllergyAnswerInput): boolean {
  const saved = mergeRestrictions(p.restrictions, { restrictions: { value: p.memoryRestrictions } })
  if (saved.length > 0) return true
  return isHealthConsentActive(p.consentAt, p.withdrawnAt)
}

export interface AllergyMember extends AllergyAnswerInput {
  userId: string
  username: string
}

/** Pure: the household's status as `/menu` reads it. */
export function householdAllergiesStatus(members: readonly AllergyMember[], meId: string): HouseholdAllergiesStatus {
  const rows = members.map((m) => ({ userId: m.userId, username: m.username, answered: allergiesAnswered(m), isMe: m.userId === meId }))
  const me = rows.find((r) => r.isMe)
  return {
    meAnswered: me?.answered ?? false,
    pending: rows.filter((r) => !r.answered && !r.isMe).map((r) => r.username),
    anyAnswered: rows.some((r) => r.answered),
  }
}

async function loadMembers(userId: string, db: typeof defaultDb): Promise<AllergyMember[]> {
  const ids = await householdMemberIds(userId, db)
  const [profiles, memories] = await Promise.all([
    db
      .select({
        id: users.id,
        username: users.username,
        restrictions: users.restrictions,
        consentAt: users.healthConsentAt,
        withdrawnAt: users.healthConsentWithdrawnAt,
      })
      .from(users)
      .where(inArray(users.id, ids)),
    db
      .select({ userId: userMemories.userId, key: userMemories.key, value: userMemories.value })
      .from(userMemories)
      .where(inArray(userMemories.userId, ids)),
  ])
  return profiles.map((p) => ({
    userId: p.id,
    username: p.username,
    restrictions: p.restrictions ?? [],
    memoryRestrictions: memories.find((m) => m.userId === p.id && m.key === 'restrictions')?.value,
    consentAt: p.consentAt,
    withdrawnAt: p.withdrawnAt,
  }))
}

export async function loadHouseholdAllergiesStatus(userId: string, db: typeof defaultDb = defaultDb): Promise<HouseholdAllergiesStatus> {
  return householdAllergiesStatus(await loadMembers(userId, db), userId)
}

/**
 * Pure: every member's restrictions in one list (deduped like
 * `mergeRestrictions`), the caller's first.
 */
export function unionMemberRestrictions(members: readonly Pick<AllergyMember, 'restrictions' | 'memoryRestrictions'>[]): string[] {
  const all: string[] = []
  for (const m of members) all.push(...mergeRestrictions(m.restrictions, { restrictions: { value: m.memoryRestrictions } }))
  return mergeRestrictions(all)
}

/**
 * Everyone's allergies and diets in the household, for the weekly menu: the
 * owner generating the week must not bring back the shrimp a member said
 * they're allergic to.
 */
export async function loadHouseholdRestrictions(userId: string, db: typeof defaultDb = defaultDb): Promise<string[]> {
  return unionMemberRestrictions(await loadMembers(userId, db))
}

/**
 * PRO-305 (Seguridad): `own` (the menu owner's profile + memory restrictions)
 * plus every other member's, for every path that picks a recipe for the
 * household's menu — the weekly generator, «Cambiar al azar», adding a meal,
 * regenerating one dish and Mimo's `swap_meal`. A read error of the household
 * keeps the owner's own (never fails the pick).
 */
export async function withHouseholdRestrictions(
  own: readonly string[],
  userId: string,
  db: typeof defaultDb = defaultDb,
  load: (userId: string, db: typeof defaultDb) => Promise<string[]> = loadHouseholdRestrictions,
): Promise<string[]> {
  return mergeRestrictions([...own, ...(await load(userId, db).catch(() => [] as string[]))])
}
