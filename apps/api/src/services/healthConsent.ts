/**
 * Explicit consent for health data (RGPD art. 9.2.a, PRO-21).
 *
 * Health data = allergies / intolerances / restrictions and the physical
 * profile (sex, age, weight, height, activity). It lives in four places: the
 * `users` columns, `user_memories` (physical.*, restrictions), the profile
 * page's copy in `user_settings.template` and whatever the assistant writes
 * through those. Without consent none of them may hold it; withdrawing the
 * consent wipes all four.
 */
import { and, eq, inArray } from 'drizzle-orm'
import {
  HEALTH_CONSENT_VERSION,
  HEALTH_MEMORY_KEYS,
  HEALTH_PROFILE_FIELDS,
  isHealthConsentActive,
  needsHealthConsentPrompt,
  type HealthConsentState,
} from '@ona/shared'
import { db } from '../db/connection.js'
import { userMemories, users, userSettings } from '../db/schema.js'
import { env } from '../config/env.js'

/** What the assistant says when asked to store health data without consent. */
export const HEALTH_CONSENT_SKILL_REPLY = `No lo he guardado: las alergias, intolerancias y datos físicos son datos de salud y solo los guardo si das tu consentimiento en tu perfil: ${env.WEB_PUBLIC_URL}/profile`

export class HealthConsentRequiredError extends Error {
  readonly code = 'HEALTH_CONSENT_REQUIRED'
  constructor() {
    super('Para guardar datos de salud necesitas dar tu consentimiento en tu perfil.')
    this.name = 'HealthConsentRequiredError'
  }
}

export async function getHealthConsent(userId: string): Promise<HealthConsentState | null> {
  const [u] = await db
    .select({
      sex: users.sex,
      age: users.age,
      weight: users.weight,
      height: users.height,
      activityLevel: users.activityLevel,
      restrictions: users.restrictions,
      consentAt: users.healthConsentAt,
      version: users.healthConsentVersion,
      withdrawnAt: users.healthConsentWithdrawnAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!u) return null
  const memoryRows = await db
    .select({ key: userMemories.key })
    .from(userMemories)
    .where(and(eq(userMemories.userId, userId), inArray(userMemories.key, [...HEALTH_MEMORY_KEYS])))
    .limit(1)
  const hasHealthData =
    u.sex != null ||
    u.age != null ||
    u.weight != null ||
    u.height != null ||
    (u.activityLevel != null && u.activityLevel !== 'none') ||
    (u.restrictions?.length ?? 0) > 0 ||
    memoryRows.length > 0
  return {
    active: isHealthConsentActive(u.consentAt, u.withdrawnAt),
    consentAt: u.consentAt?.toISOString() ?? null,
    version: u.version,
    withdrawnAt: u.withdrawnAt?.toISOString() ?? null,
    hasHealthData,
    needsPrompt: needsHealthConsentPrompt({ hasHealthData, consentAt: u.consentAt, withdrawnAt: u.withdrawnAt }),
  }
}

export async function hasHealthConsent(userId: string): Promise<boolean> {
  const [u] = await db
    .select({ consentAt: users.healthConsentAt, withdrawnAt: users.healthConsentWithdrawnAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  return !!u && isHealthConsentActive(u.consentAt, u.withdrawnAt)
}

export async function grantHealthConsent(userId: string): Promise<void> {
  await db
    .update(users)
    .set({ healthConsentAt: new Date(), healthConsentVersion: HEALTH_CONSENT_VERSION })
    .where(eq(users.id, userId))
}

/**
 * Withdraw (or decline) the consent: record the date and delete every copy
 * of the health data. The consent date and version stay as the record.
 */
export async function withdrawHealthConsent(userId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        healthConsentWithdrawnAt: new Date(),
        sex: null,
        age: null,
        weight: null,
        height: null,
        activityLevel: null,
        restrictions: [],
      })
      .where(eq(users.id, userId))
    await tx
      .delete(userMemories)
      .where(and(eq(userMemories.userId, userId), inArray(userMemories.key, [...HEALTH_MEMORY_KEYS])))
    const [settings] = await tx
      .select({ template: userSettings.template })
      .from(userSettings)
      .where(eq(userSettings.userId, userId))
      .limit(1)
    if (settings) {
      await tx
        .update(userSettings)
        .set({ template: stripHealthFromTemplate(settings.template) as object })
        .where(eq(userSettings.userId, userId))
    }
  })
}

/** `PUT /user/:id` body without the health fields (no consent). */
export function stripHealthProfileFields<T extends Record<string, unknown>>(body: T): Partial<T> {
  const out: Record<string, unknown> = { ...body }
  for (const f of HEALTH_PROFILE_FIELDS) delete out[f]
  return out as Partial<T>
}

/**
 * The profile page's `user_settings.template` blob without its health copy:
 * no `physical`, and `preferences.restrictions` emptied.
 */
export function stripHealthFromTemplate(template: unknown): unknown {
  if (!template || typeof template !== 'object' || Array.isArray(template)) return template
  const { physical: _physical, ...rest } = template as Record<string, unknown>
  const prefs = rest.preferences
  if (prefs && typeof prefs === 'object' && !Array.isArray(prefs) && 'restrictions' in prefs) {
    rest.preferences = { ...(prefs as Record<string, unknown>), restrictions: [] }
  }
  return rest
}
