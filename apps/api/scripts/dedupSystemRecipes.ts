#!/usr/bin/env tsx
/**
 * Deduplicate system recipes (author_id IS NULL).
 *
 * Production DB has 360 system recipes with only 15 distinct names: each was
 * inserted 24 times by repeated runs of an older seed without ON CONFLICT.
 *
 * Strategy: for each duplicated name, keep the earliest row (canonical) and
 * delete the rest. Before deleting, rewrite any `menus.days[…][meal].recipeId`
 * that points to a soon-to-be-deleted ID so it points at the canonical row —
 * otherwise existing menu cards would show broken meals.
 *
 * recipe_ingredients, recipe_steps, and user_favorites cascade automatically.
 *
 * Usage:
 *   DATABASE_URL=<prod-url> tsx scripts/dedupSystemRecipes.ts            # dry-run
 *   DATABASE_URL=<prod-url> tsx scripts/dedupSystemRecipes.ts --execute  # commit
 */
import { db, pool } from '../src/db/connection.js'
import { recipes, menus } from '../src/db/schema.js'
import { sql, eq, isNull, inArray } from 'drizzle-orm'

const EXECUTE = process.argv.includes('--execute')

type MealSlot = { recipeId?: string; recipeName?: string } | null
type DayBlock = Record<string, MealSlot>

interface Group {
  name: string
  canonicalId: string
  canonicalCreatedAt: Date
  duplicateIds: string[]
}

async function findGroups(): Promise<Group[]> {
  const rows = await db
    .select({
      id: recipes.id,
      name: recipes.name,
      createdAt: recipes.createdAt,
    })
    .from(recipes)
    .where(isNull(recipes.authorId))
    .orderBy(recipes.name, recipes.createdAt)

  const byName = new Map<string, { id: string; createdAt: Date }[]>()
  for (const r of rows) {
    const list = byName.get(r.name) ?? []
    list.push({ id: r.id, createdAt: r.createdAt ?? new Date(0) })
    byName.set(r.name, list)
  }

  const groups: Group[] = []
  for (const [name, list] of byName) {
    if (list.length < 2) continue
    list.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    const [canonical, ...dupes] = list
    groups.push({
      name,
      canonicalId: canonical.id,
      canonicalCreatedAt: canonical.createdAt,
      duplicateIds: dupes.map((d) => d.id),
    })
  }
  return groups
}

function buildRemap(groups: Group[]): Map<string, string> {
  const remap = new Map<string, string>()
  for (const g of groups) {
    for (const dupeId of g.duplicateIds) remap.set(dupeId, g.canonicalId)
  }
  return remap
}

interface MenuRewrite {
  menuId: string
  newDays: DayBlock[]
  swaps: number
}

async function rewriteMenus(remap: Map<string, string>): Promise<MenuRewrite[]> {
  const allMenus = await db.select({ id: menus.id, days: menus.days }).from(menus)
  const rewrites: MenuRewrite[] = []
  for (const m of allMenus) {
    const days = (m.days as DayBlock[]) ?? []
    let swaps = 0
    const newDays = days.map((day) => {
      const out: DayBlock = {}
      for (const [meal, slot] of Object.entries(day ?? {})) {
        if (slot && slot.recipeId && remap.has(slot.recipeId)) {
          out[meal] = { ...slot, recipeId: remap.get(slot.recipeId)! }
          swaps++
        } else {
          out[meal] = slot
        }
      }
      return out
    })
    if (swaps > 0) rewrites.push({ menuId: m.id, newDays, swaps })
  }
  return rewrites
}

async function main() {
  console.log(`Mode: ${EXECUTE ? 'EXECUTE (will write)' : 'DRY-RUN'}`)

  const groups = await findGroups()
  if (groups.length === 0) {
    console.log('No duplicate system recipes. Nothing to do.')
    await pool.end()
    return
  }

  const totalDupes = groups.reduce((n, g) => n + g.duplicateIds.length, 0)
  console.log(`Found ${groups.length} duplicated names, ${totalDupes} rows to delete:`)
  for (const g of groups) {
    console.log(
      `  ${g.name.padEnd(40)} keep=${g.canonicalId.slice(0, 8)} delete=${g.duplicateIds.length}`,
    )
  }

  const remap = buildRemap(groups)
  const menuRewrites = await rewriteMenus(remap)
  const totalSwaps = menuRewrites.reduce((n, r) => n + r.swaps, 0)
  console.log(
    `\nMenu impact: ${menuRewrites.length} menu(s) reference a duplicate recipe (${totalSwaps} slot swap(s))`,
  )
  for (const r of menuRewrites) {
    console.log(`  ${r.menuId} → ${r.swaps} swap(s)`)
  }

  if (!EXECUTE) {
    console.log('\nDry-run only. Re-run with --execute to commit.')
    await pool.end()
    return
  }

  console.log('\nApplying changes inside a transaction...')
  await db.transaction(async (tx) => {
    for (const r of menuRewrites) {
      await tx.update(menus).set({ days: r.newDays as any }).where(eq(menus.id, r.menuId))
    }
    const allDupeIds = groups.flatMap((g) => g.duplicateIds)
    for (let i = 0; i < allDupeIds.length; i += 100) {
      const chunk = allDupeIds.slice(i, i + 100)
      await tx.delete(recipes).where(inArray(recipes.id, chunk))
    }
  })
  console.log('Done.')
  await pool.end()
}

main().catch((err) => {
  console.error(err)
  pool.end()
  process.exit(1)
})
