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
 *   (`legacyWeekType`): the plantilla of whoever generated its last menu
 *   (meals, diners, dishes, «comidas fijas» PRO-218, «días de táper» PRO-223)
 *   and the ficha's `fixed_dish` with day and meal (a dish type with that
 *   name, else the one recipe the PRO-1141 search finds, else its name; two
 *   in a slot go by turns), which are then archived in the ficha. New
 *   households get their row when they are created (`householdStore.ts`).
 */
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
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
import { householdMembers, householdWeekTypes, households, menus, profileChanges, profileFacts, users, userSettings } from '../db/schema.js'
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
 * Pure: a dish name («pizza», «sándwich mixto») as an option of the week
 * type. A dish type when the name is one (every week a pizza that fits, not
 * always the same); else a concrete recipe when the PRO-1141 search finds
 * exactly one; else the name written, with no recipe and nothing on the list.
 */
export function optionForDishName(dish: string, recipes: readonly RecipeWithCourse[]): WeekTypeOption {
  const type = dishTypeForName(dish)
  if (type) return { kind: 'type', type }
  const { household, catalogue } = recipesForDishName(dish, recipes)
  const matches = [...household, ...catalogue]
  if (matches.length === 1) return { kind: 'recipe', recipeId: matches[0].id, name: matches[0].name }
  return { kind: 'fixed', label: capitalise(dish).slice(0, 60), items: [] }
}

export interface LegacyFact {
  type: string
  value: unknown
}

/**
 * Pure: the week type that gives the menu the old pieces gave (§7). Only
 * `fixed_dish` facts are read (`skipped_meal` waits for Mimo, phase 3);
 * `recipes` only for them.
 */
export function legacyWeekType(input: {
  template: unknown
  facts: readonly LegacyFact[]
  recipes?: readonly RecipeWithCourse[]
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
      const wasOff = !!days[d][f.meal]?.off
      days[d][f.meal] = { ...on(d, f.meal), options: [{ kind: 'fixed', label: f.label, items: f.items.map((i) => ({ ...i })) }], since: input.since, ...(wasOff ? { offWhenFree: true } : {}) }
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
    const options = names.slice(0, 4).map((n) => optionForDishName(n, input.recipes ?? []))
    days[Number(d)][meal] = { ...days[Number(d)][meal], options, since: input.since }
  }

  // Días de táper (PRO-223): that lunch, unless something fixed is there.
  for (const d of taperDaysOf(raw)) {
    if (d < 1 || days[d].lunch?.options?.length) continue
    days[d].lunch = { ...on(d, 'lunch'), options: [{ kind: 'taper' }], since: input.since }
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
  now?: Date
}

/** Pure: a plantilla blob that says something (meals, dishes, fixed meals or tápers), not the default. */
export function isOwnPlantilla(template: unknown): boolean {
  if (normalizeMealTemplate(template)) return true
  if (Object.keys(extractMealDishCounts(template)).length) return true
  return fixedMealsFromTemplate(template).length > 0 || taperDaysOf(template).length > 0
}

/**
 * Pure (§7, households of several members): whose plantilla becomes the
 * household's week type — the one who generated its last menu; without a
 * menu, the first member (oldest first) whose plantilla isn't the default;
 * else the owner.
 */
export function pickPlantillaOwner(input: {
  lastMenuUserId: string | null
  ownerId: string
  members: ReadonlyArray<{ userId: string; template: unknown }>
}): string {
  if (input.lastMenuUserId && input.members.some((m) => m.userId === input.lastMenuUserId)) return input.lastMenuUserId
  return input.members.find((m) => isOwnPlantilla(m.template))?.userId ?? input.ownerId
}

/**
 * What a household's old pieces give as a week type (only the boot migration
 * reads them), and the `fixed_dish` facts with day and meal it takes over.
 */
export async function deriveLegacyWeekType(householdId: string, db: Db = defaultDb, ctx: WeekTypeContext = {}): Promise<{ days: WeekTypeDays; factIds: string[] }> {
  const [h] = await db.select({ ownerId: households.ownerId }).from(households).where(eq(households.id, householdId)).limit(1)
  const members = await db
    .select({ userId: householdMembers.userId, template: userSettings.template })
    .from(householdMembers)
    .leftJoin(userSettings, eq(userSettings.userId, householdMembers.userId))
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(asc(householdMembers.joinedAt))
  const [last] = await db.select({ userId: menus.userId }).from(menus).where(eq(menus.householdId, householdId)).orderBy(desc(menus.createdAt)).limit(1)
  const who = pickPlantillaOwner({ lastMenuUserId: last?.userId ?? null, ownerId: h?.ownerId ?? '', members })
  const template = members.find((m) => m.userId === who)?.template
    ?? (await db.select({ template: userSettings.template }).from(userSettings).where(eq(userSettings.userId, who)).limit(1))[0]?.template
  const facts = (await db
    .select({ id: profileFacts.id, type: profileFacts.type, value: profileFacts.value })
    .from(profileFacts)
    .where(and(eq(profileFacts.householdId, householdId), eq(profileFacts.status, 'active'), eq(profileFacts.type, 'fixed_dish'))))
    .filter((f: { value: unknown }) => fixedDishOf(f.value))
  const recipes = facts.length && who ? await loadRecipesFor(who, db) : []
  return { days: legacyWeekType({ template, facts, recipes, since: currentWeekStart(ctx.now) }), factIds: facts.map((f: { id: string }) => f.id) }
}

/** Monday (Madrid) of the current week: a slot saved now takes its first option this week. */
export function currentWeekStart(now: Date = new Date()): string {
  return firstMenuWeeks(now).weeks[0]
}

/** The recipes a dish name is searched in: those the user may be served. */
async function loadRecipesFor(userId: string, db: Db): Promise<RecipeWithCourse[]> {
  const { loadMatchableRecipes } = await import('./matchableRecipes.js')
  return loadMatchableRecipes(userId, db)
}

/**
 * «Pizza los viernes por la noche» said to Mimo (a `fixed_dish` with day and
 * meal): those slots of the week type take that dish (a type, the one recipe
 * of that name, or its name written) from this week on, instead of a fact of
 * the ficha. Returns what was written.
 */
export async function setWeekTypeDish(
  householdId: string,
  fixed: { dish: string; days: readonly number[]; meal: Meal },
  opts: { userId: string; db?: Db; now?: Date },
): Promise<{ option: WeekTypeOption; changes: SlotChange[] }> {
  const db = opts.db ?? defaultDb
  const days = await loadWeekType(householdId, db)
  const option = optionForDishName(fixed.dish, await loadRecipesFor(opts.userId, db))
  const since = currentWeekStart(opts.now)
  const changes: SlotChange[] = []
  for (const d of fixed.days) {
    if (d < 0 || d > 6) continue
    const { off: _off, together: _together, offWhenFree: _f, ...rest } = days[d]?.[fixed.meal] ?? {}
    changes.push({ day: d, meal: fixed.meal, slot: { ...rest, options: [option], since } })
  }
  if (changes.length) await saveWeekTypeSlots(householdId, changes, db)
  return { option, changes }
}

/** The household's week type; one without a row yet plans lunch and dinner every day. */
export async function loadWeekType(householdId: string | null, db: Db = defaultDb): Promise<WeekTypeDays> {
  if (!householdId) return fullWeekTypeDays()
  const [row] = await db.select({ slots: householdWeekTypes.slots }).from(householdWeekTypes).where(eq(householdWeekTypes.householdId, householdId)).limit(1)
  return fullWeekTypeDays(row ? parseWeekTypeDays(row.slots) : null)
}

/** The week type the menu of `userId` follows: their primary household's. */
export async function loadWeekTypeForUser(userId: string, db: Db = defaultDb): Promise<{ householdId: string | null; days: WeekTypeDays }> {
  const [u] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, userId)).limit(1)
  const householdId = u?.householdId ?? null
  return { householdId, days: await loadWeekType(householdId, db) }
}

export interface SlotChange {
  day: number
  meal: Meal
  slot: WeekTypeSlot
}

/**
 * Write some slots of a household's week type, the rest as they are (a row
 * that doesn't exist yet starts from lunch and dinner). Returns the whole week.
 */
export async function saveWeekTypeSlots(
  householdId: string,
  changes: readonly SlotChange[],
  db: Db = defaultDb,
  ctx: WeekTypeContext & { track?: { userId: string; channel?: UsageChannel | null } } = {},
): Promise<WeekTypeDays> {
  await db.insert(householdWeekTypes).values({ householdId, slots: fullWeekTypeDays() }).onConflictDoNothing({ target: householdWeekTypes.householdId })
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
    .select({ id: households.id })
    .from(households)
    .leftJoin(householdWeekTypes, eq(householdWeekTypes.householdId, households.id))
    .where(isNull(householdWeekTypes.id))
  let created = 0
  for (const h of missing) {
    try {
      const { days, factIds } = await deriveLegacyWeekType(h.id, db, { now })
      await db.transaction(async (tx) => {
        const inserted = await tx.insert(householdWeekTypes).values({ householdId: h.id, slots: days }).onConflictDoNothing({ target: householdWeekTypes.householdId }).returning({ id: householdWeekTypes.id })
        if (!inserted.length) return
        created++
        // A fixed dish with day and meal now lives in the week type: archived in the ficha, never in two places.
        for (const id of factIds) {
          const [f] = await tx.update(profileFacts).set({ status: 'retired', updatedAt: now }).where(and(eq(profileFacts.id, id), eq(profileFacts.status, 'active'))).returning()
          if (!f) continue
          await tx.insert(profileChanges).values({
            householdId: h.id, factId: f.id, action: 'fact_retired', factType: f.type,
            before: { value: f.value, confidence: f.confidence, origin: f.origin }, after: null,
            reason: 'Pasa a la semana tipo del hogar', origin: f.origin, actorUserId: null,
          })
        }
      })
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
