#!/usr/bin/env tsx
/**
 * Cocina's recipe batches → JSONL for applyRegeneratedRecipes.ts.
 *
 * Ingredients already in the catalog resolve to their id by name (accents and
 * case ignored); the rest pass by name so `apply:recipes` (auto-create-missing
 * is on by default) creates them through USDA before linting.
 *
 *   DATABASE_URL=… tsx scripts/cocinaTanda.ts --file=<recetas.json> --out=<salida.jsonl>
 *   DATABASE_URL=… tsx scripts/applyRegeneratedRecipes.ts --input=<salida.jsonl> [--dry-run] [--force --soft-lint]
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import { db, pool } from '../src/db/connection.js'
import { ingredients } from '../src/db/schema.js'

interface IngLine {
  name: string
  qty: number
  unit: string
  optional?: boolean
  note?: string
  section?: string
}

interface StepLine {
  text: string
  durationMin?: number
  temperature?: number
  technique?: string
  /** Ingredient names this step uses. */
  refs?: string[]
}

interface AuthoredRecipe {
  name: string
  servings: number
  yieldText?: string
  prepTime?: number
  cookTime?: number
  activeTime?: number
  difficulty: 'easy' | 'medium' | 'hard'
  meals: string[]
  seasons: string[]
  equipment: string[]
  tags?: string[]
  notes?: string
  tips?: string
  substitutions?: string
  storage?: string
  ingredients: IngLine[]
  steps: StepLine[]
}

const arg = (k: string) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3)
const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').trim()

async function main() {
  const file = arg('file')
  const outArg = arg('out')
  if (!file || !outArg) throw new Error('usage: --file=<recetas.json> --out=<salida.jsonl>')

  const raw = JSON.parse(await fs.readFile(path.resolve(file), 'utf8'))
  const recipes: AuthoredRecipe[] = Array.isArray(raw) ? raw : raw.recetas

  const catalog = await db.select({ id: ingredients.id, name: ingredients.name }).from(ingredients)
  const byName = new Map<string, string>()
  for (const c of catalog) byName.set(norm(c.name), c.id)

  const created = new Set<string>()
  const out = recipes.map((r) => {
    const resolvedIngredients = r.ingredients.map((ing, i) => {
      const id = byName.get(norm(ing.name))
      if (!id) created.add(ing.name)
      return {
        id: `ing_${i}`,
        ingredientId: id ?? ing.name,
        quantity: ing.qty,
        unit: ing.unit,
        optional: ing.optional ?? false,
        note: ing.note,
        section: ing.section,
        displayOrder: i,
      }
    })
    const refByName = new Map<string, string>()
    r.ingredients.forEach((ing, i) => refByName.set(norm(ing.name), `ing_${i}`))
    const resolvedSteps = r.steps.map((s, idx) => ({
      index: idx,
      text: s.text,
      durationMin: s.durationMin,
      temperature: s.temperature,
      technique: s.technique,
      ingredientRefs: (s.refs ?? [])
        .map((n) => refByName.get(norm(n)))
        .filter((x): x is string => Boolean(x)),
    }))
    return {
      name: r.name,
      servings: r.servings,
      yieldText: r.yieldText,
      prepTime: r.prepTime,
      cookTime: r.cookTime,
      activeTime: r.activeTime,
      difficulty: r.difficulty,
      meals: r.meals,
      seasons: r.seasons,
      equipment: r.equipment,
      tags: r.tags ?? [],
      internalTags: ['compartida'],
      notes: r.notes,
      tips: r.tips,
      substitutions: r.substitutions,
      storage: r.storage,
      ingredients: resolvedIngredients,
      steps: resolvedSteps,
    }
  })

  const outPath = path.resolve(outArg)
  await fs.mkdir(path.dirname(outPath), { recursive: true })
  await fs.writeFile(outPath, out.map((r) => JSON.stringify(r)).join('\n') + '\n', 'utf8')
  console.log(`Recetas: ${out.length} → ${outPath}`)
  console.log(
    `Ingredientes que no están en el catálogo (se crean al aplicar): ${[...created].join(', ') || 'ninguno'}`,
  )
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[cocina] Fatal:', err)
    process.exit(1)
  })
  .finally(async () => {
    await pool?.end?.().catch(() => undefined)
  })
