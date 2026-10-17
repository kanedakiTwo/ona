/**
 * Restriction chips offered in onboarding and in the profile — one list so
 * the two screens can't drift ("sin lacteos" vs "sin lactosa", "marisco" vs
 * "mariscos"). Stored as-is in `users.restrictions`; the API compiles every
 * entry into allergen tags / ingredient rules (apps/api/src/services/
 * dietaryRestrictions.ts), and a test checks each preset maps to a real rule.
 * Users can still type free text ("cilantro", "picante").
 */
export const RESTRICTION_PRESETS = [
  'sin gluten',
  'sin lactosa',
  'huevo',
  'frutos secos',
  'cacahuetes',
  'marisco',
  'pescado',
  'soja',
  'vegetariano',
  'vegano',
  // PRO-144: skips recipes with wine, sherry, beer… (not health data per se).
  'sin alcohol',
] as const

export type RestrictionPreset = (typeof RESTRICTION_PRESETS)[number]

/**
 * Restrictions shown and saved by /profile (PRO-64): the union of the
 * account's (`users.restrictions`, written by onboarding) and the settings
 * blob's (`user_settings.template.preferences.restrictions`). Trimmed,
 * lowercased like the profile chips, deduped, first source first.
 */
export function unionRestrictions(
  ...lists: ReadonlyArray<readonly unknown[] | null | undefined>
): string[] {
  const out: string[] = []
  for (const list of lists) {
    if (!Array.isArray(list)) continue
    for (const raw of list) {
      if (typeof raw !== 'string') continue
      const r = raw.trim().toLowerCase()
      if (r && !out.includes(r)) out.push(r)
    }
  }
  return out
}
