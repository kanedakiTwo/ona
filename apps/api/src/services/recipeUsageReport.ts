/**
 * GET /admin/recipe-usage (PRO-1120, para COC-506; specs/metrics.md «Uso por
 * receta»): por receta del catálogo y en los últimos `days` días, cuántas
 * veces está en un menú (`inMenu`), cuántas la cambiaron por otra
 * (`swappedOut`) y cuántas se cocinó (`cooked`). Solo el id y el nombre de la
 * receta del catálogo (los escribe Cocina) y cifras: ni hogares ni personas
 * (D-094). Las recetas de usuarios no salen.
 *
 * Los menús se cuentan aquí, en puro (`countMenuPlacements`, con tests); los
 * cambios y lo cocinado los agrega el SQL; `buildRecipeUsageReport` (puro)
 * une las tres cifras y ordena.
 */
import { sql } from 'drizzle-orm'
import type { DayMenu } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { addDays, madridMidnightUtc, madridParts } from './madridTime.js'

type Db = typeof defaultDb

/** Lo que cuenta como «en el menú»: un plato planeado, no las sobras ni los tápers. */
const PLACED_VARIANTS = new Set([undefined, null, 'planned'])

/** Puro: por receta, los platos planeados de esos menús (cada hueco y plato, una vez). */
export function countMenuPlacements(menus: ReadonlyArray<{ days: unknown }>): Map<string, number> {
  const counts = new Map<string, number>()
  for (const m of menus) {
    if (!Array.isArray(m.days)) continue
    for (const day of m.days as Array<DayMenu | null>) {
      if (!day || typeof day !== 'object') continue
      for (const slot of Object.values(day)) {
        for (const dish of slot?.dishes ?? []) {
          if (dish?.kind !== 'recipe' || !dish.recipeId) continue
          if (!PLACED_VARIANTS.has(dish.variant as any)) continue
          counts.set(dish.recipeId, (counts.get(dish.recipeId) ?? 0) + 1)
        }
      }
    }
  }
  return counts
}

export interface RecipeCountRow {
  recipeId: string
  count: number
}

export interface CookedCountRow extends RecipeCountRow {
  /** De `count`, las que se apuntaron desde un hueco del menú. */
  fromMenu: number
}

export interface RecipeUsageRow {
  recipeId: string
  name: string
  inMenu: number
  swappedOut: number
  cooked: number
  cookedFromMenu: number
  /** swappedOut / (inMenu + swappedOut): de las veces que se puso, cuántas se cambió. Null sin ninguna. */
  swapRate: number | null
}

const rate = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 1000 : null)

/**
 * Puro: una fila por receta del catálogo (`names`) con alguna cifra, de la
 * más cambiada a la menos (y luego más veces en el menú, y por nombre). Lo
 * que no está en `names` (recetas de usuarios, borradas) no sale.
 */
export function buildRecipeUsageReport(input: {
  names: ReadonlyMap<string, string>
  inMenu: ReadonlyMap<string, number>
  swappedOut: readonly RecipeCountRow[]
  cooked: readonly CookedCountRow[]
}) {
  const swapped = new Map(input.swappedOut.map((r) => [r.recipeId, r.count]))
  const cooked = new Map(input.cooked.map((r) => [r.recipeId, r]))
  const ids = new Set([...input.inMenu.keys(), ...swapped.keys(), ...cooked.keys()])
  const recipes: RecipeUsageRow[] = []
  for (const id of ids) {
    const name = input.names.get(id)
    if (name === undefined) continue
    const inMenu = input.inMenu.get(id) ?? 0
    const swappedOut = swapped.get(id) ?? 0
    const c = cooked.get(id)
    if (inMenu + swappedOut + (c?.count ?? 0) === 0) continue
    recipes.push({
      recipeId: id,
      name,
      inMenu,
      swappedOut,
      cooked: c?.count ?? 0,
      cookedFromMenu: c?.fromMenu ?? 0,
      swapRate: rate(swappedOut, inMenu + swappedOut),
    })
  }
  recipes.sort((a, b) => b.swappedOut - a.swappedOut || b.inMenu - a.inMenu || a.name.localeCompare(b.name, 'es'))
  const sum = (k: 'inMenu' | 'swappedOut' | 'cooked' | 'cookedFromMenu') => recipes.reduce((s, r) => s + r[k], 0)
  return {
    totals: { recipes: recipes.length, inMenu: sum('inMenu'), swappedOut: sum('swappedOut'), cooked: sum('cooked'), cookedFromMenu: sum('cookedFromMenu') },
    recipes,
  }
}

export const RECIPE_USAGE_DEFINITIONS = {
  rows: 'PRO-1120: una fila por receta del catálogo (recipes.author_id nulo) con alguna cifra en la ventana, de la más cambiada a la menos. Solo id, nombre y cifras: ni hogares ni personas (D-094).',
  inMenu: 'Platos planeados de esa receta en los menús cuya semana toca la ventana (week_start entre from − 6 días y to), tal como están hoy: cada hueco y plato cuenta una vez; las sobras y los tápers (variant leftover/freezer/fridge/cooked) no cuentan.',
  swappedOut: 'Veces que la cambiaron por otra receta en la ventana (menu_edits action swap con esa receta como before, en la web o con Mimo). Lo que se cambió ya no está en el menú: no suma en inMenu.',
  swapRate: 'swappedOut / (inMenu + swappedOut): de las veces que se puso en un menú, cuántas se cambió. Null si no hay ninguna.',
  cooked: 'Veces que se apuntó como cocinada en la ventana (cook_logs, lo que cuenta meal_cooked: «Marcar como cocinada», el final del modo cocina, Mimo); cookedFromMenu = de esas, desde un hueco del menú. cook_mode_started no lleva receta: no se puede contar por receta.',
  excluded: 'Cuentas admin y suspendidas fuera salvo includeInternal=1. Días de Europe/Madrid.',
}

export interface RecipeUsageLoadOptions {
  days: number
  includeInternal?: boolean
  now?: Date
}

export async function loadRecipeUsageReport(opts: RecipeUsageLoadOptions, db: Db = defaultDb) {
  const now = opts.now ?? new Date()
  const today = madridParts(now).isoDate
  const fromDay = addDays(today, -(opts.days - 1))
  const from = madridMidnightUtc(fromDay)
  const inc = opts.includeInternal === true
  const counted = sql`(${inc}::boolean OR u.id IS NULL OR (u.role <> 'admin' AND u.suspended_at IS NULL))`

  // Los días de cada menú salen de la consulta para contarse aquí; ningún id de hogar sale del proceso.
  const menusQ = db.execute(sql`
    SELECT m.days
      FROM menus m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.week_start >= ${addDays(fromDay, -6)}::date AND m.week_start <= ${today}::date AND ${counted}
  `)
  const swapsQ = db.execute(sql`
    SELECT me.before_recipe_id::text AS recipe_id, COUNT(*)::int AS count
      FROM menu_edits me LEFT JOIN users u ON u.id = me.user_id
      WHERE me.action = 'swap' AND me.before_recipe_id IS NOT NULL AND me.created_at >= ${from} AND ${counted}
      GROUP BY 1
  `)
  const cookedQ = db.execute(sql`
    SELECT cl.recipe_id::text AS recipe_id, COUNT(*)::int AS count,
           COUNT(*) FILTER (WHERE cl.menu_id IS NOT NULL)::int AS from_menu
      FROM cook_logs cl LEFT JOIN users u ON u.id = cl.user_id
      WHERE cl.cooked_at >= ${from} AND ${counted}
      GROUP BY 1
  `)
  const [menusR, swapsR, cookedR] = await Promise.all([menusQ, swapsQ, cookedQ])
  const inMenu = countMenuPlacements(menusR.rows as Array<{ days: unknown }>)
  const swappedOut = (swapsR.rows as any[]).map((r) => ({ recipeId: String(r.recipe_id), count: Number(r.count) }))
  const cooked = (cookedR.rows as any[]).map((r) => ({ recipeId: String(r.recipe_id), count: Number(r.count), fromMenu: Number(r.from_menu) }))

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  const ids = [...new Set([...inMenu.keys(), ...swappedOut.map((r) => r.recipeId), ...cooked.map((r) => r.recipeId)])].filter((id) => uuid.test(id))
  const names = new Map<string, string>()
  if (ids.length > 0) {
    const namesR = await db.execute(sql`
      SELECT r.id::text AS id, r.name FROM recipes r
        WHERE r.author_id IS NULL AND r.id = ANY(${`{${ids.join(',')}}`}::uuid[])
    `)
    for (const r of namesR.rows as any[]) names.set(String(r.id), String(r.name))
  }

  return {
    days: opts.days,
    from: fromDay,
    to: today,
    includeInternal: inc,
    ...buildRecipeUsageReport({ names, inMenu, swappedOut, cooked }),
    definitions: RECIPE_USAGE_DEFINITIONS,
  }
}
