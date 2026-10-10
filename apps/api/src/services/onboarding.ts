import { eq } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { users } from '../db/schema.js'
import { grantHealthConsent, hasHealthConsent } from './healthConsent.js'

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
}

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
  }
  if (input.restrictions !== undefined) {
    set.restrictions = healthConsent === true || (await hasHealthConsent(userId)) ? input.restrictions : []
  }
  const [updated] = await database.update(users).set(set).where(eq(users.id, userId)).returning(onboardedUserColumns)
  return updated ?? null
}
