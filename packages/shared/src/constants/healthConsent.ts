/**
 * Explicit consent for health data (RGPD art. 9.2.a, PRO-21). Allergies,
 * intolerances, restrictions and the physical profile are special-category
 * data: Mimoia only stores them after the user ticks a separate, unticked
 * box. Withdrawing the consent deletes them.
 */

/** Bump when the consent text changes; stored with every consent. */
export const HEALTH_CONSENT_VERSION = 'salud-v1-2026-10'

export const HEALTH_CONSENT_TEXT =
  'Consiento que Mimoia trate mis datos de salud (alergias, intolerancias, restricciones, edad, sexo, peso, altura y nivel de actividad) para adaptar mis menús y avisos. Puedo retirarlo cuando quiera desde mi perfil; si lo retiro, se borran esos datos. Más información en la política de privacidad.'

/** Shown once on /menu to users without the consent. */
export const NO_HEALTH_DATA_NOTICE = 'No tenemos tus alergias: revisa los ingredientes de cada receta'

/** `users` columns (and `PUT /user/:id` fields) that hold health data. */
export const HEALTH_PROFILE_FIELDS = ['sex', 'age', 'weight', 'height', 'activityLevel', 'restrictions'] as const

/** `user_memories` keys that hold health data. */
export const HEALTH_MEMORY_KEYS = [
  'physical.sex',
  'physical.age',
  'physical.height_cm',
  'physical.weight_kg',
  'physical.activity_level',
  'restrictions',
] as const

export function isHealthMemoryKey(key: string): boolean {
  return (HEALTH_MEMORY_KEYS as readonly string[]).includes(key)
}

export interface HealthConsentState {
  /** The consent is in force now. */
  active: boolean
  consentAt: string | null
  version: string | null
  withdrawnAt: string | null
  /** The account holds health data (columns or memory). */
  hasHealthData: boolean
  /** Show the one-time "do you consent?" screen (existing users with data). */
  needsPrompt: boolean
}

/**
 * Consent is in force when it was given and not withdrawn afterwards (both
 * dates are kept as the record of what the user did).
 */
export function isHealthConsentActive(consentAt: Date | string | null, withdrawnAt: Date | string | null): boolean {
  if (!consentAt) return false
  if (!withdrawnAt) return true
  return new Date(consentAt).getTime() > new Date(withdrawnAt).getTime()
}

/**
 * The one-time screen is for accounts that already hold health data from
 * before the consent existed and never answered: no consent and no withdrawal
 * on record. Answering either way records a date, so it never shows again.
 */
export function needsHealthConsentPrompt(s: {
  hasHealthData: boolean
  consentAt: Date | string | null
  withdrawnAt: Date | string | null
}): boolean {
  return s.hasHealthData && !s.consentAt && !s.withdrawnAt
}
