import { z } from 'zod'
import { DIFFICULTIES, MEALS, SEASONS, UNITS } from '../constants/enums.js'

/**
 * Catalogue import from the admin page «Recetas pendientes»
 * (specs/catalog-import.md). Shared so the page checks Cocina's batch file
 * with the very same schema `POST /admin/catalog-import/jobs` uses — the
 * contract test (apps/api/src/tests/catalogImportFile.test.ts) runs
 * `buildCatalogImportPayload`'s output through `catalogImportRequestSchema`
 * and the importer (`draftsFromCocinaJson`).
 *
 * The file is Cocina's hand-authored shape: `{ source?, recipes: [...] }` or a
 * bare list, ingredients by name with `qty`/`unit`, steps as text or
 * `{ text }`, and `source` (origin, book, page, credit) for the file or per
 * recipe. Nothing here is ever shown to households.
 */

export const CATALOG_ORIGINS = ['cocina', 'miguel'] as const
export type CatalogOriginName = (typeof CATALOG_ORIGINS)[number]

/** Batch id: what `import_batch` holds and the CLI's `--batch=`. */
export const CATALOG_BATCH_ID_RE = /^[a-z0-9][a-z0-9-]{0,59}$/
export const CATALOG_IMPORT_MAX_RECIPES = 200
/** Characters of JSON text the page accepts (the API's body limit is above it). */
export const CATALOG_IMPORT_MAX_CHARS = 1_500_000
const MAX_PROBLEMS = 25

const UNIT_LIST = 'g, ml, u, cda, cdita, pizca o al_gusto'

const toStepObject = (v: unknown) => (typeof v === 'string' ? { text: v } : v)
const toFileObject = (v: unknown) => (Array.isArray(v) ? { recipes: v } : v)

const sourceSchema = z.object({
  origin: z.enum(CATALOG_ORIGINS).optional(),
  book: z.string().max(200).nullish(),
  page: z.union([z.string().max(40), z.number()]).nullish(),
  file: z.string().max(200).nullish(),
  credit: z.string().max(300).nullish(),
})

const ingredientSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    qty: z.number().optional(),
    quantity: z.number().optional(),
    unit: z.enum(UNITS),
    note: z.string().max(300).nullish(),
    optional: z.boolean().optional(),
    section: z.string().max(80).nullish(),
  })
  .superRefine((i, ctx) => {
    const key = i.qty == null && i.quantity != null ? 'quantity' : 'qty'
    const q = i.qty ?? i.quantity
    if (q == null) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'missing' })
    else if (!Number.isFinite(q) || q < 0 || (q === 0 && i.unit !== 'al_gusto' && i.unit !== 'pizca')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: 'positive' })
    }
  })

const stepSchema = z.preprocess(toStepObject, z.object({ text: z.string().trim().min(1).max(2000) }))

export const cocinaRecipeSchema = z.object({
  name: z.string().trim().min(1).max(150),
  servings: z.number().int().positive().max(100).optional(),
  prepTime: z.number().int().min(0).max(1440).nullish(),
  cookTime: z.number().int().min(0).max(1440).nullish(),
  difficulty: z.enum(DIFFICULTIES).nullish(),
  meals: z.array(z.enum(MEALS)).optional(),
  seasons: z.array(z.enum(SEASONS)).optional(),
  tags: z.array(z.string().max(60)).max(30).optional(),
  equipment: z.array(z.string().max(60)).max(30).optional(),
  ingredients: z.array(ingredientSchema).min(1).max(80),
  steps: z.array(stepSchema).min(1).max(60),
  source: sourceSchema.optional(),
})

export const cocinaBatchFileSchema = z.preprocess(
  toFileObject,
  z.object({
    source: sourceSchema.optional(),
    recipes: z.array(cocinaRecipeSchema).min(1).max(CATALOG_IMPORT_MAX_RECIPES),
  }),
)
export type CocinaBatchFile = z.infer<typeof cocinaBatchFileSchema>

/** Body of `POST /admin/catalog-import/check` and `/jobs`. */
export const catalogImportRequestSchema = z.object({
  batch: z.string().regex(CATALOG_BATCH_ID_RE),
  fileName: z.string().max(200).nullish(),
  file: cocinaBatchFileSchema,
})
export type CatalogImportRequest = z.infer<typeof catalogImportRequestSchema>

// ─── Checking a file, in Spanish ────────────────────────────────

export type CocinaBatchCheck =
  | { ok: true; file: CocinaBatchFile; origin: CatalogOriginName; book: string | null; names: string[]; warnings: string[] }
  | { ok: false; problems: string[] }

const FIELDS: Record<string, { label: string; plural?: boolean }> = {
  name: { label: 'el nombre' },
  servings: { label: 'las raciones (servings)', plural: true },
  prepTime: { label: 'el tiempo de preparación (prepTime)' },
  cookTime: { label: 'el tiempo de cocción (cookTime)' },
  difficulty: { label: 'la dificultad (difficulty)' },
  meals: { label: 'las comidas (meals)', plural: true },
  seasons: { label: 'las temporadas (seasons)', plural: true },
  tags: { label: 'las etiquetas (tags)', plural: true },
  equipment: { label: 'el equipo (equipment)' },
  qty: { label: 'la cantidad (qty)' },
  quantity: { label: 'la cantidad (quantity)' },
  unit: { label: 'la unidad' },
  note: { label: 'la nota (note)' },
  optional: { label: 'optional' },
  section: { label: 'la sección (section)' },
  text: { label: 'el texto' },
  source: { label: 'source' },
  origin: { label: 'el origen (source.origin)' },
  book: { label: 'el libro (source.book)' },
  page: { label: 'la página (source.page)' },
  file: { label: 'el fichero (source.file)' },
  credit: { label: 'el crédito (source.credit)' },
}

const TYPE_NAMES: Record<string, string> = {
  string: 'un texto',
  number: 'un número',
  integer: 'un número entero',
  boolean: 'verdadero o falso (true/false)',
  array: 'una lista',
  object: 'un objeto',
}

function joinOptions(options: readonly (string | number)[]): string {
  const list = options.map(String)
  return list.length <= 1 ? list.join('') : `${list.slice(0, -1).join(', ')} o ${list[list.length - 1]}`
}

function textOf(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ') : null
}

function recipesOf(json: unknown): unknown[] {
  if (Array.isArray(json)) return json
  const list = (json as { recipes?: unknown } | null)?.recipes
  return Array.isArray(list) ? list : []
}

/** «Receta 2 («Bizcocho»), ingrediente 3 («huevo»), paso 1» for a path into the file. */
function locate(path: ReadonlyArray<string | number>, json: unknown): { where: string; rest: Array<string | number> } {
  if (path[0] !== 'recipes' || typeof path[1] !== 'number') return { where: '', rest: [...path] }
  const i = path[1]
  const recipe = recipesOf(json)[i] as Record<string, unknown> | undefined
  const name = textOf(recipe?.name)
  let where = `Receta ${i + 1}${name ? ` («${name}»)` : ''}`
  let rest = path.slice(2)
  if (rest[0] === 'ingredients' && typeof rest[1] === 'number') {
    const ing = (Array.isArray(recipe?.ingredients) ? recipe!.ingredients : [])[rest[1]] as Record<string, unknown> | undefined
    const ingName = textOf(ing?.name)
    where += `, ingrediente ${rest[1] + 1}${ingName ? ` («${ingName}»)` : ''}`
    rest = rest.slice(2)
  } else if (rest[0] === 'steps' && typeof rest[1] === 'number') {
    where += `, paso ${rest[1] + 1}`
    rest = rest.slice(2)
  }
  return { where, rest }
}

/** What went wrong; `field` (an element of a list such as `meals`) goes with the location. */
function phrase(issue: z.ZodIssue, rest: Array<string | number>, path: ReadonlyArray<string | number>): string | { field: string; text: string } {
  const last = rest[rest.length - 1]
  const key = typeof last === 'string' ? last : typeof rest[rest.length - 2] === 'string' ? (rest[rest.length - 2] as string) : null
  const field = key ? FIELDS[key] : undefined
  const label = field?.label ?? (key ? `«${key}»` : '')
  const verb = (one: string, many: string) => (field?.plural ? many : one)
  const elementOf = typeof last === 'number' && key != null
  const parentKey = path[path.length - 2]

  switch (issue.code) {
    case z.ZodIssueCode.invalid_type: {
      if (rest.length === 0) {
        if (parentKey === 'steps') return 'tiene que ser un texto'
        if (parentKey === 'ingredients') return 'tiene que ser un objeto con name, qty y unit'
        return 'tiene que ser un objeto'
      }
      if (issue.received === 'undefined' || issue.received === 'null') return `falta ${label}`
      const expected = TYPE_NAMES[issue.expected] ?? issue.expected
      return elementOf ? { field: key!, text: `cada elemento tiene que ser ${expected}` } : `${label} ${verb('tiene', 'tienen')} que ser ${expected}`
    }
    case z.ZodIssueCode.invalid_enum_value: {
      const options = key === 'unit' ? UNIT_LIST : joinOptions(issue.options)
      const got = `«${String(issue.received)}» no vale; usa ${options}`
      return elementOf ? { field: key!, text: got } : `${label} ${got}`
    }
    case z.ZodIssueCode.too_small: {
      if (issue.type === 'array' && key === 'ingredients') return 'no tiene ingredientes'
      if (issue.type === 'array' && key === 'steps') return 'no tiene pasos'
      if (issue.type === 'string') return `${label} ${verb('está vacío', 'están vacíos')}`
      if (issue.type === 'number') {
        return Number(issue.minimum) <= 0 && issue.inclusive
          ? `${label} no ${verb('puede', 'pueden')} ser negativo`
          : `${label} ${verb('tiene', 'tienen')} que ser mayor que 0`
      }
      return `${label} se ${verb('queda', 'quedan')} corto`
    }
    case z.ZodIssueCode.too_big: {
      if (issue.type === 'string') return `${label} es demasiado largo (máximo ${issue.maximum} caracteres)`
      if (issue.type === 'array') return `${label} ${verb('trae', 'traen')} demasiados elementos (máximo ${issue.maximum})`
      return `${label} es demasiado grande (máximo ${issue.maximum})`
    }
    case z.ZodIssueCode.invalid_union:
      return `${label} no tiene un formato válido`
    case z.ZodIssueCode.custom:
      if (issue.message === 'missing') return `falta ${label}`
      if (issue.message === 'positive') return `${label} tiene que ser mayor que 0`
      return issue.message
    default:
      return issue.message
  }
}

/** Root-level issues: the file's shape as a whole. */
function rootProblem(issue: z.ZodIssue): string | null {
  const p = issue.path
  if (p.length === 0) return 'El fichero tiene que ser una lista de recetas o un objeto con «recipes».'
  if (p.length === 1 && p[0] === 'recipes') {
    if (issue.code === z.ZodIssueCode.invalid_type) {
      return issue.received === 'undefined' ? 'Falta la lista «recipes» (o pon directamente una lista de recetas).' : '«recipes» tiene que ser una lista de recetas.'
    }
    if (issue.code === z.ZodIssueCode.too_small) return 'El fichero no trae ninguna receta.'
    if (issue.code === z.ZodIssueCode.too_big) {
      return `La tanda trae demasiadas recetas: el máximo por tanda es ${CATALOG_IMPORT_MAX_RECIPES}. Pártela en dos ficheros.`
    }
  }
  return null
}

/** Pure: the schema's issues as sentences for Miguel, capped at 25 (+ «y N problemas más»). */
export function cocinaBatchProblems(error: z.ZodError, json: unknown): string[] {
  const out: string[] = []
  for (const issue of error.issues) {
    const root = rootProblem(issue)
    if (root) {
      out.push(root)
      continue
    }
    const located = locate(issue.path, json)
    const said = phrase(issue, located.rest, issue.path)
    const where = typeof said === 'string' ? located.where : [located.where, said.field].filter(Boolean).join(', ')
    const what = typeof said === 'string' ? said : said.text
    const sentence = where ? `${where}: ${what}` : what.charAt(0).toUpperCase() + what.slice(1)
    out.push(sentence.endsWith('.') ? sentence : `${sentence}.`)
  }
  const unique = [...new Set(out)]
  if (unique.length <= MAX_PROBLEMS) return unique
  return [...unique.slice(0, MAX_PROBLEMS), `…y ${unique.length - MAX_PROBLEMS} problemas más.`]
}

function foldName(s: string): string {
  return s.normalize('NFD').replace(/\p{Mn}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Pure: check a parsed batch file. */
export function checkCocinaBatch(json: unknown): CocinaBatchCheck {
  const parsed = cocinaBatchFileSchema.safeParse(json)
  if (!parsed.success) return { ok: false, problems: cocinaBatchProblems(parsed.error, json) }
  const file = parsed.data
  const origin: CatalogOriginName = file.source?.origin ?? 'cocina'
  const names = file.recipes.map((r) => r.name)
  const warnings: string[] = []
  const seen = new Map<string, string>()
  for (const name of names) {
    const key = foldName(name)
    const first = seen.get(key)
    if (first) warnings.push(`«${first}» sale dos veces en el fichero: la segunda se saltará como repetida.`)
    else seen.set(key, name)
  }
  const fromMiguel = origin === 'miguel' || file.recipes.some((r) => r.source?.origin === 'miguel')
  if (fromMiguel) {
    warnings.push('El fichero dice que hay recetas de tus fuentes (origin «miguel»): esas se pueden publicar sin pasar por tu revisión, en cuanto pasen la auditoría.')
  }
  return { ok: true, file, origin, book: textOf(file.source?.book), names, warnings }
}

/** Pure: check the text of a batch file (pasted or read from disk). */
export function checkCocinaBatchText(text: string): CocinaBatchCheck {
  if (!text.trim()) return { ok: false, problems: ['Pega el JSON de la tanda o sube el fichero.'] }
  if (text.length > CATALOG_IMPORT_MAX_CHARS) {
    return { ok: false, problems: [`El fichero es demasiado grande (más de ${Math.round(CATALOG_IMPORT_MAX_CHARS / 1_000_000 * 10) / 10} MB). Pártelo en dos tandas.`] }
  }
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch (err) {
    const msg = (err as Error)?.message ?? ''
    const lc = /line (\d+) column (\d+)/.exec(msg)
    let where = lc ? `la línea ${lc[1]}, columna ${lc[2]}` : null
    const pos = /position (\d+)/.exec(msg)
    if (!where && pos) {
      const before = text.slice(0, Number(pos[1]))
      const line = before.split('\n').length
      where = `la línea ${line}, columna ${before.length - before.lastIndexOf('\n')}`
    }
    return {
      ok: false,
      problems: [`No es un JSON válido${where ? `: revisa ${where}` : ''} (suele ser una coma de más o de menos, o unas comillas sin cerrar).`],
    }
  }
  return checkCocinaBatch(json)
}

/** Pure: batch id from the file name, without the date in front («2026-10-20-cocina-01.json» → «cocina-01»). */
export function suggestCatalogBatchId(fileName: string | null | undefined): string {
  if (!fileName) return ''
  return foldName(fileName.replace(/\.[^.]+$/, ''))
    .replace(/^\d{4}-\d{2}-\d{2}[-_ ]+/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
}

/** Pure: what the page sends to the API, or why it can't send it yet. */
export function buildCatalogImportPayload(input: { text: string; fileName?: string | null; batch: string }):
  | { ok: true; payload: CatalogImportRequest; check: Extract<CocinaBatchCheck, { ok: true }> }
  | { ok: false; problems: string[] } {
  const batch = input.batch.trim().toLowerCase()
  const batchProblem = CATALOG_BATCH_ID_RE.test(batch)
    ? []
    : [batch ? 'El nombre de la tanda: solo minúsculas, números y guiones, hasta 60 (por ejemplo, cocina-02).' : 'Ponle nombre a la tanda (por ejemplo, cocina-02).']
  const check = checkCocinaBatchText(input.text)
  if (!check.ok) return { ok: false, problems: [...batchProblem, ...check.problems] }
  if (batchProblem.length) return { ok: false, problems: batchProblem }
  return { ok: true, payload: { batch, fileName: input.fileName?.trim() || null, file: check.file }, check }
}

// ─── What the admin page reads ──────────────────────────────────

/** Where a draft stands under the publish rule (rule of Miguel 2026-10-16, D-099). */
export type CatalogDraftDecision = 'publicable' | 'auditoria' | 'sin_revisar' | 'rechazada'

export const CATALOG_DRAFT_DECISION_LABELS: Record<CatalogDraftDecision, string> = {
  publicable: 'Lista para publicar',
  auditoria: 'Espera por la auditoría',
  sin_revisar: 'Sin revisar',
  rechazada: 'Descartada',
}

export interface CatalogDraftView {
  id: string
  name: string
  batch: string
  origin: CatalogOriginName
  book: string | null
  page: string | null
  file: string | null
  /** The line the ficha will show under the title (D-067), or null. */
  credit: string | null
  imageUrl: string | null
  servings: number
  totalTime: number | null
  difficulty: string | null
  /** Ingredient names, in order. */
  ingredients: string[]
  stepCount: number
  tips: string | null
  tags: string[]
  allergenDoubt: boolean
  auditIssues: Array<{ code: string; label: string }>
  /** Miguel's verdict: 'ok', 'no' (descartada) or null (not given). */
  verdict: 'ok' | 'no' | null
  reviewedAt: string | null
  decision: CatalogDraftDecision
  createdAt: string | null
}

export interface CatalogDraftBatchView {
  batch: string
  origins: CatalogOriginName[]
  /** Drafts still to decide (and approved ones waiting), allergen doubts first. */
  pending: CatalogDraftView[]
  /** Drafts Miguel turned down: never published, kept so a re-import skips them. */
  discarded: CatalogDraftView[]
  publishedCount: number
  /** How many «Publicar las aprobadas» would publish now. */
  publishable: number
  lastImportedAt: string | null
}

export interface CatalogDraftsView {
  pending: number
  batches: CatalogDraftBatchView[]
}

export type CatalogImportJobStatus = 'running' | 'done' | 'failed' | 'interrupted'

export const CATALOG_IMPORT_JOB_STATUS_LABELS: Record<CatalogImportJobStatus, string> = {
  running: 'En curso',
  done: 'Terminada',
  failed: 'Falló',
  interrupted: 'Interrumpida',
}

export const CATALOG_IMPORT_REJECT_LABELS: Record<string, string> = {
  no_es_receta: 'no parece una receta',
  copia_del_libro: 'copia frases de la fuente',
  ingredientes: 'ingredientes que no casan con el catálogo',
  revisor: 'el revisor la rechaza',
  error: 'error al importarla',
}

export interface CatalogImportOutcomeView {
  name: string
  status: 'draft' | 'duplicate' | 'rejected'
  recipeId?: string
  duplicateOf?: string
  reason?: string
  detail?: string
  allergenDoubt?: boolean
  auditIssues?: string[]
}

export interface CatalogImportJobView {
  id: string
  batch: string
  origin: CatalogOriginName
  fileName: string | null
  status: CatalogImportJobStatus
  total: number
  done: number
  counts: { draft: number; duplicate: number; rejected: number }
  outcomes: CatalogImportOutcomeView[]
  error: string | null
  createdAt: string
  finishedAt: string | null
}

/** Answer of `POST /admin/catalog-import/check`: the file is fine; this is what an import would do. */
export interface CatalogImportCheckView {
  batch: string
  origin: CatalogOriginName
  book: string | null
  recipes: Array<{ name: string; duplicateOf: string | null }>
  warnings: string[]
  /** Recipes already in this batch (a re-run skips them as repeated). */
  alreadyInBatch: number
}
