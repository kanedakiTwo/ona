/**
 * PRO-390 (D-163, D-167.3) — gemelos de los hogares reales para la prueba a
 * ciegas del menú inteligente. Por cada hogar real con menú, un perfil que se
 * le parece, hecho sin IA y solo de campos con opciones fijas (personas, tipo
 * de dieta, cómo cocina, tiempo entre semana, presupuesto, cocinas y tipos de
 * plato que cambia): nunca texto libre, nombre, correo, teléfono ni id.
 *
 * - Las alergias e intolerancias se sortean entre las de toda la beta, nunca
 *   las del propio hogar (ni una que comparta alérgeno con las suyas).
 * - Solo salen combinaciones que se repiten en al menos `TWIN_MIN_GROUP`
 *   hogares: una que se repite menos se mezcla con la más parecida (toma su
 *   combinación). Si ni así llegan, no sale nada.
 * - Un script (`apps/api/scripts/seedPlannerTwins.ts`) los da de alta en
 *   staging como hogares de prueba `@example.com`. Ningún dato de una
 *   persona pasa por la suscripción (D-163).
 */
import { randomInt } from 'node:crypto'
import { sql } from 'drizzle-orm'
import { COOKING_STYLES, RESTRICTION_PRESETS, type CookingStyle, type WeekdayCookingChoice } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { BLIND_TEST_EMAIL_SUFFIX } from './blindComparison.js'
import { compileRestrictions, normalizeText, restrictionKey } from './dietaryRestrictions.js'

export const TWIN_MIN_GROUP = 3

/** Allergies and intolerances a twin can get: the sign-up's chips that aren't a diet. */
const DIET_PRESETS = ['vegetariano', 'vegano', 'halal', 'sin alcohol']
export const TWIN_ALLERGIES = RESTRICTION_PRESETS.filter((r) => !DIET_PRESETS.includes(r))
/** Cuisines a twin can have (the keys Mimo saves in `cuisine_bias`, without accents). */
export const TWIN_CUISINES = ['espanola', 'mediterranea', 'italiana', 'asiatica', 'mexicana', 'india', 'americana', 'francesa'] as const
export const TWIN_BUDGETS = ['sin_dato', 'hasta_60', '60_100', 'mas_100'] as const
export const TWIN_DIETS = ['omnivora', 'vegetariana', 'vegana'] as const
/** A cuisine counts when its slider is at least this. */
const CUISINE_MIN_BIAS = 60
/** A dish type counts as «lo cambia» from this many edits on. */
const SWAP_MIN_EDITS = 2
const MAX_LIST = 2
const SWAP_TYPE_RE = /^tipo:[a-z0-9-]{1,30}$/

/** What the endpoint reads of a real household (only here, never returned). */
export interface TwinSource {
  adults: number
  kidsCount: number
  /** Every member's restrictions, as stored. */
  restrictions: string[]
  cookingStyle: unknown
  /** `time_available` (weekday → budget). */
  timeAvailable: unknown
  weeklyBudgetEur: unknown
  cuisineBias: unknown
  /** The `tipo:` tag of each dish the household swapped, removed or vetoed (one per edit). */
  swappedTypes: string[]
}

export interface TwinProfile {
  /** 4 = 4 or more. */
  adults: 1 | 2 | 3 | 4
  /** 2 = 2 or more. */
  kidsCount: 0 | 1 | 2
  diet: (typeof TWIN_DIETS)[number]
  cookingStyle: CookingStyle | null
  weekdayCooking: WeekdayCookingChoice | null
  budget: (typeof TWIN_BUDGETS)[number]
  cuisines: string[]
  swapsOut: string[]
}

export interface Twin extends TwinProfile {
  allergies: string[]
}

const clamp = (n: unknown, lo: number, hi: number, fallback: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : fallback)

/** Pure: the allergy chips a household has (by key, or sharing an allergen with what it wrote; a diet is not an allergy). */
export function ownAllergies(restrictions: readonly string[]): string[] {
  const dietKeys = new Set(DIET_PRESETS.map(restrictionKey))
  const allergyLike = restrictions.filter((r) => !dietKeys.has(restrictionKey(r)))
  const keys = new Set(allergyLike.map(restrictionKey))
  const own = compileRestrictions(allergyLike).allergens
  return TWIN_ALLERGIES.filter((a) => keys.has(restrictionKey(a)) || [...compileRestrictions([a]).allergens].some((t) => own.has(t)))
}

function weekdayCookingOf(v: unknown): WeekdayCookingChoice | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const budgets = Object.values(v as Record<string, any>).filter((b) => b && typeof b.minutes === 'number' && b.minutes > 0)
  if (!budgets.length) return 'sin_prisa'
  if (budgets.some((b) => b.mode !== 'activo' && b.minutes <= 30)) return 'rapido'
  if (budgets.some((b) => b.mode === 'activo' && b.minutes <= 20)) return 'poco_trabajo'
  return 'sin_prisa'
}

function budgetOf(v: unknown): TwinProfile['budget'] {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) return 'sin_dato'
  return v < 60 ? 'hasta_60' : v <= 100 ? '60_100' : 'mas_100'
}

function cuisinesOf(v: unknown): string[] {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return []
  return Object.entries(v as Record<string, unknown>)
    .map(([k, n]) => [normalizeText(k).replace(/\s+/g, ''), n] as const)
    .filter(([k, n]) => (TWIN_CUISINES as readonly string[]).includes(k) && typeof n === 'number' && n >= CUISINE_MIN_BIAS)
    .sort((a, b) => (b[1] as number) - (a[1] as number) || a[0].localeCompare(b[0]))
    .slice(0, MAX_LIST)
    .map(([k]) => k)
    .sort()
}

function swapsOutOf(types: readonly string[]): string[] {
  const counts = new Map<string, number>()
  for (const t of types) if (SWAP_TYPE_RE.test(t)) counts.set(t, (counts.get(t) ?? 0) + 1)
  return [...counts].filter(([, n]) => n >= SWAP_MIN_EDITS).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, MAX_LIST).map(([t]) => t).sort()
}

/** Pure: a real household → its profile, only fixed options. */
export function twinProfile(s: TwinSource): TwinProfile {
  const keys = new Set(s.restrictions.map(restrictionKey))
  const diet = keys.has(restrictionKey('vegano')) ? 'vegana' : keys.has(restrictionKey('vegetariano')) ? 'vegetariana' : 'omnivora'
  return {
    adults: clamp(s.adults, 1, 4, 2) as TwinProfile['adults'],
    kidsCount: clamp(s.kidsCount, 0, 2, 0) as TwinProfile['kidsCount'],
    diet,
    cookingStyle: (COOKING_STYLES as readonly unknown[]).includes(s.cookingStyle) ? (s.cookingStyle as CookingStyle) : null,
    weekdayCooking: weekdayCookingOf(s.timeAvailable),
    budget: budgetOf(s.weeklyBudgetEur),
    cuisines: cuisinesOf(s.cuisineBias),
    swapsOut: swapsOutOf(s.swappedTypes),
  }
}

export const profileKey = (p: TwinProfile) => JSON.stringify([p.adults, p.kidsCount, p.diet, p.cookingStyle, p.weekdayCooking, p.budget, p.cuisines, p.swapsOut])

/** Pure: how different two profiles are (one point per field; lists by how much they differ). */
export function profileDistance(a: TwinProfile, b: TwinProfile): number {
  const list = (x: string[], y: string[]) => {
    const all = new Set([...x, ...y])
    return all.size ? (all.size - x.filter((v) => y.includes(v)).length) / all.size : 0
  }
  return (
    Math.abs(a.adults - b.adults) + Math.abs(a.kidsCount - b.kidsCount) +
    Number(a.diet !== b.diet) * 2 + Number(a.cookingStyle !== b.cookingStyle) + Number(a.weekdayCooking !== b.weekdayCooking) +
    Number(a.budget !== b.budget) + list(a.cuisines, b.cuisines) + list(a.swapsOut, b.swapsOut)
  )
}

/**
 * Pure: each household's profile → the profile its twin gets. A combination
 * with fewer than `min` households takes the most similar one's (the smallest
 * first, until every combination has `min` or only one is left). Null when
 * not even all together reach `min`.
 */
export function groupProfiles(profiles: readonly TwinProfile[], min = TWIN_MIN_GROUP): TwinProfile[] | null {
  if (profiles.length < min) return null
  const groups = new Map<string, { profile: TwinProfile; members: number[] }>()
  profiles.forEach((p, i) => {
    const k = profileKey(p)
    const g = groups.get(k) ?? { profile: p, members: [] }
    g.members.push(i)
    groups.set(k, g)
  })
  for (;;) {
    const sorted = [...groups].sort((a, b) => a[1].members.length - b[1].members.length || a[0].localeCompare(b[0]))
    const [smallKey, small] = sorted[0]
    if (small.members.length >= min || groups.size === 1) break
    let best: string | null = null
    let bestD = Infinity
    for (const [k, g] of groups) {
      if (k === smallKey) continue
      const d = profileDistance(small.profile, g.profile)
      const bestSize = best ? groups.get(best)!.members.length : -1
      if (d < bestD || (d === bestD && (g.members.length > bestSize || (g.members.length === bestSize && k < best!)))) {
        best = k
        bestD = d
      }
    }
    groups.get(best!)!.members.push(...small.members)
    groups.delete(smallKey)
  }
  const out: TwinProfile[] = new Array(profiles.length)
  for (const g of groups.values()) for (const i of g.members) out[i] = g.profile
  return out
}

/** Random integer in [0, n). */
export type Rng = (n: number) => number

/**
 * Pure (with the dice): one twin per household, in the households' order.
 * Allergies drawn from the beta's (as many as a household picked at random
 * has), never the household's own. Empty when no combination reaches 3.
 */
export function drawTwins(sources: readonly TwinSource[], rng: Rng = randomInt): Twin[] {
  const grouped = groupProfiles(sources.map(twinProfile))
  if (!grouped) return []
  const own = sources.map((s) => ownAllergies(s.restrictions))
  const pool = TWIN_ALLERGIES.filter((a) => own.some((o) => o.includes(a)))
  return sources.map((_, i) => {
    const free = pool.filter((a) => !own[i].includes(a))
    const howMany = Math.min(own[rng(own.length)].length, free.length)
    const allergies: string[] = []
    while (allergies.length < howMany) allergies.push(free.splice(rng(free.length), 1)[0])
    return { ...grouped[i], allergies: allergies.sort() }
  })
}

/** The twins as the endpoint gives them: sorted by combination, so the order says nothing. */
export function buildTwins(sources: readonly TwinSource[], rng: Rng = randomInt): Twin[] {
  return drawTwins(sources, rng).sort((a, b) => profileKey(a).localeCompare(profileKey(b)) || a.allergies.join().localeCompare(b.allergies.join()))
}

const BUDGET_EUR: Record<TwinProfile['budget'], number | null> = { sin_dato: null, hasta_60: 50, '60_100': 80, mas_100: 120 }

/**
 * Pure: what the staging script sends for a twin — the sign-up answers
 * (`POST /user/:id/onboarding`) and the memory facts (`PATCH /memory`). The
 * dish types it swaps are not data: they go to its card for «Hogares».
 */
export function twinSignup(t: Twin): { onboarding: Record<string, unknown>; facts: Array<{ key: string; value: unknown }> } {
  const restrictions = [...(t.diet === 'vegana' ? ['vegano'] : t.diet === 'vegetariana' ? ['vegetariano'] : []), ...t.allergies]
  const facts: Array<{ key: string; value: unknown }> = []
  const budget = BUDGET_EUR[t.budget]
  if (budget !== null) facts.push({ key: 'weekly_budget_eur', value: budget })
  if (t.cuisines.length) facts.push({ key: 'cuisine_bias', value: Object.fromEntries(t.cuisines.map((c) => [c, 80])) })
  return {
    onboarding: {
      adults: t.adults,
      kidsCount: t.kidsCount,
      cookingStyle: t.cookingStyle ?? 'daily',
      ...(t.weekdayCooking ? { weekdayCooking: t.weekdayCooking } : {}),
      restrictions,
      healthConsent: restrictions.length > 0,
    },
    facts,
  }
}

/** Every real household with a menu (owner not `@example.com`), read for `buildTwins`. */
export async function loadTwinSources(db: typeof defaultDb = defaultDb): Promise<TwinSource[]> {
  const result: any = await db.execute(sql`
    WITH real AS (
      SELECT h.id, h.owner_id FROM households h JOIN users o ON o.id = h.owner_id
      WHERE o.email NOT ILIKE ${'%' + BLIND_TEST_EMAIL_SUFFIX}
        AND EXISTS (SELECT 1 FROM menus m WHERE m.household_id = h.id OR m.user_id = h.owner_id)
    )
    SELECT
      o.adults, o.kids_2_to_10 AS kids,
      ARRAY(
        SELECT unnest(u.restrictions) FROM household_members hm JOIN users u ON u.id = hm.user_id WHERE hm.household_id = real.id
        UNION
        SELECT jsonb_array_elements_text(um.value) FROM household_members hm JOIN user_memories um ON um.user_id = hm.user_id
        WHERE hm.household_id = real.id AND um.key = 'restrictions' AND jsonb_typeof(um.value) = 'array'
        UNION
        SELECT jsonb_array_elements_text(pf.value) FROM profile_facts pf
        WHERE pf.household_id = real.id AND pf.type = 'restrictions' AND pf.status = 'active' AND jsonb_typeof(pf.value) = 'array'
      ) AS restrictions,
      (SELECT pf.value FROM profile_facts pf WHERE pf.household_id = real.id AND pf.type = 'cooking_style' AND pf.status = 'active' ORDER BY pf.updated_at DESC LIMIT 1) AS cooking_style,
      COALESCE(
        (SELECT pf.value FROM profile_facts pf WHERE pf.household_id = real.id AND pf.type = 'time_available' AND pf.status = 'active' ORDER BY pf.updated_at DESC LIMIT 1),
        (SELECT um.value FROM user_memories um WHERE um.user_id = real.owner_id AND um.key = 'time_available')) AS time_available,
      COALESCE(
        (SELECT pf.value FROM profile_facts pf WHERE pf.household_id = real.id AND pf.type = 'weekly_budget_eur' AND pf.status = 'active' ORDER BY pf.updated_at DESC LIMIT 1),
        (SELECT um.value FROM user_memories um WHERE um.user_id = real.owner_id AND um.key = 'weekly_budget_eur')) AS budget,
      COALESCE(
        (SELECT pf.value FROM profile_facts pf WHERE pf.household_id = real.id AND pf.type = 'cuisine_bias' AND pf.status = 'active' ORDER BY pf.updated_at DESC LIMIT 1),
        (SELECT um.value FROM user_memories um WHERE um.user_id = real.owner_id AND um.key = 'cuisine_bias')) AS cuisine_bias,
      COALESCE((
        SELECT array_agg(t) FROM menu_edits e JOIN recipes rc ON rc.id = e.before_recipe_id AND rc.author_id IS NULL
        CROSS JOIN LATERAL unnest(COALESCE(rc.internal_tags, ARRAY[]::text[])) AS t
        WHERE e.household_id = real.id AND e.action IN ('swap', 'remove', 'ban') AND t LIKE 'tipo:%'
      ), ARRAY[]::text[]) AS swapped_types
    FROM real JOIN users o ON o.id = real.owner_id
  `)
  return (result.rows ?? result).map((r: any) => ({
    adults: r.adults,
    kidsCount: r.kids,
    restrictions: r.restrictions ?? [],
    cookingStyle: r.cooking_style?.style ?? r.cooking_style ?? null,
    timeAvailable: r.time_available,
    weeklyBudgetEur: typeof r.budget === 'string' ? Number(r.budget) : r.budget,
    cuisineBias: r.cuisine_bias,
    swappedTypes: r.swapped_types ?? [],
  }))
}
