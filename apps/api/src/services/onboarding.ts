import { eq, sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { households, users } from '../db/schema.js'
import { grantHealthConsent, hasHealthConsent } from './healthConsent.js'
import { recordWishesFromFavoriteDishes } from './catalogWishes.js'
import { timeAvailableForChoice, type WeekdayCookingChoice } from '@ona/shared'
import { setMemoryFact } from './userMemoryStore.js'

/**
 * Save the first-steps answers and mark the user onboarded. Shared by the web
 * (`POST /user/:id/onboarding`) and Mimo's WhatsApp onboarding
 * (`complete_onboarding`, WhatsApp-first sign-up, 2026-10-10).
 *
 * `restrictions` are health data (RGPD art. 9, PRO-21): stored only with the
 * consent box, ticked now or earlier. WhatsApp never sends them (health data
 * stays out of WhatsApp, PRO-24), so `undefined` leaves the column as it is.
 */
export interface OnboardingInput {
  adults: number
  kidsCount: number
  cookingFreq: 'daily' | '3_4_times' | 'rarely'
  favoriteDishes: string[]
  priority: 'quick' | 'varied' | 'healthy' | 'cheap'
  restrictions?: string[]
  healthConsent?: boolean
  /**
   * PRO-138 «Entre semana, ¿cómo te gusta cocinar?» → `time_available`
   * (source onboarding). Absent (WhatsApp onboarding) leaves it as it is.
   */
  weekdayCooking?: WeekdayCookingChoice
  /**
   * PRO-138 free «tu caso» text. Kept (≤ 500 chars) for the household's ficha
   * (PRO-151): the sign-up day's signals read it. Absent leaves it as it is.
   */
  cookingNote?: string | null
}

export const ONBOARDING_NOTE_MAX = 500

export const onboardedUserColumns = {
  id: users.id,
  username: users.username,
  email: users.email,
  householdSize: users.householdSize,
  adults: users.adults,
  kidsCount: users.kidsCount,
  cookingFreq: users.cookingFreq,
  restrictions: users.restrictions,
  favoriteDishes: users.favoriteDishes,
  priority: users.priority,
  onboardingDone: users.onboardingDone,
  healthConsentAt: users.healthConsentAt,
  healthConsentVersion: users.healthConsentVersion,
  healthConsentWithdrawnAt: users.healthConsentWithdrawnAt,
}

export async function saveOnboarding(userId: string, input: OnboardingInput, database: any = defaultDb) {
  const { adults, kidsCount, cookingFreq, favoriteDishes, priority, healthConsent } = input
  if (healthConsent === true) await grantHealthConsent(userId)
  const set: Record<string, unknown> = {
    adults,
    kidsCount,
    // Clear the deprecated enum so it doesn't shadow the new fields.
    householdSize: null,
    cookingFreq,
    favoriteDishes,
    priority,
    onboardingDone: true,
    // The sign-up in progress (PRO-178) is over.
    onboardingDraft: null,
    // The first time only: the day the ficha reads the sign-up answers (PRO-151).
    onboardingCompletedAt: sql`COALESCE(${users.onboardingCompletedAt}, now())`,
  }
  const note = typeof input.cookingNote === 'string' ? input.cookingNote.trim().slice(0, ONBOARDING_NOTE_MAX) : undefined
  if (note) set.onboardingNote = note
  if (input.restrictions !== undefined) {
    set.restrictions = healthConsent === true || (await hasHealthConsent(userId)) ? input.restrictions : []
  }
  const [updated] = await database.update(users).set(set).where(eq(users.id, userId)).returning(onboardedUserColumns)
  // PRO-154: favourites the catalogue doesn't have become «deseos del
  // catálogo» (web and WhatsApp sign-up both land here). Best effort, real
  // database only (unit tests pass their own `database`).
  if (updated && database === defaultDb) await recordWishesFromFavoriteDishes(userId, favoriteDishes)
  if (updated && input.weekdayCooking) {
    await setMemoryFact(userId, 'time_available', timeAvailableForChoice(input.weekdayCooking), 'onboarding')
  }
  return updated ?? null
}

/**
 * PRO-178: does this account still have to go through /onboarding? Not when
 * it finished it, and not when it joined someone else's household through an
 * invitation (it reads that household's menu; the sign-up would generate on
 * top of it). Only an account whose own household drives the app is sent
 * back to the sign-up.
 */
export function needsOnboarding(row: { onboardingDone: boolean | null; householdOwnerId: string | null; id: string }): boolean {
  if (row.onboardingDone) return false
  return row.householdOwnerId === null || row.householdOwnerId === row.id
}

export async function onboardingStatus(userId: string, database: any = defaultDb) {
  const [row] = await database
    .select({
      id: users.id,
      onboardingDone: users.onboardingDone,
      onboardingDraft: users.onboardingDraft,
      householdOwnerId: households.ownerId,
    })
    .from(users)
    .leftJoin(households, eq(households.id, users.primaryHouseholdId))
    .where(eq(users.id, userId))
    .limit(1)
  if (!row) return null
  return { onboardingRequired: needsOnboarding(row), onboardingDraft: row.onboardingDraft ?? null }
}
