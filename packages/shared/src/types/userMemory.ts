/**
 * User-memory contract — typed fact storage the assistant reads on every
 * skill call. Keys are stable forever (never rename, only add); each key
 * has a Zod schema enforcing its value shape so the REST + advisor can
 * reject malformed writes at the boundary.
 *
 * Source enum:
 *   'onboarding' — written during the voice onboarding flow (PR 3)
 *   'manual'     — written by the user via /profile/memoria (PR 4) or REST PATCH
 *   'inferred'   — written by the advisor's `update_memory` skill mid-conversation
 *
 * Confidence (0..1) lets inferred facts be downgraded so a misheard
 * preference doesn't override a manual one. Default 1.0 for onboarding +
 * manual; the `update_memory` skill writes 0.8 unless the user is explicit
 * ("APUNTA que odio el cilantro" → 1.0).
 */
import { z } from 'zod'

export const MEMORY_SOURCES = ['onboarding', 'manual', 'inferred'] as const
export type MemorySource = (typeof MEMORY_SOURCES)[number]

/**
 * Canonical key registry. Adding a key here is a 1-row change; removing
 * one is a data migration of every stored value under that key. Treat the
 * names like a public API contract.
 */
export const MEMORY_KEYS = [
  // Physical profile — duplicated with `users` columns for backward compat
  // until PR 3's voice onboarding becomes the single source of truth. The
  // REST layer mirrors writes both ways so old code that reads `users`
  // still works.
  'physical.sex',
  'physical.age',
  'physical.height_cm',
  'physical.weight_kg',
  'physical.activity_level',
  // Household composition
  'household.adults',
  'household.kids_2_to_10',
  // Dietary
  'restrictions',
  'dislikes',
  // Kitchen capability
  'equipment',
  // Time budget per weekday (max minutes for cooking)
  'time_available',
  // Weekly budget in euros
  'weekly_budget_eur',
  // Cuisine bias — slider 0-100 per cuisine
  'cuisine_bias',
  // Cooking skill enum: easy | medium | advanced
  'cooking_skill',
  // Meal-time preferences (HH:MM strings per meal type)
  'meal_times',
  // Free-form notes the agent has learned ("his daughter doesn't eat fish")
  'notes',
  // User-authored nutrition principles — added on top of ONA's defaults
  // (the "10 mandamientos"). Each entry is one short Spanish sentence.
  // The advisor reads both in its system prompt; user principles win on
  // conflict ("creo que la grasa saturada es buena" overrides any default
  // that suggests otherwise).
  'nutrition_principles',
  // User's prep-time habits — the bridge between recipe ingredients
  // that need anticipation (frozen fish, dried legumes, cold-rise dough)
  // and the notification scheduler (PR-D). Each entry is one short
  // Spanish sentence describing a consistent habit, e.g.
  //   ["Siempre congelo el pescado",
  //    "Pongo las legumbres en remojo la noche antes",
  //    "Saco la carne 30 min antes para que tempere"]
  // The assistant can write to this via `update_memory` after inferring
  // the habit mid-conversation. The scheduler reads it to decide which
  // ingredient prep events deserve a heads-up notification.
  'prep_habits',
] as const

export type MemoryKey = (typeof MEMORY_KEYS)[number]

// ─── Per-key value schemas ─────────────────────────────────────

const sexSchema = z.enum(['male', 'female', 'other'])
const activitySchema = z.enum(['none', 'light', 'moderate', 'high'])
const cookingSkillSchema = z.enum(['easy', 'medium', 'advanced'])
const weekdayKey = z.enum([
  'lunes',
  'martes',
  'miercoles',
  'jueves',
  'viernes',
  'sabado',
  'domingo',
])

export const MEMORY_VALUE_SCHEMAS: Record<MemoryKey, z.ZodTypeAny> = {
  'physical.sex': sexSchema,
  'physical.age': z.number().int().min(2).max(120),
  'physical.height_cm': z.number().int().min(50).max(250),
  'physical.weight_kg': z.number().min(15).max(300),
  'physical.activity_level': activitySchema,
  'household.adults': z.number().int().min(1).max(20),
  'household.kids_2_to_10': z.number().int().min(0).max(20),
  restrictions: z.array(z.string().min(1)),
  dislikes: z.array(z.string().min(1)),
  equipment: z.array(z.string().min(1)),
  time_available: z.record(weekdayKey, z.number().int().min(0).max(480)),
  weekly_budget_eur: z.number().min(0).max(5000),
  cuisine_bias: z.record(z.string().min(1), z.number().int().min(0).max(100)),
  cooking_skill: cookingSkillSchema,
  meal_times: z.record(
    z.enum(['breakfast', 'lunch', 'snack', 'dinner']),
    z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'HH:MM 24h'),
  ),
  notes: z.array(z.string().min(1)),
  nutrition_principles: z.array(z.string().min(3).max(280)),
  prep_habits: z.array(z.string().min(3).max(280)),
}

// ─── Wire shape ─────────────────────────────────────────────────

/** A single fact as stored / returned over the wire. */
export interface MemoryFact {
  key: MemoryKey
  value: unknown
  source: MemorySource
  confidence: number
  updatedAt: string // ISO datetime
}

/**
 * Aggregated read shape — the API's `GET /memory` returns this. Keys with
 * no stored value are absent from the object (no nulls), so the frontend
 * can use `?.` chains without juggling null vs undefined.
 */
export type UserMemory = Partial<Record<MemoryKey, MemoryFact>>

// ─── Write requests ────────────────────────────────────────────

/** Validate a single fact's value against its key schema. */
export function validateMemoryFactValue(
  key: string,
  value: unknown,
):
  | { ok: true; key: MemoryKey; value: unknown }
  | { ok: false; reason: string } {
  if (!(MEMORY_KEYS as readonly string[]).includes(key)) {
    return { ok: false, reason: `unknown memory key: ${key}` }
  }
  const schema = MEMORY_VALUE_SCHEMAS[key as MemoryKey]
  const parsed = schema.safeParse(value)
  if (!parsed.success) {
    return { ok: false, reason: parsed.error.issues.map((i) => i.message).join('; ') }
  }
  return { ok: true, key: key as MemoryKey, value: parsed.data }
}

/** Compose the prompt-digest fragment from a UserMemory blob. */
export function buildMemoryDigestText(memory: UserMemory): string {
  const lines: string[] = []
  const phys: string[] = []
  const m = memory
  if (m['physical.age']?.value) phys.push(`${m['physical.age'].value} años`)
  if (m['physical.sex']?.value) phys.push(`${m['physical.sex'].value === 'male' ? 'hombre' : m['physical.sex'].value === 'female' ? 'mujer' : 'otra'}`)
  if (m['physical.height_cm']?.value) phys.push(`${m['physical.height_cm'].value} cm`)
  if (m['physical.weight_kg']?.value) phys.push(`${m['physical.weight_kg'].value} kg`)
  if (m['physical.activity_level']?.value) phys.push(`actividad ${m['physical.activity_level'].value}`)
  if (phys.length > 0) lines.push(`Perfil: ${phys.join(', ')}.`)

  const hh: string[] = []
  if (m['household.adults']?.value) hh.push(`${m['household.adults'].value} adulto(s)`)
  if (m['household.kids_2_to_10']?.value) hh.push(`${m['household.kids_2_to_10'].value} niño(s) 2-10`)
  if (hh.length > 0) lines.push(`Hogar: ${hh.join(', ')}.`)

  const restr = (m.restrictions?.value as string[] | undefined) ?? []
  if (restr.length > 0) lines.push(`Restricciones: ${restr.join(', ')}.`)

  const dislikes = (m.dislikes?.value as string[] | undefined) ?? []
  if (dislikes.length > 0) lines.push(`Le disgustan: ${dislikes.join(', ')}.`)

  const eq = (m.equipment?.value as string[] | undefined) ?? []
  if (eq.length > 0) lines.push(`Equipo de cocina: ${eq.join(', ')}.`)

  if (m.weekly_budget_eur?.value) lines.push(`Presupuesto semanal: ${m.weekly_budget_eur.value} €.`)
  if (m.cooking_skill?.value) lines.push(`Nivel de cocinero: ${m.cooking_skill.value}.`)

  const cuisine = (m.cuisine_bias?.value as Record<string, number> | undefined) ?? {}
  const liked = Object.entries(cuisine)
    .filter(([_, v]) => v >= 70)
    .map(([k]) => k)
  if (liked.length > 0) lines.push(`Prefiere cocina: ${liked.join(', ')}.`)

  const time = (m.time_available?.value as Record<string, number> | undefined) ?? {}
  const tight = Object.entries(time)
    .filter(([_, v]) => v > 0 && v <= 30)
    .map(([k]) => k)
  if (tight.length > 0) lines.push(`Días con poco tiempo (≤30 min): ${tight.join(', ')}.`)

  const notes = (m.notes?.value as string[] | undefined) ?? []
  if (notes.length > 0) lines.push(`Notas: ${notes.join('; ')}.`)

  const principles = (m.nutrition_principles?.value as string[] | undefined) ?? []
  if (principles.length > 0) {
    // These override ONA's defaults on conflict — flag that explicitly so
    // the model doesn't try to "correct" the user against their own beliefs.
    lines.push(
      `Principios nutricionales propios del usuario (RESPÉTALOS aunque entren en conflicto con tus 10 mandamientos por defecto):\n  - ${principles.join('\n  - ')}`,
    )
  }

  const habits = (m.prep_habits?.value as string[] | undefined) ?? []
  if (habits.length > 0) {
    // Drives the notification scheduler: if the user says "siempre
    // congelo el pescado", the assistant knows to anticipate defrost
    // alerts when fish is in next week's menu. Surface them as
    // first-person habit statements so the LLM can write to them via
    // `update_memory` whenever it picks one up in conversation.
    lines.push(
      `Hábitos de preparación del usuario (úsalos para sugerir tiempos y avisos):\n  - ${habits.join('\n  - ')}`,
    )
  }

  return lines.length === 0
    ? ''
    : `Memoria del usuario (úsala para personalizar respuestas y matcher):\n${lines.join('\n')}`
}
