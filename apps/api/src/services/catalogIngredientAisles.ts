/**
 * PRO-177 — data fix: eggs and tofu filed under «Carnes y pescados».
 *
 * The catalogue had `huevo` and `tofu` (and the ingredients created later
 * for «yema de huevo», «clara»…) in the `proteinas` aisle, which the list
 * shows as «Carnes y pescados». The buy rules say they belong in «Lácteos y
 * huevos» (`lacteos`). The list already follows the rule; this brings the
 * stored catalogue in line so every other reader (admin, shop orders) agrees.
 *
 * Only exact rule names with a rule aisle (`catalogAisleFix`: huevo, huevos,
 * yema, yemas, yema de huevo, clara, claras, clara de huevo, tofu, tofu
 * firme…) and only while they are still in `proteinas`. Anything a curator
 * moved elsewhere, and a second run, are left alone: idempotent.
 *
 * Runs by itself after `db:migrate` (every API boot), like the PRO-57 and
 * PRO-138 backfills.
 */

import { eq, inArray } from 'drizzle-orm'
import { catalogAisleFix, type Aisle } from '@ona/shared'
import { ingredients } from '../db/schema.js'

type Db = typeof import('../db/connection.js').db

export interface AisleFix {
  id: string
  name: string
  from: string | null
  to: Aisle
}

/** Pure: which catalogue rows to move. */
export function planCatalogAisleFixes(rows: ReadonlyArray<{ id: string; name: string; aisle: string | null }>): AisleFix[] {
  const out: AisleFix[] = []
  for (const r of rows) {
    const to = catalogAisleFix(r.name, r.aisle)
    if (to) out.push({ id: r.id, name: r.name, from: r.aisle, to })
  }
  return out
}

export async function applyCatalogIngredientAisles(db: Db, log: (line: string) => void = console.log): Promise<AisleFix[]> {
  const rows = await db
    .select({ id: ingredients.id, name: ingredients.name, aisle: ingredients.aisle })
    .from(ingredients)
    .where(eq(ingredients.aisle, 'proteinas'))
  const fixes = planCatalogAisleFixes(rows)
  if (fixes.length === 0) {
    log('[catalog-ingredient-aisles] nada que corregir')
    return fixes
  }
  const byTarget = new Map<Aisle, string[]>()
  for (const f of fixes) byTarget.set(f.to, [...(byTarget.get(f.to) ?? []), f.id])
  for (const [to, ids] of byTarget) {
    await db.update(ingredients).set({ aisle: to }).where(inArray(ingredients.id, ids))
  }
  log(`[catalog-ingredient-aisles] ${fixes.length} ingredientes cambiados de pasillo: ${fixes.map((f) => `${f.name} → ${f.to}`).join(', ')}`)
  return fixes
}
