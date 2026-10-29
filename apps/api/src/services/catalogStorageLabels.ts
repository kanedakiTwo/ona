/**
 * PRO-372: the catalogue recipes that already exist get their storage seals
 * («Se puede congelar» / «No se congela», «Aguanta N días en nevera»;
 * specs/recipes.md → Conservación). New ones bring them from the batch or
 * the house rewrite (catalogImport.ts); this fills the rest in the
 * background, in the API, like catalogPhotos.ts.
 *
 * 60 s after boot and every hour: the catalogue recipes (no author) missing
 * one of the two, 20 at a time, one Claude call per 20 (the rewriter's
 * model, cost `catalog_storage_labels` on Mimoia). Only empty columns are
 * written: what Cocina set is never overwritten, and users' recipes are
 * never touched. A recipe the model isn't sure about stays without the seal
 * and isn't asked again until the next boot.
 */
import Anthropic from '@anthropic-ai/sdk'
import { and, asc, eq, inArray, isNull, or, sql } from 'drizzle-orm'
import { env } from '../config/env.js'
import { db } from '../db/connection.js'
import { ingredients, recipeIngredients, recipes } from '../db/schema.js'
import { cleanFridgeDays } from './catalogImport.js'
import { REWRITE_MODEL } from './catalogRewriter.js'
import { recordAnthropicCost, runWithCostUser } from './costLedger.js'

export const STORAGE_LABEL_BATCH = 20

export interface StorageCandidate {
  id: string
  name: string
  authorId: string | null
  freezable: boolean | null
  fridgeDays: number | null
}

export interface StorageLabelInput {
  id: string
  name: string
  ingredients: string[]
}

export interface StorageLabel {
  id: string
  freezable: boolean | null
  fridgeDays: number | null
}

/**
 * Pure: the next lot to label — catalogue recipes (no author) missing a seal,
 * not tried yet in this process, at most 20, in the order given.
 */
export function storageLabelBatch(rows: readonly StorageCandidate[], tried: ReadonlySet<string> = new Set()): StorageCandidate[] {
  return rows
    .filter((r) => r.authorId == null && (r.freezable == null || r.fridgeDays == null) && !tried.has(r.id))
    .slice(0, STORAGE_LABEL_BATCH)
}

export const STORAGE_LABEL_PROMPT = `Eres el equipo de cocina de Mimoia, un planificador de menús para hogares en España.
Te paso una lista numerada de recetas (nombre e ingredientes). Para cada una, di cómo se conserva el plato ya hecho:
- "freezable": true si se puede congelar y queda bien al descongelarlo; false si no (ensaladas crudas, fritos crujientes, salsas que se cortan, patata cocida en trozos…); null si no lo tienes claro.
- "fridgeDays": días que aguanta en la nevera, en un táper cerrado, de 1 a 5 (pescado y marisco, 1 o 2; guisos y legumbres, 3 o 4); null si no lo tienes claro.

Devuelve SOLO un JSON con esta forma, sin markdown, con una entrada por receta y su número:
{"recipes":[{"n":1,"freezable":true,"fridgeDays":3}]}`

/** Pure: the user message for one lot. */
export function storageLabelMessage(lot: readonly StorageLabelInput[]): string {
  return lot.map((r, i) => `${i + 1}. ${r.name}${r.ingredients.length ? ` — ${r.ingredients.join(', ')}` : ''}`).join('\n')
}

/** Pure: the model's answer for `lot` (tolerates a ``` fence or prose around it). Unknown numbers are dropped. */
export function parseStorageLabels(text: string, lot: readonly { id: string }[]): StorageLabel[] {
  let parsed: any
  try {
    parsed = JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) throw new Error('El etiquetado de conservación no devolvió JSON')
    parsed = JSON.parse(m[0])
  }
  const out = new Map<string, StorageLabel>()
  for (const e of Array.isArray(parsed?.recipes) ? parsed.recipes : []) {
    const r = Number.isInteger(e?.n) ? lot[e.n - 1] : undefined
    if (!r || out.has(r.id)) continue
    out.set(r.id, { id: r.id, freezable: typeof e.freezable === 'boolean' ? e.freezable : null, fridgeDays: cleanFridgeDays(e.fridgeDays) })
  }
  return [...out.values()]
}

export interface StorageSweepDeps {
  load: () => Promise<StorageCandidate[]>
  ingredientsOf: (ids: string[]) => Promise<Map<string, string[]>>
  label: (lot: StorageLabelInput[]) => Promise<StorageLabel[]>
  /** Writes only the empty columns, only on catalogue recipes. */
  save: (labels: StorageLabel[]) => Promise<void>
  log: (line: string) => void
}

export interface StorageSweepResult {
  lots: number
  labelled: number
  failed: number
}

/**
 * One pass (deps injected): lots of 20 until every catalogue recipe without a
 * seal has been asked about once. `tried` lives across passes, so a recipe
 * the model left unsure isn't paid for again on every pass. A failed call
 * logs and releases its lot for the next pass.
 */
export async function sweepCatalogStorageLabels(deps: StorageSweepDeps, tried: Set<string> = new Set()): Promise<StorageSweepResult> {
  const out: StorageSweepResult = { lots: 0, labelled: 0, failed: 0 }
  const rows = await deps.load()
  for (;;) {
    const lot = storageLabelBatch(rows, tried)
    if (lot.length === 0) break
    for (const r of lot) tried.add(r.id)
    out.lots += 1
    try {
      const ings = await deps.ingredientsOf(lot.map((r) => r.id))
      const labels = (await deps.label(lot.map((r) => ({ id: r.id, name: r.name, ingredients: ings.get(r.id) ?? [] }))))
        .filter((l) => lot.some((r) => r.id === l.id) && (l.freezable != null || l.fridgeDays != null))
      if (labels.length > 0) await deps.save(labels)
      out.labelled += labels.length
    } catch (err) {
      out.failed += lot.length
      deps.log(`[catalogStorageLabels] lot failed: ${(err as Error)?.message ?? err}`)
      // The pass stops here; the lot is asked again on the next one.
      for (const r of lot) tried.delete(r.id)
      break
    }
  }
  return out
}

function createAnthropicLabeller(): (lot: StorageLabelInput[]) => Promise<StorageLabel[]> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  return async (lot) => {
    const response = await client.messages.create({
      model: REWRITE_MODEL,
      max_tokens: 2000,
      system: STORAGE_LABEL_PROMPT,
      messages: [{ role: 'user', content: storageLabelMessage(lot) }],
    })
    recordAnthropicCost('catalog_storage_labels', REWRITE_MODEL, response.usage, null)
    const block = response.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') throw new Error('El etiquetado de conservación no devolvió texto')
    return parseStorageLabels(block.text, lot)
  }
}

function realDeps(): StorageSweepDeps {
  return {
    load: () =>
      db
        .select({ id: recipes.id, name: recipes.name, authorId: recipes.authorId, freezable: recipes.freezable, fridgeDays: recipes.fridgeDays })
        .from(recipes)
        .where(and(isNull(recipes.authorId), or(isNull(recipes.freezable), isNull(recipes.fridgeDays))))
        .orderBy(asc(recipes.createdAt)),
    ingredientsOf: async (ids) => {
      const rows = await db
        .select({ recipeId: recipeIngredients.recipeId, name: ingredients.name })
        .from(recipeIngredients)
        .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
        .where(inArray(recipeIngredients.recipeId, ids))
        .orderBy(asc(recipeIngredients.displayOrder))
      const out = new Map<string, string[]>()
      for (const r of rows) out.set(r.recipeId, [...(out.get(r.recipeId) ?? []), r.name])
      return out
    },
    label: createAnthropicLabeller(),
    save: async (labels) => {
      for (const l of labels) {
        await db
          .update(recipes)
          .set({
            freezable: sql`COALESCE(${recipes.freezable}, ${l.freezable})`,
            fridgeDays: sql`COALESCE(${recipes.fridgeDays}, ${l.fridgeDays}::smallint)`,
          })
          .where(and(eq(recipes.id, l.id), isNull(recipes.authorId)))
      }
    },
    log: (line) => console.warn(line),
  }
}

const INTERVAL_MS = 60 * 60_000
const FIRST_RUN_MS = 60_000

const tried = new Set<string>()
let running: Promise<void> | null = null
let timer: ReturnType<typeof setInterval> | null = null

function enabled(): boolean {
  return !!env.ANTHROPIC_API_KEY && process.env.NODE_ENV !== 'test' && !process.env.VITEST
}

/** One pass now, unless one is running. Fire-and-forget. */
export function wakeCatalogStorageLabels(): void {
  if (!enabled() || running) return
  running = runWithCostUser(null, async () => {
    try {
      const r = await sweepCatalogStorageLabels(realDeps(), tried)
      if (r.lots) console.info(`[catalogStorageLabels] ${r.labelled} recipes labelled in ${r.lots} lots, ${r.failed} failed`)
    } catch (err) {
      console.warn('[catalogStorageLabels] pass failed:', (err as Error)?.message ?? err)
    }
  }).finally(() => {
    running = null
  })
}

/** Boot: a first pass in 60 s, then every hour. Idempotent. */
export function startCatalogStorageLabels(): void {
  if (timer || !enabled()) return
  setTimeout(wakeCatalogStorageLabels, FIRST_RUN_MS).unref?.()
  timer = setInterval(wakeCatalogStorageLabels, INTERVAL_MS)
  timer.unref?.()
}
