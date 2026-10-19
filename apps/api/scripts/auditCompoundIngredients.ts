#!/usr/bin/env tsx
/**
 * PRO-198 — read-only list of the compound ingredients of the catalogue
 * («Sobras de…», «Caldo…», «Cocido», embutidos, fiambres, patés…) that don't
 * say yet what they contain (`ingredients.contains_tags` empty). Without that
 * label a diet filter only sees the name: «sin cerdo» let «Sobras del cocido
 * madrileño» through. Cocina labels each row (PATCH /ingredients/:id with
 * `containsTags`, values in `CONTAINS_TAGS`) without going through Miguel.
 *
 *   DATABASE_URL=… pnpm --filter @ona/api exec tsx scripts/auditCompoundIngredients.ts [--json]
 *   pnpm --filter @ona/api exec tsx scripts/auditCompoundIngredients.ts --fixture=src/tests/fixtures/catalog-quantities-2026-10-15.json
 *
 *   --fixture=…  read ingredient names from a catalogue snapshot (no tags: lists every compound)
 *   --json       print JSON instead of text
 */
import { readFileSync } from 'node:fs'
import { CONTAINS_TAGS, compoundIngredientsWithoutTags, knownCompoundTags, type AuditableIngredient } from '../src/services/compoundIngredients.js'

const argv = process.argv.slice(2)
const asJson = argv.includes('--json')
const fixture = argv.find((a) => a.startsWith('--fixture='))?.slice('--fixture='.length)

function fromFixture(path: string): AuditableIngredient[] {
  const data = JSON.parse(readFileSync(path, 'utf8')) as Array<{ ingredients?: Array<string | { name?: string; ingredientName?: string }> }>
  const counts = new Map<string, number>()
  for (const r of data) {
    for (const i of r.ingredients ?? []) {
      const name = typeof i === 'string' ? i : (i.name ?? i.ingredientName)
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
  }
  return [...counts].map(([name, recipeCount]) => ({ name, recipeCount, containsTags: [] }))
}

async function fromDatabase(): Promise<AuditableIngredient[]> {
  const { db, pool } = await import('../src/db/connection.js')
  const { ingredients, recipeIngredients } = await import('../src/db/schema.js')
  const { count, eq } = await import('drizzle-orm')
  try {
    const rows = await db
      .select({ id: ingredients.id, name: ingredients.name, containsTags: ingredients.containsTags, recipeCount: count(recipeIngredients.id) })
      .from(ingredients)
      .leftJoin(recipeIngredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .groupBy(ingredients.id)
    return rows.map((r) => ({ ...r, recipeCount: Number(r.recipeCount) }))
  } finally {
    await pool.end()
  }
}

async function main() {
  const rows = fixture ? fromFixture(fixture) : await fromDatabase()
  const missing = compoundIngredientsWithoutTags(rows).map((r) => ({
    id: r.id ?? null,
    name: r.name,
    recipes: r.recipeCount ?? 0,
    /** What `applyCompoundIngredientTags` would set on the next boot, if anything. */
    known: knownCompoundTags(r.name),
  }))
  if (asJson) {
    console.log(JSON.stringify({ allowedTags: CONTAINS_TAGS, missing }, null, 2))
    return
  }
  console.log(`Ingredientes compuestos sin etiqueta de lo que contienen: ${missing.length}`)
  for (const m of missing) {
    console.log(`- ${m.name} · ${m.recipes} receta(s)${m.known ? ` · al arrancar: ${m.known.join(', ')}` : ''}`)
  }
  console.log(`\nEtiquetas posibles: ${CONTAINS_TAGS.join(', ')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
