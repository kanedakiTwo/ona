/**
 * Ficha del hogar (PRO-150, D-064) — everything Mimoia knows about a
 * household, with a section per person. See specs/household-profile.md.
 *
 * Layers:
 *   - facts (`profile_facts`): what, about whom, where it comes from,
 *     confidence, evidence, valid until, status;
 *   - portrait (`household_profiles`): a short text (≤ 250 words);
 *   - pending questions (`profile_questions`);
 *   - history (`profile_changes`).
 * People without an account (`household_persons`) are an alias and an age
 * band: a minor's name is never stored.
 *
 * `user_memories` (userMemory.ts) keeps working until Mimo reads the ficha
 * (PRO-153); its keys are fact types here too, with the same value schemas.
 */
import { z } from 'zod'
import { HEALTH_MEMORY_KEYS } from '../constants/healthConsent.js'
import { MEALS } from '../constants/enums.js'
import { MEMORY_KEYS, MEMORY_VALUE_SCHEMAS, type MemorySource } from './userMemory.js'

// ─── Enums ──────────────────────────────────────────────────────

/** Where a fact comes from. */
export const PROFILE_FACT_ORIGINS = ['user', 'onboarding', 'ai_realtime', 'ai_nightly', 'ai_weekly'] as const
export type ProfileFactOrigin = (typeof PROFILE_FACT_ORIGINS)[number]

export const PROFILE_FACT_STATUSES = ['active', 'retired'] as const
export type ProfileFactStatus = (typeof PROFILE_FACT_STATUSES)[number]

export const PROFILE_QUESTION_STATUSES = ['pending', 'asked', 'answered', 'dismissed'] as const
export type ProfileQuestionStatus = (typeof PROFILE_QUESTION_STATUSES)[number]

/** What a `profile_changes` row records. */
export const PROFILE_CHANGE_ACTIONS = [
  'fact_added',
  'fact_updated',
  'fact_retired',
  'portrait_updated',
  'person_added',
  'person_updated',
  'person_removed',
  'question_added',
  'question_resolved',
] as const
export type ProfileChangeAction = (typeof PROFILE_CHANGE_ACTIONS)[number]

/** Age bands for people without an account. Everything but `adulto` is a minor. */
export const PERSON_AGE_BANDS = ['0-2', '3-5', '6-12', '13-17', 'adulto'] as const
export type PersonAgeBand = (typeof PERSON_AGE_BANDS)[number]

export function isMinorAgeBand(band: PersonAgeBand): boolean {
  return band !== 'adulto'
}

const WEEKDAYS = ['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const
const weekdaySchema = z.enum(WEEKDAYS)
const mealSchema = z.enum(MEALS)
const shortText = z.string().trim().min(1).max(280)

// ─── Fact types ─────────────────────────────────────────────────

/** Types new with the ficha (on top of the `user_memories` keys). */
export const NEW_PROFILE_FACT_TYPES = [
  'fixed_dish',
  'skipped_meal',
  'dish_frequency',
  'affinity',
  'effort',
  'temporary_situation',
  'shopping',
  'batch_cooking',
  'novelty',
] as const

export const PROFILE_FACT_TYPES = [...MEMORY_KEYS, ...NEW_PROFILE_FACT_TYPES] as const
export type ProfileFactType = (typeof PROFILE_FACT_TYPES)[number]

/** −2 (lo evita) … +2 (le encanta). */
const affinityScore = z.number().int().min(-2).max(2)

export const NEW_PROFILE_FACT_VALUE_SCHEMAS = {
  /** «Pizza los viernes por la noche». */
  fixed_dish: z.object({
    dish: shortText,
    days: z.array(weekdaySchema).min(1).optional(),
    meal: mealSchema.optional(),
  }).strict(),
  /** «El fin de semana no se cocina», «los viernes a mediodía, fuera». */
  skipped_meal: z.object({
    days: z.array(weekdaySchema).min(1),
    meal: mealSchema,
    reason: shortText.optional(),
  }).strict(),
  /** «Coliflor gratinada cada 6–10 semanas». */
  dish_frequency: z.object({
    dish: shortText,
    minWeeks: z.number().int().min(1).max(52),
    maxWeeks: z.number().int().min(1).max(52),
  }).strict().refine((v) => v.minWeeks <= v.maxWeeks, { message: 'minWeeks > maxWeeks' }),
  /** Affinity with an ingredient or a style, −2..+2 («le encanta la cuchara»). */
  affinity: z.object({
    kind: z.enum(['ingredient', 'style']),
    target: shortText,
    score: affinityScore,
  }).strict(),
  /** Hands-on and total minutes per day and meal («entre semana, 15 min de trabajo aunque cueza 3 h»). */
  effort: z.object({
    days: z.array(weekdaySchema).min(1),
    meal: mealSchema,
    activeMinutes: z.number().int().min(0).max(480),
    totalMinutes: z.number().int().min(0).max(1440),
  }).strict().refine((v) => v.activeMinutes <= v.totalMinutes, { message: 'activeMinutes > totalMinutes' }),
  /** Sin horno, mudanza, invitados el sábado. Pair it with the fact's `validUntil`. */
  temporary_situation: z.object({
    description: shortText,
  }).strict(),
  /** Where and when they shop. */
  shopping: z.object({
    places: z.array(shortText).optional(),
    days: z.array(weekdaySchema).optional(),
    note: shortText.optional(),
  }).strict(),
  /** Batch cooking and lunchboxes. */
  batch_cooking: z.object({
    batches: z.boolean(),
    days: z.array(weekdaySchema).optional(),
    lunchboxes: z.boolean().optional(),
  }).strict(),
  /** Taste for new things: −2 (rutina) … +2 (le encanta probar). */
  novelty: z.object({
    score: affinityScore,
  }).strict(),
} satisfies Record<(typeof NEW_PROFILE_FACT_TYPES)[number], z.ZodTypeAny>

export const PROFILE_FACT_VALUE_SCHEMAS: Record<ProfileFactType, z.ZodTypeAny> = {
  ...MEMORY_VALUE_SCHEMAS,
  ...NEW_PROFILE_FACT_VALUE_SCHEMAS,
}

/** Fact types that are health data (same keys as the memory's, PRO-21). */
export const HEALTH_PROFILE_FACT_TYPES: readonly ProfileFactType[] = HEALTH_MEMORY_KEYS

export function isHealthProfileFactType(type: string): boolean {
  return (HEALTH_PROFILE_FACT_TYPES as readonly string[]).includes(type)
}

// ─── People without an account ─────────────────────────────────

/**
 * Aliases a minor may have. A minor's name is never stored: only one of
 * these, optionally followed by a number («hija 2»).
 */
export const MINOR_ALIASES = [
  'el bebé', 'la bebé', 'el pequeño', 'la pequeña', 'el mediano', 'la mediana', 'el mayor', 'la mayor',
  'el peque', 'la peque', 'hijo', 'hija', 'niño', 'niña',
] as const

const MINOR_ALIAS_RE = new RegExp(`^(${MINOR_ALIASES.join('|')})( [1-9])?$`, 'i')

export function isAllowedMinorAlias(alias: string): boolean {
  return MINOR_ALIAS_RE.test(alias.trim())
}

/**
 * A person without an account. `.strict()`: there is no `name` field, and
 * a minor's alias must be one of `MINOR_ALIASES`.
 */
export const householdPersonSchema = z.object({
  alias: z.string().trim().min(1).max(40),
  ageBand: z.enum(PERSON_AGE_BANDS),
}).strict().superRefine((p, ctx) => {
  if (isMinorAgeBand(p.ageBand) && !isAllowedMinorAlias(p.alias)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['alias'],
      message: 'Para un menor solo se guarda un alias genérico («la pequeña», «hijo 2»), nunca su nombre',
    })
  }
})
export type HouseholdPersonInput = z.infer<typeof householdPersonSchema>

// ─── Facts ──────────────────────────────────────────────────────

/** Whom a fact is about: the whole household, a user with an account, or a person without one. */
export const profileSubjectSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('household') }).strict(),
  z.object({ kind: z.literal('user'), userId: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('person'), personId: z.string().uuid() }).strict(),
])
export type ProfileSubject = z.infer<typeof profileSubjectSchema>

export const profileEvidenceSchema = z.object({
  /** Which signal: 'chat', 'whatsapp', 'menu_edit', 'recipe_verdict', 'onboarding', 'user_memories'… */
  signal: z.string().trim().min(1).max(40),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'AAAA-MM-DD'),
  summary: shortText,
}).strict()
export type ProfileEvidence = z.infer<typeof profileEvidenceSchema>

export const profileFactSchema = z.object({
  subject: profileSubjectSchema,
  type: z.enum(PROFILE_FACT_TYPES),
  value: z.unknown(),
  origin: z.enum(PROFILE_FACT_ORIGINS),
  confidence: z.number().min(0).max(1),
  evidence: z.array(profileEvidenceSchema).max(20).default([]),
  validUntil: z.string().datetime({ offset: true }).nullable().default(null),
  status: z.enum(PROFILE_FACT_STATUSES).default('active'),
}).strict().superRefine((f, ctx) => {
  const parsed = PROFILE_FACT_VALUE_SCHEMAS[f.type].safeParse(f.value)
  if (!parsed.success) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['value'],
      message: parsed.error.issues.map((i) => `${i.path.join('.') || '(valor)'}: ${i.message}`).join('; '),
    })
  }
  // Health is never deduced by the nightly/weekly refiner (D-064, PRO-152).
  if (isHealthProfileFactType(f.type) && (f.origin === 'ai_nightly' || f.origin === 'ai_weekly')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['origin'], message: 'Un dato de salud nunca se deduce' })
  }
  // A household-level fact has no body: health is always about someone.
  if (isHealthProfileFactType(f.type) && f.subject.kind === 'household') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['subject'], message: 'Un dato de salud es de una persona, no del hogar' })
  }
})
export type ProfileFactInput = z.input<typeof profileFactSchema>
export type ProfileFact = z.output<typeof profileFactSchema>

/** Same health rules as `user_memories` today (PRO-21, LEG-03). */
export type ProfileWriteChannel = 'web' | 'whatsapp' | 'system'

export function canWriteProfileFact(input: {
  type: string
  channel: ProfileWriteChannel
  hasHealthConsent: boolean
}): { ok: true } | { ok: false; reason: 'health_consent_required' | 'health_from_whatsapp' } {
  if (!isHealthProfileFactType(input.type)) return { ok: true }
  if (input.channel === 'whatsapp') return { ok: false, reason: 'health_from_whatsapp' }
  if (!input.hasHealthConsent) return { ok: false, reason: 'health_consent_required' }
  return { ok: true }
}

// ─── Portrait, questions, changes ──────────────────────────────

export const PORTRAIT_MAX_WORDS = 250

export function countPortraitWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length
}

export const householdPortraitSchema = z.object({
  text: z.string().trim().min(1).refine((t) => countPortraitWords(t) <= PORTRAIT_MAX_WORDS, {
    message: `El retrato tiene como mucho ${PORTRAIT_MAX_WORDS} palabras`,
  }),
  version: z.number().int().min(1),
  model: z.string().min(1).max(80),
  generatedAt: z.string().datetime({ offset: true }),
}).strict()
export type HouseholdPortrait = z.infer<typeof householdPortraitSchema>

export const profileQuestionSchema = z.object({
  subject: profileSubjectSchema,
  question: shortText,
  factType: z.enum(PROFILE_FACT_TYPES).nullable().default(null),
  origin: z.enum(PROFILE_FACT_ORIGINS),
  status: z.enum(PROFILE_QUESTION_STATUSES).default('pending'),
}).strict()
export type ProfileQuestion = z.output<typeof profileQuestionSchema>

export const profileChangeSchema = z.object({
  action: z.enum(PROFILE_CHANGE_ACTIONS),
  factType: z.enum(PROFILE_FACT_TYPES).nullable().default(null),
  before: z.unknown().nullable().default(null),
  after: z.unknown().nullable().default(null),
  reason: shortText,
  origin: z.enum(PROFILE_FACT_ORIGINS),
}).strict()
export type ProfileChange = z.output<typeof profileChangeSchema>

// ─── Visibility (Miguel, 2026-10-16) ───────────────────────────

/**
 * Who reads the ficha. `system` is the menu generator and Mimo, which see
 * everything so they can respect it.
 */
export type ProfileViewer =
  | { kind: 'system' }
  | { kind: 'member'; userId: string; role: 'owner' | 'member' | 'child' }

/** What visibility needs from a stored fact. */
export interface ProfileFactVisibilityRow {
  type: string
  subjectUserId: string | null
}

/**
 * A health fact about a person with an account is read only by that person
 * (and the system); the rest of the ficha, by every adult of the household.
 * Child members read nothing.
 */
export function canSeeProfileFact(fact: ProfileFactVisibilityRow, viewer: ProfileViewer): boolean {
  if (viewer.kind === 'system') return true
  if (viewer.role === 'child') return false
  if (isHealthProfileFactType(fact.type) && fact.subjectUserId !== null) {
    return fact.subjectUserId === viewer.userId
  }
  return true
}

export function visibleProfileFacts<T extends ProfileFactVisibilityRow>(facts: readonly T[], viewer: ProfileViewer): T[] {
  return facts.filter((f) => canSeeProfileFact(f, viewer))
}

// ─── From user_memories (migration) ────────────────────────────

/** `user_memories.source` → fact origin. */
export const MEMORY_SOURCE_TO_ORIGIN: Record<MemorySource, ProfileFactOrigin> = {
  manual: 'user',
  onboarding: 'onboarding',
  inferred: 'ai_realtime',
}

/** Memory keys about the kitchen or the house as a whole; the rest are about the user who said them. */
export const HOUSEHOLD_LEVEL_MEMORY_KEYS = [
  'household.adults',
  'household.kids_2_to_10',
  'equipment',
  'weekly_budget_eur',
  'region',
] as const

export function memoryKeyIsHouseholdLevel(key: string): boolean {
  return (HOUSEHOLD_LEVEL_MEMORY_KEYS as readonly string[]).includes(key)
}
