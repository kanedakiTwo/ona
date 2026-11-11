/**
 * «Semana tipo» (D-182): the household's usual week, its store and its
 * migration from what came before.
 *
 * - One row per household (`household_week_types`), whoever generates (a
 *   member, the Thursday autoplan or Mimo). Written one slot at a time
 *   (`saveWeekTypeSlots`: the other slots are never touched; two people on the
 *   same slot → the last one wins).
 * - **Migration, once and repeatable** (`applyWeekTypeMigration`, on boot):
 *   every household without a row gets one built from the old places
 *   (`legacyWeekType`): the owner's plantilla (meals, diners, dishes), their
 *   «comidas fijas» (PRO-218) and «días de táper» (PRO-223), the ficha's
 *   `fixed_dish` with day and meal (PRO-1141: a recipe the PRO-1141 search
 *   finds, else a dish type with that name, else something fixed with no
 *   recipe; two in the same slot go by turns) and the `skipped_meal` the
 *   household said («no hay»). A household created later reads the same
 *   derivation until its first write.
 */
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  DISH_TYPES,
  MEALS,
  firstMenuWeeks,
  fixedMealsFromTemplate,
  fullWeekTypeDays,
  plantillaEdits,
  plantillaFromWeekType,
  weekTypeOptionsFor,
  weekTypeSlotAt,
  weekTypeSlotSchema,
  type PlantillaView,
  type Meal,
  type WeekTypeDays,
  type WeekTypeOption,
  type WeekTypeSlot,
} from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { householdWeekTypes, households, profileFacts, users, userSettings } from '../db/schema.js'
import { compileRestrictions, violatesRestrictions, mergeRestrictions } from './dietaryRestrictions.js'
import { extractMealDiners, extractMealDishCounts, normalizeMealTemplate, defaultTemplate } from './legacyPlantilla.js'
import type { RecipeWithCourse } from './matchableRecipes.js'
import { nameHasTerm, normalize } from './nutrition/allergens.js'
import { fixedDishOf } from './profile/reader.js'
import { taperDaysOf } from './taper.js'
import { trackEvent, weekTypeSlotChanges, type UsageChannel } from './usageEvents.js'

type Db = typeof defaultDb

const LINK_WORDS = new Set(['de', 'del', 'la', 'las', 'el', 'los', 'con', 'y', 'a', 'al', 'en'])

/**
 * Pure (PRO-1141's search): recipes whose name has every word of the dish
 * (whole words, plural-tolerant; «de», «con»… aside), the household's own
 * first, then the catalogue; audited-out catalogue recipes never.
 */
export function recipesForDishName<R extends Pick<RecipeWithCourse, 'name' | 'authorId' | 'catalogAuditIssues'>>(dish: string, recipes: readonly R[]): { household: R[]; catalogue: R[] } {
  const words = normalize(dish).split(/[^a-z0-9ñ]+/).filter((w) => w && !LINK_WORDS.has(w))
  const out = { household: [] as R[], catalogue: [] as R[] }
  if (words.length === 0) return out
  for (const r of [...recipes].sort((a, b) => a.name.localeCompare(b.name, 'es'))) {
    if (r.catalogAuditIssues?.length) continue
    const name = normalize(r.name)
    if (!words.every((w) => nameHasTerm(name, w))) continue
    ;(r.authorId ? out.household : out.catalogue).push(r)
  }
  return out
}

/** Pure: the dish type a name says («pizza», «legumbres», «ensalada»), or null. */
export function dishTypeForName(name: string): string | null {
  const n = normalize(name).trim()
  const same = (a: string, b: string) => a === b || a === `${b}s` || a === `${b}es` || b === `${a}s` || b === `${a}es`
  for (const t of DISH_TYPES) {
    const forms = [t.key, normalize(t.label), ...normalize(t.label).split(/ y /)].map((f) => f.trim())
    if (forms.some((f) => same(f, n))) return t.key
  }
  return null
}

const capitalise = (s: string) => {
  const t = s.trim()
  return t ? t[0].toLocaleUpperCase('es') + t.slice(1) : t
}

/**
 * Pure: a ficha's `fixed_dish` as an option of the week type. A recipe the
 * search finds (the first that fits every allergy and diet; if none does,
 * the first, and the menu will say why it isn't there), else a dish type
 * with that name, else something fixed with no recipe (its name, nothing on
 * the list).
 */
export function optionForDishName(dish: string, recipes: readonly RecipeWithCourse[], restrictions: readonly string[]): WeekTypeOption {
  const { household, catalogue } = recipesForDishName(dish, recipes)
  const matches = [...household, ...catalogue]
  if (matches.length) {
    const rules = compileRestrictions([...restrictions])
    const pick = matches.find((r) => !violatesRestrictions(r, rules)) ?? matches[0]
    return { kind: 'recipe', recipeId: pick.id, name: pick.name }
  }
  const type = dishTypeForName(dish)
  if (type) return { kind: 'type', type }
  return { kind: 'fixed', label: capitalise(dish).slice(0, 60), items: [] }
}

export interface LegacyFact {
  type: string
  value: unknown
  origin: string
}

/** The household said it (not something Mimo deduced): only those turn a slot off. */
const SAID = new Set(['user', 'onboarding'])

/**
 * Pure: the week type that gives the menu the old pieces gave (§7).
 * `recipes` and `restrictions` are only read for `fixed_dish`.
 */
export function legacyWeekType(input: {
  template: unknown
  facts: readonly LegacyFact[]
  recipes?: readonly RecipeWithCourse[]
  restrictions?: readonly string[]
  since: string
}): WeekTypeDays {
  const raw = input.template
  const tpl = normalizeMealTemplate(raw) ?? defaultTemplate()
  const diners = extractMealDiners(raw)
  const counts = extractMealDishCounts(raw)
  const days: WeekTypeDays = Array.from({ length: 7 }, (_, d) =>
    Object.fromEntries(
      MEALS.map((m) => {
        if (!tpl[d]?.[m]) return [m, { off: true }]
        const slot: WeekTypeSlot = {}
        if (diners[d]?.[m]) slot.diners = diners[d][m]
        if (counts[m] && counts[m]! > 1) slot.dishes = counts[m]
        return [m, slot]
      }),
    ),
  )
  const on = (d: number, m: Meal): WeekTypeSlot => {
    const { off: _off, ...rest } = days[d][m] ?? {}
    return rest
  }

  // Comidas fijas (PRO-218): they win, and turn the meal on.
  for (const f of fixedMealsFromTemplate(raw)) {
    for (const day of f.days) {
      const d = (['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as const).indexOf(day)
      if (d < 0) continue
      days[d][f.meal] = { ...on(d, f.meal), options: [{ kind: 'fixed', label: f.label, items: f.items.map((i) => ({ ...i })) }], since: input.since }
    }
  }

  // Platos fijos de la ficha (PRO-1141): on a slot the plantilla has, not a fixed meal's.
  const named = new Map<string, string[]>()
  for (const f of input.facts) {
    if (f.type !== 'fixed_dish') continue
    const fixed = fixedDishOf(f.value)
    if (!fixed) continue
    for (const d of fixed.days) {
      const slot = days[d]?.[fixed.meal]
      if (!slot || slot.off || slot.options?.length) continue
      const key = `${d}:${fixed.meal}`
      const list = named.get(key) ?? named.set(key, []).get(key)!
      if (!list.some((x) => normalize(x) === normalize(fixed.dish))) list.push(fixed.dish)
    }
  }
  for (const [key, names] of named) {
    const [d, meal] = key.split(':') as [string, Meal]
    const options = names.slice(0, 4).map((n) => optionForDishName(n, input.recipes ?? [], input.restrictions ?? []))
    days[Number(d)][meal] = { ...days[Number(d)][meal], options, since: input.since }
  }

  // Días de táper (PRO-223): that lunch, unless something fixed is there.
  for (const d of taperDaysOf(raw)) {
    if (d < 1 || days[d].lunch?.options?.length) continue
    days[d].lunch = { ...on(d, 'lunch'), options: [{ kind: 'taper' }], since: input.since }
  }

  // «No hay» (skipped_meal), only when the household said it and nothing is asked of that slot.
  for (const f of input.facts) {
    if (f.type !== 'skipped_meal' || !SAID.has(f.origin)) continue
    const v = f.value as { days?: unknown; meal?: unknown }
    if (!Array.isArray(v?.days) || !(MEALS as readonly string[]).includes(String(v.meal))) continue
    for (const day of v.days) {
      const d = (['lunes', 'martes', 'miercoles', 'jueves', 'viernes', 'sabado', 'domingo'] as readonly string[]).indexOf(String(day))
      const meal = v.meal as Meal
      if (d < 0 || days[d][meal]?.options?.length) continue
      days[d][meal] = { off: true }
    }
  }
  return fullWeekTypeDays(days)
}

/** Pure: a stored `slots` value, every malformed slot dropped (it then reads as the default). */
export function parseWeekTypeDays(raw: unknown): WeekTypeDays | null {
  if (!Array.isArray(raw) || raw.length !== 7) return null
  return raw.map((day) => {
    const out: Partial<Record<Meal, WeekTypeSlot>> = {}
    if (!day || typeof day !== 'object') return out
    for (const m of MEALS) {
      const parsed = weekTypeSlotSchema.safeParse((day as Record<string, unknown>)[m])
      if (parsed.success) out[m] = parsed.data as WeekTypeSlot
    }
    return out
  })
}

export interface WeekTypeContext {
  /** Already loaded by the caller (the generator): saves loading them again for `fixed_dish`. */
  recipes?: readonly RecipeWithCourse[]
  restrictions?: readonly string[]
  now?: Date
}

/** The old pieces of a household (or of a user without one), as a week type. Nothing is written. */
export async function deriveLegacyWeekType(householdId: string | null, userId: string | null, db: Db = defaultDb, ctx: WeekTypeContext = {}): Promise<WeekTypeDays> {
  let ownerId = userId
  if (householdId) {
    const [h] = await db.select({ ownerId: households.ownerId }).from(households).where(eq(households.id, householdId)).limit(1)
    ownerId = h?.ownerId ?? userId
  }
  const [settings] = ownerId ? await db.select({ template: userSettings.template }).from(userSettings).where(eq(userSettings.userId, ownerId)).limit(1) : []
  const facts: LegacyFact[] = householdId
    ? await db
      .select({ type: profileFacts.type, value: profileFacts.value, origin: profileFacts.origin })
      .from(profileFacts)
      .where(and(eq(profileFacts.householdId, householdId), eq(profileFacts.status, 'active'), inArray(profileFacts.type, ['fixed_dish', 'skipped_meal'])))
    : []
  let recipes = ctx.recipes
  let restrictions = ctx.restrictions
  if (ownerId && facts.some((f) => f.type === 'fixed_dish') && (!recipes || !restrictions)) {
    const loaded = await recipeContextFor(ownerId, db)
    recipes ??= loaded.recipes
    restrictions ??= loaded.restrictions
  }
  return legacyWeekType({ template: settings?.template, facts, recipes, restrictions, since: currentWeekStart(ctx.now) })
}

/** Monday (Madrid) of the current week: a slot saved now takes its first option this week. */
export function currentWeekStart(now: Date = new Date()): string {
  return firstMenuWeeks(now).weeks[0]
}

/** What a dish name is searched in: the user's recipes and every member's allergies and diets. */
async function recipeContextFor(userId: string, db: Db): Promise<{ recipes: RecipeWithCourse[]; restrictions: string[] }> {
  const { loadMatchableRecipes } = await import('./matchableRecipes.js')
  const { withHouseholdRestrictions } = await import('./householdAllergies.js')
  const { getMemoryForUser } = await import('./userMemoryStore.js')
  const recipes = await loadMatchableRecipes(userId, db)
  const [owner] = await db.select({ restrictions: users.restrictions }).from(users).where(eq(users.id, userId)).limit(1)
  const memory = await getMemoryForUser(userId).catch(() => null)
  const own = mergeRestrictions(owner?.restrictions, memory)
  const restrictions = await withHouseholdRestrictions(own, userId, db).catch(() => own)
  return { recipes, restrictions }
}

/**
 * «Pizza los viernes por la noche» (a `fixed_dish` with day and meal, said to
 * Mimo or found by the nightly refiner): those slots of the week type take
 * that dish (a recipe, a type or its name) from this week on, instead of a
 * fact of the ficha. `onlyIfFree` (what Mimo deduced): a slot that already
 * asks for something is left as it is. Returns what was written.
 */
export async function setWeekTypeDish(
  householdId: string,
  fixed: { dish: string; days: readonly number[]; meal: Meal },
  opts: { userId: string; onlyIfFree?: boolean; db?: Db; now?: Date },
): Promise<{ option: WeekTypeOption; changes: SlotChange[] }> {
  const db = opts.db ?? defaultDb
  const days = await loadWeekType(householdId, opts.userId, db)
  const { recipes, restrictions } = await recipeContextFor(opts.userId, db)
  const option = optionForDishName(fixed.dish, recipes, restrictions)
  const since = currentWeekStart(opts.now)
  const changes: SlotChange[] = []
  for (const d of fixed.days) {
    if (d < 0 || d > 6) continue
    const prev = days[d]?.[fixed.meal] ?? {}
    if (opts.onlyIfFree && (prev.options?.length || prev.off)) continue
    const { off: _off, together: _together, ...rest } = prev
    changes.push({ day: d, meal: fixed.meal, slot: { ...rest, options: [option], since } })
  }
  if (changes.length) await saveWeekTypeSlots(householdId, changes, db)
  return { option, changes }
}

/** The household's week type: its row, else what the old pieces say (until the first write). */
export async function loadWeekType(householdId: string | null, userId: string | null, db: Db = defaultDb, ctx: WeekTypeContext = {}): Promise<WeekTypeDays> {
  if (householdId) {
    const [row] = await db.select({ slots: householdWeekTypes.slots }).from(householdWeekTypes).where(eq(householdWeekTypes.householdId, householdId)).limit(1)
    const parsed = row ? parseWeekTypeDays(row.slots) : null
    if (parsed) return fullWeekTypeDays(parsed)
  }
  return deriveLegacyWeekType(householdId, userId, db, ctx)
}

/** The week type the menu of `userId` follows: their primary household's. */
export async function loadWeekTypeForUser(userId: string, db: Db = defaultDb, ctx: WeekTypeContext = {}): Promise<{ householdId: string | null; days: WeekTypeDays }> {
  const [u] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, userId)).limit(1)
  const householdId = u?.householdId ?? null
  return { householdId, days: await loadWeekType(householdId, userId, db, ctx) }
}

export interface SlotChange {
  day: number
  meal: Meal
  slot: WeekTypeSlot
}

/**
 * Write some slots of a household's week type, the rest as they are (a row
 * that doesn't exist yet starts from the old pieces). Returns the whole week.
 */
export async function saveWeekTypeSlots(
  householdId: string,
  changes: readonly SlotChange[],
  db: Db = defaultDb,
  ctx: WeekTypeContext & { track?: { userId: string; channel?: UsageChannel | null } } = {},
): Promise<WeekTypeDays> {
  const [exists] = await db.select({ id: householdWeekTypes.id }).from(householdWeekTypes).where(eq(householdWeekTypes.householdId, householdId)).limit(1)
  if (!exists) {
    const seed = await deriveLegacyWeekType(householdId, null, db, ctx)
    await db.insert(householdWeekTypes).values({ householdId, slots: seed }).onConflictDoNothing({ target: householdWeekTypes.householdId })
  }
  return db.transaction(async (tx) => {
    const [row] = await tx.select({ slots: householdWeekTypes.slots }).from(householdWeekTypes).where(eq(householdWeekTypes.householdId, householdId)).for('update')
    const days = fullWeekTypeDays(parseWeekTypeDays(row?.slots))
    const parts = new Set<string>()
    for (const c of changes) {
      if (c.day < 0 || c.day > 6 || !(MEALS as readonly string[]).includes(c.meal)) continue
      for (const p of weekTypeSlotChanges(days[c.day][c.meal], c.slot)) parts.add(p)
      days[c.day][c.meal] = { ...c.slot }
    }
    await tx.update(householdWeekTypes).set({ slots: days, updatedAt: new Date() }).where(eq(householdWeekTypes.householdId, householdId))
    // PRO-1024: one `template_changed` per part that changed (Perfil, Mimo).
    if (ctx.track) for (const what of parts) trackEvent('template_changed', { userId: ctx.track.userId, householdId, channel: ctx.track.channel ?? null, props: { what } })
    return days
  })
}

/**
 * Boot (once, repeatable): every household without a week type gets the one
 * its old pieces give. A second run finds none to create and changes nothing.
 * One household failing never stops the others.
 */
export async function applyWeekTypeMigration(db: Db = defaultDb, now: Date = new Date()): Promise<number> {
  const missing = await db
    .select({ id: households.id, ownerId: households.ownerId })
    .from(households)
    .leftJoin(householdWeekTypes, eq(householdWeekTypes.householdId, households.id))
    .where(isNull(householdWeekTypes.id))
  let created = 0
  for (const h of missing) {
    try {
      const slots = await deriveLegacyWeekType(h.id, h.ownerId, db, { now })
      const inserted = await db.insert(householdWeekTypes).values({ householdId: h.id, slots }).onConflictDoNothing({ target: householdWeekTypes.householdId }).returning({ id: householdWeekTypes.id })
      created += inserted.length
    } catch (err) {
      console.error(`[week-type] household ${h.id} not migrated:`, (err as Error)?.message ?? err)
    }
  }
  if (missing.length) console.log(`[week-type] ${created} de ${missing.length} hogares con su semana tipo`)
  return created
}

/**
 * Change the week type through the old plantilla's view (Mimo's
 * `update_weekly_template` and `set_fixed_meal`, the sign-up analysis): only
 * the slots the edit changes are written. Null when the user has no household.
 */
export async function editWeekTypeAsPlantilla(
  userId: string,
  edit: (view: PlantillaView) => PlantillaView,
  opts: { db?: Db; defaultDiners?: number; now?: Date; channel?: UsageChannel | null } = {},
): Promise<{ changes: SlotChange[]; days: WeekTypeDays } | null> {
  const db = opts.db ?? defaultDb
  const { householdId, days } = await loadWeekTypeForUser(userId, db)
  if (!householdId) return null
  const before = plantillaFromWeekType(days, opts.defaultDiners ?? 2)
  const after = edit(structuredClone(before))
  const changes = plantillaEdits(days, before, after, currentWeekStart(opts.now))
  if (changes.length === 0) return { changes, days }
  return { changes, days: await saveWeekTypeSlots(householdId, changes, db, { track: { userId, channel: opts.channel } }) }
}

/**
 * The dish type the week type asks for in a dish of a slot that week (the
 * turn's option for the first dish; each option's when together), or null.
 * «Cambiar al azar», regenerating a dish and Mimo's `swap_meal` look only at
 * recipes of that type (D-182 §5); a concrete recipe or something fixed is
 * changed for any recipe.
 */
export async function weekTypeDishTypeAt(userId: string, weekStart: string, day: number, meal: string, position: number, db: Db = defaultDb): Promise<string | null> {
  const { days } = await loadWeekTypeForUser(userId, db).catch(() => ({ days: null as WeekTypeDays | null }))
  return days ? weekTypeDishTypeIn(days, weekStart, day, meal, position) : null
}

/** Pure: `weekTypeDishTypeAt` on a week type already loaded. */
export function weekTypeDishTypeIn(days: WeekTypeDays, weekStart: string, day: number, meal: string, position: number): string | null {
  if (!(MEALS as readonly string[]).includes(meal)) return null
  const slot = weekTypeSlotAt(days, day, meal as Meal)
  const options = weekTypeOptionsFor(slot, weekStart)
  const o = slot.together ? options[position] : position === 0 ? options[0] : undefined
  return o?.kind === 'type' ? o.type : null
}

/** Pure: the recipes of that type, or all of them when there's no type or none of it. */
export function poolOfDishType<R extends { dishTypes?: string[] | null }>(pool: R[], type: string | null): R[] {
  if (!type) return pool
  const typed = pool.filter((r) => r.dishTypes?.includes(type))
  return typed.length ? typed : pool
}
