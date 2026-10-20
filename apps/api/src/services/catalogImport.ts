/**
 * Catalogue import by batches (PRO-154, D-065, specs/catalog-import.md).
 *
 * One recipe at a time, every recipe of a batch goes through:
 *
 *   source (page photo / PDF page / Cocina JSON)
 *     → duplicate check against the catalogue (published + drafts) and the batch
 *     → frying/confit oil: note «para freír…» / «para confitar…», mixed
 *       lines split in two (PRO-195)
 *     → quantities for 4
 *     → steps rewritten in the house's own words (never the book's text) +
 *       tags (meal, season, dish type, protein, technique, cuisine, active and
 *       total time, difficulty) + allergen doubts — one AI call
 *     → phrase check: a step that keeps 7 words in a row of the source is
 *       rewritten once more, then the recipe is rejected (never saved)
 *     → ingredients matched to the catalogue, new ones created automatically
 *     → audit (catalogRecipeAudit) and reviewer (recipeLint, inside
 *       persistRecipe), nutrition and allergens (persistRecipe)
 *     → saved as a `draft` with its source (book + page, no text).
 *
 * Publishing is a separate step (`planBatchPublish`): Miguel's sources go out
 * when they pass the audit; Cocina's need Miguel's OK on one in ten (random)
 * plus every recipe with an allergen doubt.
 *
 * Everything that talks to the AI or the database is injected (`CatalogImportDeps`)
 * so the orchestration is tested without either.
 */
import type { Difficulty, Meal, Season, Unit } from '@ona/shared'
import { COURSES, DIFFICULTIES, MEALS, SEASONS, UNITS } from '@ona/shared'
import { auditCatalogRecipe, type CatalogAuditIssue } from './catalogRecipeAudit.js'
import { dishKey } from './catalogWishes.js'
import { levenshtein, normalize } from './recipeLint.js'
import { isCookingMediumNote, isFatName } from './nutrition/cookingMedium.js'
import type { CatalogSourceInfo } from '../db/schema.js'

export type CatalogOrigin = 'miguel' | 'cocina'

export interface CatalogSourceRef {
  origin: CatalogOrigin
  /** Book or collection title («Recetario de mamá»). */
  book?: string | null
  /** Page (or pages) in that book. */
  page?: string | null
  /** File the recipe came from, relative to the batch folder. */
  file?: string | null
  /**
   * The line the recipe page shows under the title, as it must read (D-067):
   * «Receta de la Yaya», «Inspirada en una receta de <autor>, «<libro>»».
   * Without it, `catalogSourceCredit` falls back to the book for Miguel's sources.
   */
  credit?: string | null
}

export interface DraftIngredient {
  name: string
  quantity: number
  unit: string
  note?: string | null
  optional?: boolean
  section?: string | null
}

/** A recipe as read from its source, before the house rewrite. */
export interface CatalogDraftInput {
  name: string
  servings: number
  prepTime?: number | null
  cookTime?: number | null
  difficulty?: string | null
  meals?: string[]
  seasons?: string[]
  tags?: string[]
  equipment?: string[]
  ingredients: DraftIngredient[]
  /** The source's steps. Read to rewrite them; never saved. */
  sourceSteps: string[]
  source: CatalogSourceRef
}

export interface RewrittenStep {
  text: string
  durationMin?: number | null
  temperature?: number | null
  technique?: string | null
  /** 0-based indexes into the recipe's ingredient list. */
  ingredientRefs?: number[]
}

/** What the house rewrite returns. */
export interface CatalogRewrite {
  steps: RewrittenStep[]
  meals: string[]
  seasons: string[]
  course: string | null
  /** «guiso», «crema», «ensalada», «arroz»… */
  dishType: string | null
  /** Main protein: «pollo», «legumbre», «pescado blanco», «ninguna»… */
  protein: string | null
  techniques: string[]
  cuisine: string | null
  activeTime: number | null
  totalTime: number | null
  difficulty: string | null
  /** True when an allergen can't be ruled out from the ingredients (trazas, «salsa al gusto»…). */
  allergenDoubt: boolean
  allergenNote?: string | null
  /** Short house note (optional), in our words. */
  tips?: string | null
}

export interface MatchedIngredient {
  ingredientId: string | null
  name: string
  quantity: number
  unit: Unit
  unitWeight?: number | null
  density?: number | null
  edibleFraction?: number | null
}

export interface PersistDraftInput {
  name: string
  servings: number
  prepTime: number | null
  cookTime: number | null
  difficulty: Difficulty
  meals: Meal[]
  seasons: Season[]
  course: string | null
  equipment: string[]
  tags: string[]
  internalTags: string[]
  tips: string | null
  ingredients: Array<{ ingredientId: string; quantity: number; unit: Unit; note: string | null; optional: boolean; section: string | null; displayOrder: number }>
  steps: Array<{ index: number; text: string; durationMin: number | null; temperature: number | null; technique: string | null; ingredientRefs: string[] }>
  catalogSource: CatalogSourceRef & { batch: string; auditIssues: CatalogAuditIssue[]; allergenDoubt: boolean }
}

export interface CatalogImportDeps {
  /** Names already in the catalogue (published and drafts). */
  catalogNames: () => Promise<string[]>
  rewrite: (draft: CatalogDraftInput, opts: { avoidPhrases?: string[] }) => Promise<CatalogRewrite>
  /** Same order as the input; ingredientId null = couldn't match nor create. */
  matchIngredients: (recipeName: string, ings: DraftIngredient[]) => Promise<MatchedIngredient[]>
  persistDraft: (input: PersistDraftInput) => Promise<{ ok: true; recipeId: string } | { ok: false; errors: string[] }>
  log?: (line: string) => void
}

export type ImportOutcome =
  | { name: string; source: CatalogSourceRef; status: 'draft'; recipeId: string; auditIssues: CatalogAuditIssue[]; allergenDoubt: boolean }
  | { name: string; source: CatalogSourceRef; status: 'duplicate'; duplicateOf: string }
  | { name: string; source: CatalogSourceRef; status: 'rejected'; reason: 'no_es_receta' | 'copia_del_libro' | 'ingredientes' | 'revisor' | 'error'; detail?: string }

export const HOUSE_SERVINGS = 4
/** Words in a row shared with the source that count as copying. */
export const COPY_RUN_WORDS = 7

// ─── Pure helpers ───────────────────────────────────────────────

function words(text: string): string[] {
  return normalize(text).split(/[^a-z0-9]+/).filter(Boolean)
}

/**
 * Pure: runs of `n` words in a row that a written text shares with the
 * source (accents and punctuation ignored). Empty = written in our words.
 */
export function copiedPhrases(source: readonly string[], written: readonly string[], n: number = COPY_RUN_WORDS): string[] {
  const grams = new Set<string>()
  for (const s of source) {
    const w = words(s)
    for (let i = 0; i + n <= w.length; i++) grams.add(w.slice(i, i + n).join(' '))
  }
  const out = new Set<string>()
  for (const t of written) {
    const w = words(t)
    for (let i = 0; i + n <= w.length; i++) {
      const g = w.slice(i, i + n).join(' ')
      if (grams.has(g)) out.add(g)
    }
  }
  return [...out]
}

/**
 * Pure: the catalogue recipe this one repeats, or null. Same dish when the
 * significant words match (accents, plurals, order and filler words aside:
 * «Tortilla de patatas» = «Tortilla de patata») or the names are one or two
 * letters apart.
 */
export function findDuplicate(name: string, catalog: readonly string[]): string | null {
  const key = dishKey(name)
  const norm = normalize(name)
  if (!key) return null
  for (const other of catalog) {
    if (dishKey(other) === key) return other
    const o = normalize(other)
    if (norm.length >= 8 && Math.abs(o.length - norm.length) <= 2 && levenshtein(o, norm) <= 2) return other
  }
  return null
}

function roundQty(q: number, unit: string): number {
  if (unit === 'u') return Math.max(0.5, Math.round(q * 2) / 2)
  if (unit === 'cda' || unit === 'cdita') return Math.max(0.25, Math.round(q * 4) / 4)
  if (q >= 10) return Math.round(q)
  return Math.round(q * 10) / 10
}

/** Pure: quantities for 4 people. «al gusto» and «pizca» don't scale. */
export function scaleToHouseServings(ings: readonly DraftIngredient[], servings: number): DraftIngredient[] {
  const from = Number.isFinite(servings) && servings > 0 ? servings : HOUSE_SERVINGS
  if (from === HOUSE_SERVINGS) return ings.map((i) => ({ ...i }))
  const k = HOUSE_SERVINGS / from
  return ings.map((i) => (i.unit === 'al_gusto' || i.unit === 'pizca' || !(i.quantity > 0) ? { ...i } : { ...i, quantity: roundQty(i.quantity * k, i.unit) }))
}

// ─── Frying / confit oil (PRO-195) ──────────────────────────────

const ML_PER: Record<string, number> = { ml: 1, cda: 15, cdas: 15, cucharada: 15, cucharadas: 15, cdita: 5, cditas: 5, cucharadita: 5, cucharaditas: 5 }
const MEDIUM_PHRASE = /\bpara\s+(?:freir|la\s+fritura|confitar)\b|\b(?:freir|fritura|confitar)\b/
const NAME_MEDIUM = /\s*,?\s*para\s+(?:freír|freir|la\s+fritura|confitar)\b.*$/i
const MIXED_NOTE = /^\s*(\d+(?:[.,]\d+)?)\s*(ml|g|cdas?|cucharadas?|cditas?|cucharaditas?)\s+(para\s+[^,;]+?)\s*(?:,|\by\b)\s*(?:el\s+resto|lo\s+dem[aá]s)\s+(para\s+(?:freír|freir|la\s+fritura|confitar)\b[^;]*)$/i

function foldText(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/\p{Mn}/gu, '').trim()
}

/** «para freír» or «para confitar», by what the text says. */
function mediumLabel(text: string): string {
  return /confitar/.test(foldText(text)) ? 'para confitar' : 'para freír'
}

/** Amount of `qty unitFrom` expressed in `unitTo`, or null when they don't convert. */
function convertAmount(qty: number, unitFrom: string, unitTo: string): number | null {
  const from = unitFrom.toLowerCase()
  if (from === unitTo) return qty
  if (from === 'g' || unitTo === 'g') return null
  const a = ML_PER[from]
  const b = ML_PER[unitTo]
  return a && b ? (qty * a) / b : null
}

/**
 * Pure (PRO-195): the oil that is only the frying or confit medium gets a
 * note that starts with «para freír» / «para confitar», so nutrition counts
 * only what the food absorbs (`cookingMedium.ts`) and the reviewer accepts
 * the amount. A mixed line («540 ml, 40 ml para el sofrito y el resto para
 * freír») is split into two lines. Lines that aren't a fat, notes that
 * already start right, and mixed notes it can't read are left as they are.
 */
export function markCookingMediumLines(ings: readonly DraftIngredient[]): DraftIngredient[] {
  const out: DraftIngredient[] = []
  for (const ing of ings) {
    let name = ing.name
    let note = ing.note?.trim() || null
    if (!isFatName(name)) {
      out.push({ ...ing })
      continue
    }
    // «Aceite de girasol para freír» as the name: the purpose goes to the note.
    if (NAME_MEDIUM.test(name)) {
      const purpose = name.match(NAME_MEDIUM)![0].replace(/^\s*,?\s*/, '')
      name = name.replace(NAME_MEDIUM, '').trim()
      note = note ? `${mediumLabel(purpose)}; ${note}` : mediumLabel(purpose)
    }
    if (!note || isCookingMediumNote(note)) {
      out.push({ ...ing, name, note })
      continue
    }
    const mixed = note.match(MIXED_NOTE)
    if (mixed) {
      const other = convertAmount(Number(mixed[1].replace(',', '.')), mixed[2], ing.unit)
      const rest = other != null ? ing.quantity - other : 0
      if (other != null && other > 0 && rest > 0) {
        out.push({ ...ing, name, quantity: roundQty(other, ing.unit), note: mixed[3].trim() })
        out.push({ ...ing, name, quantity: roundQty(rest, ing.unit), note: mixed[4].trim() })
        continue
      }
      out.push({ ...ing, name, note })
      continue
    }
    const folded = foldText(note)
    // Only the medium: «abundante para freír», «para la fritura», «de freír».
    const purposes = (folded.match(/\bpara\b/g) ?? []).length
    if (MEDIUM_PHRASE.test(folded) && purposes <= 1) {
      // «abundante para freír las patatas» → «para freír las patatas; abundante»
      const tail = note.match(/para\s+(?:freír|freir|la\s+fritura|confitar)\b.*$/i)
      const before = (tail ? note.slice(0, tail.index) : note.replace(/\s*,?\s*(?:de\s+|para\s+)?(?:freír|freir|la\s+fritura|fritura|confitar)\b/i, ''))
        .replace(/^[\s,;]+|[\s,;]+$/g, '')
      const head = tail ? tail[0].trim() : mediumLabel(note)
      out.push({ ...ing, name, note: before ? `${head}; ${before}` : head })
      continue
    }
    out.push({ ...ing, name, note })
  }
  return out
}

const pick = <T extends string>(allowed: readonly T[], vals: readonly string[] | undefined, fallback: T[]): T[] => {
  const out = (vals ?? []).filter((v): v is T => (allowed as readonly string[]).includes(v))
  return out.length > 0 ? [...new Set(out)] : fallback
}

function slug(s: string): string {
  return normalize(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/** Pure: the rewrite's labels as public tags + hidden tags. */
export function catalogTags(r: CatalogRewrite, extra: readonly string[] = []): { tags: string[]; internalTags: string[] } {
  const tags = new Set<string>(extra.map((t) => t.trim().toLowerCase()).filter(Boolean))
  if (r.dishType) tags.add(r.dishType.toLowerCase())
  if (r.cuisine) tags.add(r.cuisine.toLowerCase())
  const internal = new Set<string>(['catalogo-tanda'])
  if (r.dishType) internal.add(`tipo:${slug(r.dishType)}`)
  if (r.protein) internal.add(`proteina:${slug(r.protein)}`)
  for (const t of r.techniques ?? []) if (t) internal.add(`tecnica:${slug(t)}`)
  if (r.cuisine) internal.add(`cocina:${slug(r.cuisine)}`)
  if (r.allergenDoubt) internal.add('alergenos:duda')
  return { tags: [...tags], internalTags: [...internal] }
}

/** Pure: active + total minutes → prep + cook (persistRecipe derives the total from them). */
export function timesFrom(r: CatalogRewrite, draft: CatalogDraftInput): { prepTime: number | null; cookTime: number | null } {
  const active = r.activeTime ?? draft.prepTime ?? null
  const total = r.totalTime ?? (draft.prepTime != null || draft.cookTime != null ? (draft.prepTime ?? 0) + (draft.cookTime ?? 0) : null)
  if (active == null && total == null) return { prepTime: null, cookTime: null }
  if (active == null) return { prepTime: null, cookTime: total }
  if (total == null || total < active) return { prepTime: active, cookTime: null }
  return { prepTime: active, cookTime: total - active || null }
}

// ─── Where the recipe comes from (D-067) ────────────────────────

function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = v.replace(/\s+/g, ' ').trim()
  return s || null
}

/**
 * Pure (D-067): the line the recipe page shows under the title, from
 * `recipes.catalog_source`. The `credit` as written («Receta de la Yaya»,
 * «Inspirada en una receta de <autor>, «<libro>»»); without one, a book of
 * Miguel's (`origin: 'miguel'`) reads «Inspirada en <libro>». Cocina's
 * recipes (found or written by Cocina) and every other recipe: null.
 */
export function catalogSourceCredit(source: { origin?: unknown; book?: unknown; credit?: unknown } | null | undefined): string | null {
  if (!source || typeof source !== 'object') return null
  const credit = cleanText(source.credit)
  if (credit) return credit
  const book = cleanText(source.book)
  return book && source.origin === 'miguel' ? `Inspirada en ${book}` : null
}

/** Pure: what is kept in `recipes.catalog_source` — the reference (never the text), the batch and the audit. */
export function catalogSourceRecord(src: PersistDraftInput['catalogSource']): CatalogSourceInfo {
  return {
    origin: src.origin,
    book: src.book ?? null,
    page: src.page ?? null,
    file: src.file ?? null,
    credit: cleanText(src.credit),
    batch: src.batch,
    auditIssues: src.auditIssues,
    allergenDoubt: src.allergenDoubt,
  }
}

// ─── Orchestration ──────────────────────────────────────────────

export async function importCatalogRecipe(
  draft: CatalogDraftInput,
  batch: string,
  deps: CatalogImportDeps,
  known: string[],
): Promise<ImportOutcome> {
  const base = { name: draft.name, source: draft.source }
  if (!draft.name?.trim() || draft.ingredients.length === 0) return { ...base, status: 'rejected', reason: 'no_es_receta' }

  const dup = findDuplicate(draft.name, known)
  if (dup) return { ...base, status: 'duplicate', duplicateOf: dup }

  // Frying/confit oil marked (and mixed lines split) before scaling, while
  // the amounts in a note still match the line's (PRO-195).
  const ingredients = scaleToHouseServings(markCookingMediumLines(draft.ingredients), draft.servings)
  const forFour: CatalogDraftInput = { ...draft, servings: HOUSE_SERVINGS, ingredients }

  let rewrite = await deps.rewrite(forFour, {})
  let copied = copiedPhrases(draft.sourceSteps, [...rewrite.steps.map((s) => s.text), rewrite.tips ?? ''])
  if (copied.length > 0) {
    deps.log?.(`  ↻ ${draft.name}: reescribiendo otra vez (${copied.length} frase(s) iguales al libro)`)
    rewrite = await deps.rewrite(forFour, { avoidPhrases: copied })
    copied = copiedPhrases(draft.sourceSteps, [...rewrite.steps.map((s) => s.text), rewrite.tips ?? ''])
    if (copied.length > 0) return { ...base, status: 'rejected', reason: 'copia_del_libro', detail: `${copied.length} frase(s) iguales al libro` }
  }
  if (rewrite.steps.length === 0) return { ...base, status: 'rejected', reason: 'no_es_receta', detail: 'sin pasos' }

  const matched = await deps.matchIngredients(draft.name, ingredients)
  const missing = matched.filter((m) => !m.ingredientId).map((m) => m.name)
  if (missing.length > 0) return { ...base, status: 'rejected', reason: 'ingredientes', detail: `sin ingrediente en el catálogo: ${missing.join(', ')}` }

  const audit = auditCatalogRecipe({
    name: draft.name,
    servings: HOUSE_SERVINGS,
    stepCount: rewrite.steps.length,
    ingredients: matched.map((m) => ({ name: m.name, quantity: m.quantity, unit: m.unit, unitWeight: m.unitWeight ?? null, density: m.density ?? null, edibleFraction: m.edibleFraction ?? null })),
  })
  const { tags, internalTags } = catalogTags(rewrite, draft.tags ?? [])
  const { prepTime, cookTime } = timesFrom(rewrite, draft)
  const n = ingredients.length
  const course = rewrite.course && (COURSES as readonly string[]).includes(rewrite.course) ? rewrite.course : null
  const difficulty = ((DIFFICULTIES as readonly string[]).includes(rewrite.difficulty ?? '') ? rewrite.difficulty : (DIFFICULTIES as readonly string[]).includes(draft.difficulty ?? '') ? draft.difficulty : 'medium') as Difficulty

  const saved = await deps.persistDraft({
    name: draft.name.trim(),
    servings: HOUSE_SERVINGS,
    prepTime,
    cookTime,
    difficulty,
    meals: pick(MEALS, rewrite.meals?.length ? rewrite.meals : draft.meals, ['lunch', 'dinner']),
    seasons: pick(SEASONS, rewrite.seasons?.length ? rewrite.seasons : draft.seasons, [...SEASONS]),
    course,
    equipment: draft.equipment ?? [],
    tags,
    internalTags,
    tips: rewrite.tips?.trim() || null,
    ingredients: matched.map((m, i) => ({
      ingredientId: m.ingredientId as string,
      quantity: m.quantity,
      unit: (UNITS as readonly string[]).includes(m.unit) ? m.unit : 'g',
      note: ingredients[i].note ?? null,
      optional: ingredients[i].optional ?? false,
      section: ingredients[i].section ?? null,
      displayOrder: i,
    })),
    steps: rewrite.steps.map((s, index) => ({
      index,
      text: s.text.trim(),
      durationMin: s.durationMin ?? null,
      temperature: s.temperature ?? null,
      technique: s.technique ?? null,
      ingredientRefs: [...new Set((s.ingredientRefs ?? []).filter((k) => Number.isInteger(k) && k >= 0 && k < n))].map((k) => `ing_${k}`),
    })),
    catalogSource: { ...draft.source, batch, auditIssues: audit.issues, allergenDoubt: !!rewrite.allergenDoubt },
  })
  if (!saved.ok) return { ...base, status: 'rejected', reason: 'revisor', detail: saved.errors.join(' · ') }
  return { ...base, status: 'draft', recipeId: saved.recipeId, auditIssues: audit.issues, allergenDoubt: !!rewrite.allergenDoubt }
}

/** A whole batch, in order. One failure never stops the rest. */
export async function importCatalogBatch(drafts: readonly CatalogDraftInput[], batch: string, deps: CatalogImportDeps): Promise<ImportOutcome[]> {
  const known = await deps.catalogNames()
  const out: ImportOutcome[] = []
  for (const d of drafts) {
    let r: ImportOutcome
    try {
      r = await importCatalogRecipe(d, batch, deps, known)
    } catch (err) {
      r = { name: d.name, source: d.source, status: 'rejected', reason: 'error', detail: (err as Error)?.message ?? String(err) }
    }
    if (r.status === 'draft') known.push(r.name)
    deps.log?.(`${r.status === 'draft' ? '✓' : r.status === 'duplicate' ? '=' : '✗'} ${r.name}${r.status === 'duplicate' ? ` (ya está: ${r.duplicateOf})` : r.status === 'rejected' ? ` (${r.reason}${r.detail ? `: ${r.detail}` : ''})` : r.auditIssues.length ? ` (auditoría: ${r.auditIssues.join(', ')})` : ''}`)
    out.push(r)
  }
  return out
}

// ─── Cocina JSON ────────────────────────────────────────────────

/**
 * Cocina's batch file: an array of recipes in the hand-authored shape
 * (`scripts/handAuthoredRecipes.ts`: ingredients by name with `qty`/`unit`,
 * steps as `{ text }` or strings) plus `source` per recipe or for the file
 * (the recipe's wins, key by key — `credit` included).
 */
export function draftsFromCocinaJson(json: unknown, fallback: CatalogSourceRef): CatalogDraftInput[] {
  const root = json as { source?: Partial<CatalogSourceRef>; recipes?: unknown[] } | unknown[]
  const list = Array.isArray(root) ? root : Array.isArray(root?.recipes) ? root.recipes : []
  const fileSource = Array.isArray(root) ? {} : root?.source ?? {}
  return list.map((raw) => {
    const r = raw as Record<string, any>
    const src = { ...fallback, ...fileSource, ...(r.source ?? {}) } as CatalogSourceRef
    return {
      name: String(r.name ?? '').trim(),
      servings: Number(r.servings) || HOUSE_SERVINGS,
      prepTime: r.prepTime ?? null,
      cookTime: r.cookTime ?? null,
      difficulty: r.difficulty ?? null,
      meals: r.meals ?? [],
      seasons: r.seasons ?? [],
      tags: r.tags ?? [],
      equipment: r.equipment ?? [],
      ingredients: (r.ingredients ?? []).map((i: any) => ({
        name: String(i.name ?? ''),
        quantity: Number(i.qty ?? i.quantity ?? 0),
        unit: String(i.unit ?? 'g'),
        note: i.note ?? null,
        optional: !!i.optional,
        section: i.section ?? null,
      })),
      sourceSteps: (r.steps ?? []).map((s: any) => (typeof s === 'string' ? s : String(s?.text ?? ''))).filter(Boolean),
      source: {
        origin: src.origin === 'miguel' ? 'miguel' : 'cocina',
        book: src.book ?? null,
        page: src.page != null ? String(src.page) : null,
        file: src.file ?? null,
        credit: cleanText(src.credit),
      },
    }
  })
}

// ─── Publishing ─────────────────────────────────────────────────

export interface BatchRecipe {
  id: string
  name: string
  status: string
  origin: CatalogOrigin
  auditIssues: string[]
  allergenDoubt: boolean
  sampled?: boolean
  /** Miguel's verdict on a sampled recipe: true OK, false not OK, undefined not seen yet. */
  reviewOk?: boolean
}

/**
 * Pure: Miguel's sample for a Cocina batch — one in ten (rounded up, at
 * least one) at random, plus every recipe with an allergen doubt.
 * `random` returns [0, 1) (Math.random in the command, seeded in tests).
 */
export function pickReviewSample(rows: readonly BatchRecipe[], random: () => number = Math.random): string[] {
  const drafts = rows.filter((r) => r.status === 'draft')
  if (drafts.length === 0) return []
  const n = Math.max(1, Math.ceil(drafts.length / 10))
  const pool = [...drafts]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  const chosen = new Set(pool.slice(0, n).map((r) => r.id))
  for (const r of drafts) if (r.allergenDoubt) chosen.add(r.id)
  return drafts.filter((r) => chosen.has(r.id)).map((r) => r.id)
}

export type HoldReason = 'auditoria' | 'falta_muestra' | 'muestra_sin_revisar' | 'muestra_con_rechazos' | 'rechazada'

/**
 * Pure: what `publish` may do with a batch (rule of Miguel, 2026-10-16).
 *   - Miguel's sources (his books, his mother's recipe book): out if the audit passes.
 *   - Cocina's: only once Miguel has seen the whole sample; if he turned
 *     one down, the whole batch waits (the sample says the batch is off).
 *   - Audit issues always wait, whatever the source.
 */
export function planBatchPublish(rows: readonly BatchRecipe[]): { publish: string[]; hold: Array<{ id: string; name: string; reason: HoldReason }> } {
  const publish: string[] = []
  const hold: Array<{ id: string; name: string; reason: HoldReason }> = []
  const drafts = rows.filter((r) => r.status === 'draft')
  const cocina = drafts.filter((r) => r.origin === 'cocina')
  const sample = cocina.filter((r) => r.sampled)
  const cocinaBlock: HoldReason | null =
    cocina.length === 0 ? null
      : sample.length === 0 ? 'falta_muestra'
        : sample.some((r) => r.reviewOk === undefined) ? 'muestra_sin_revisar'
          : sample.some((r) => r.reviewOk === false) ? 'muestra_con_rechazos'
            : null
  for (const r of drafts) {
    if (r.reviewOk === false) hold.push({ id: r.id, name: r.name, reason: 'rechazada' })
    else if (r.auditIssues.length > 0) hold.push({ id: r.id, name: r.name, reason: 'auditoria' })
    else if (r.origin === 'cocina' && cocinaBlock) hold.push({ id: r.id, name: r.name, reason: cocinaBlock })
    else publish.push(r.id)
  }
  return { publish, hold }
}
