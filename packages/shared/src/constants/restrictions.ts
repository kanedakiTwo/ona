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
] as const

export type RestrictionPreset = (typeof RESTRICTION_PRESETS)[number]
