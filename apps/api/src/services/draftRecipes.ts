/**
 * PRO-1119 (D-164.1): cuántas recetas esperan en borrador el visto bueno de
 * Miguel, para que el brief lo recuerde cada día (la oficina no lee Admin).
 *
 * `/admin/metrics` → `recipes: { draft, draftByBatch: { <lote>: N } }`: solo
 * recuentos y nombres de lote (`recipes.import_batch`; `sin-lote` si no tiene).
 * Spec: specs/metrics.md, specs/catalog-import.md.
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'

type Db = typeof defaultDb

/** La clave de `draftByBatch` para un borrador sin `import_batch`. */
export const NO_BATCH = 'sin-lote'

export interface DraftRecipesSummary {
  draft: number
  draftByBatch: Record<string, number>
}

/** Puro: las filas `{ batch, n }` de la consulta al bloque `recipes` (pg da los recuentos como texto). */
export function toDraftRecipesSummary(rows: Array<{ batch: unknown; n: unknown }>): DraftRecipesSummary {
  const draftByBatch: Record<string, number> = {}
  let draft = 0
  for (const r of rows) {
    const n = Number(r.n) || 0
    if (n <= 0) continue
    const key = typeof r.batch === 'string' && r.batch.trim() ? r.batch : NO_BATCH
    draftByBatch[key] = (draftByBatch[key] ?? 0) + n
    draft += n
  }
  return { draft, draftByBatch }
}

/** `recipes` de `/admin/metrics`. */
export async function loadDraftRecipes(db: Db = defaultDb): Promise<DraftRecipesSummary> {
  const res = await db.execute(sql`
    SELECT import_batch AS batch, count(*)::int AS n FROM recipes WHERE status = 'draft' GROUP BY import_batch ORDER BY import_batch
  `)
  return toDraftRecipesSummary(res.rows as any[])
}
