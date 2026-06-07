/**
 * One-shot data migration: rewrite menus.days[i][meal] from the legacy
 * single-recipe shape { recipeId, recipeName, … } to the multi-dish shape
 * { servings?, dishes: [{ kind:'recipe', recipeId, … }] }.
 *
 * Idempotent: rows already in the new shape (detected via `Array.isArray(slot.dishes)`)
 * are skipped. Safe to re-run after a partial apply or repeated boots.
 *
 * Wired into RAILPACK_START_CMD on `ona-api`:
 *   db:migrate && menus:migrate-dishes && start server
 */
import { eq } from 'drizzle-orm'
import { db } from '../src/db/connection.js'
import { menus } from '../src/db/schema.js'

type LegacySlot = {
  recipeId: string
  recipeName?: string
  servings?: number | null
  pinnedType?: string | null
  kind?: 'planned' | 'leftover' | null
  leftoverOf?: { day: number; meal: string } | null
  imageUrl?: string | null
  prepTime?: number | null
  totalTime?: number | null
}

type NewSlot = {
  servings?: number | null
  dishes: Array<{
    kind: 'recipe'
    recipeId: string
    recipeName?: string
    pinnedType?: string | null
    variant?: 'planned' | 'leftover'
    leftoverOf?: { day: number; meal: string; dishPosition: number } | null
  }>
}

function migrateSlot(slot: unknown): NewSlot | undefined {
  if (slot == null) return undefined
  if (typeof slot !== 'object') return undefined
  if ('dishes' in slot && Array.isArray((slot as { dishes: unknown }).dishes)) {
    // Already migrated; return the slot as-is so the caller can detect no-change.
    return slot as NewSlot
  }
  const legacy = slot as LegacySlot
  if (!legacy.recipeId) return undefined
  return {
    servings: legacy.servings ?? null,
    dishes: [
      {
        kind: 'recipe',
        recipeId: legacy.recipeId,
        recipeName: legacy.recipeName,
        pinnedType: legacy.pinnedType ?? null,
        variant: legacy.kind === 'leftover' ? 'leftover' : 'planned',
        leftoverOf: legacy.leftoverOf
          ? { ...legacy.leftoverOf, dishPosition: 0 }
          : null,
      },
    ],
  }
}

async function run(): Promise<void> {
  const rows = await db.select({ id: menus.id, days: menus.days }).from(menus)
  let migrated = 0
  let skipped = 0
  for (const row of rows) {
    const days = row.days as unknown
    if (!Array.isArray(days)) { skipped++; continue }
    let changed = false
    const newDays = days.map((day: Record<string, unknown>) => {
      const out: Record<string, unknown> = {}
      for (const meal of Object.keys(day)) {
        const original = day[meal]
        const migratedSlot = migrateSlot(original)
        if (migratedSlot && migratedSlot !== original) changed = true
        out[meal] = migratedSlot ?? original
      }
      return out
    })
    if (!changed) { skipped++; continue }
    // CRITICAL: scope the UPDATE to the current row's id. Without the WHERE
    // clause every iteration would rewrite the entire menus table.
    await db.update(menus).set({ days: newDays as any }).where(eq(menus.id, row.id))
    migrated++
  }
  console.log(`[menus:migrate-dishes] ✓ Migrated ${migrated} menus (${skipped} already in new shape or empty).`)
}

run().catch((e) => { console.error(e); process.exit(1) })
