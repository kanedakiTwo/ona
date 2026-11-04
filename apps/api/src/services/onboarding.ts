import { eq, or, sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { households, menus, users } from '../db/schema.js'
import { grantHealthConsent, hasHealthConsent, healthConsentCoversReligion } from './healthConsent.js'
import { recordWishesFromFavoriteDishes } from './catalogWishes.js'
import { applyFreezeAnswer, cookingFreqForStyle, isReligiousDiet, timeAvailableForChoice, type CookingFrequency, type CookingStyle, type FreezeAnswer, type Priority, type WeekdayCookingChoice } from '@ona/shared'
import { getMemoryForUser, setMemoryFact } from './userMemoryStore.js'
import { cookingStyleHousehold, setCookingStyle } from './profile/cookingStyle.js'

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
  /**
   * Not asked since 2026-11-03: without it, it comes from `cookingStyle`
   * (`onboardingCookingFreq`). A cached older app still sends it.
   */
  cookingFreq?: CookingFrequency
  favoriteDishes: string[]
  /** Not asked since 2026-11-03; absent leaves it as it is (Perfil and Mimo can set it). */
  priority?: Priority
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
  /**
   * PRO-217 «¿Cómo cocináis en casa?» → the household's ficha
   * (`cooking_style`, origin onboarding) and `cookingFreq`. Absent leaves the
   * ficha as it is.
   */
  cookingStyle?: CookingStyle
  /**
   * PRO-221 «¿Congeláis la carne o el pescado cuando compráis?» → a habit in
   * `prep_habits` (source onboarding): «Sí» / «A veces» save their sentence,
   * «No» saves nothing. Absent leaves it as it is.
   */
  freezesMeatFish?: FreezeAnswer
}

export const ONBOARDING_NOTE_MAX = 500

/** How often they cook: the answer when there is one (older app), else read from how they cook. */
export function onboardingCookingFreq(input: Pick<OnboardingInput, 'cookingFreq' | 'cookingStyle'>): CookingFrequency | undefined {
  return input.cookingFreq ?? (input.cookingStyle ? cookingFreqForStyle(input.cookingStyle) : undefined)
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
  const { adults, kidsCount, favoriteDishes, priority, healthConsent } = input
  if (healthConsent === true) await grantHealthConsent(userId)
  const cookingFreq = onboardingCookingFreq(input)
  const set: Record<string, unknown> = {
    adults,
    kidsCount,
    // Clear the deprecated enum so it doesn't shadow the new fields.
    householdSize: null,
    favoriteDishes,
    onboardingDone: true,
    // The sign-up in progress (PRO-178) is over.
    onboardingDraft: null,
    // The first time only: the day the ficha reads the sign-up answers (PRO-151).
    onboardingCompletedAt: sql`COALESCE(${users.onboardingCompletedAt}, now())`,
  }
  if (cookingFreq) set.cookingFreq = cookingFreq
  if (priority) set.priority = priority
  const note = typeof input.cookingNote === 'string' ? input.cookingNote.trim().slice(0, ONBOARDING_NOTE_MAX) : undefined
  if (note) set.onboardingNote = note
  if (input.restrictions !== undefined) {
    let restrictions = healthConsent === true || (await hasHealthConsent(userId)) ? input.restrictions : []
    // A consent given now is the current text; an older one (v1) doesn't name a religious diet (E-19).
    if (healthConsent !== true && restrictions.some(isReligiousDiet) && !(await healthConsentCoversReligion(userId))) {
      restrictions = restrictions.filter((r) => !isReligiousDiet(r))
    }
    set.restrictions = restrictions
  }
  const [updated] = await database.update(users).set(set).where(eq(users.id, userId)).returning(onboardedUserColumns)
  // PRO-154: favourites the catalogue doesn't have become «deseos del
  // catálogo» (web and WhatsApp sign-up both land here). Best effort, real
  // database only (unit tests pass their own `database`).
  if (updated && database === defaultDb) await recordWishesFromFavoriteDishes(userId, favoriteDishes)
  if (updated && input.weekdayCooking) {
    await setMemoryFact(userId, 'time_available', timeAvailableForChoice(input.weekdayCooking), 'onboarding')
  }
  if (updated && input.freezesMeatFish && database === defaultDb) {
    await saveFreezeAnswer(userId, input.freezesMeatFish)
  }
  if (updated && input.cookingStyle && database === defaultDb) {
    const home = await cookingStyleHousehold(userId)
    if (home?.canEdit) {
      await setCookingStyle({ householdId: home.householdId, style: input.cookingStyle, origin: 'onboarding', actorUserId: userId, signal: 'onboarding' })
    }
  }
  return updated ?? null
}

/** PRO-221: the freezing answer into `prep_habits`, keeping the other habits; nothing when it doesn't change. */
export async function saveFreezeAnswer(userId: string, answer: FreezeAnswer): Promise<void> {
  const memory = await getMemoryForUser(userId)
  const current = Array.isArray(memory.prep_habits?.value) ? (memory.prep_habits!.value as string[]) : []
  const next = applyFreezeAnswer(current, answer)
  if (next.length === current.length && next.every((h, i) => h === current[i])) return
  await setMemoryFact(userId, 'prep_habits', next, 'onboarding')
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
      // PRO-1042: a menu already made (Mimo by WhatsApp, an API sign-up).
      hasMenu: sql<boolean>`EXISTS (SELECT 1 FROM ${menus} WHERE ${or(eq(menus.userId, users.id), eq(menus.householdId, users.primaryHouseholdId))})`,
    })
    .from(users)
    .leftJoin(households, eq(households.id, users.primaryHouseholdId))
    .where(eq(users.id, userId))
    .limit(1)
  if (!row) return null
  return onboardingGate(row)
}

/**
 * PRO-1042: /menu goes to /onboarding only while there is no menu to show.
 * With a menu already made, /menu shows it and offers the sign-up still to
 * do apart (`onboardingPending`), instead of starting it again from zero.
 */
export function onboardingGate(row: { onboardingDone: boolean | null; householdOwnerId: string | null; id: string; hasMenu?: boolean | null; onboardingDraft?: unknown }) {
  const pending = needsOnboarding(row)
  return {
    onboardingRequired: pending && !row.hasMenu,
    onboardingPending: pending,
    hasMenu: Boolean(row.hasMenu),
    onboardingDraft: row.onboardingDraft ?? null,
  }
}
