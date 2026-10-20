/**
 * Recipe lint validator — single source of truth for recipe data integrity.
 *
 * Used by:
 *   - the recipe save endpoint (POST/PUT /recipes)
 *   - the photo-extraction pipeline (POST /recipes/extract-from-image)
 *   - the LLM seed regeneration script (apps/api/scripts/regenerateRecipes.ts)
 *
 * The validator is **pure**: it does not touch the DB. The caller is expected
 * to query the ingredient catalog and pass it in via {@link LintOptions}.
 *
 * Performance budget: < 50 ms for a 30-ingredient recipe (see specs/recipe-quality.md).
 */

import {
  DIFFICULTIES,
  MEALS,
  SEASONS,
  type Difficulty,
  type Meal,
  type Season,
  type Unit,
  type NutritionPerServing,
} from '@ona/shared'
import { INGREDIENT_RANGES, globalCeiling, type QuantityRange } from './recipeLint.ranges.js'
import { shoppabilityIssues } from './recipeShoppability.js'
import { cookingMediumFactor } from './nutrition/cookingMedium.js'
import { noteStartsWithNumber } from '@ona/shared'

// ─── Public types ────────────────────────────────────────────────

/** A single ingredient row on a recipe, post-id-mint. */
export interface RecipeIngredientLintInput {
  id: string
  ingredientId: string
  section?: string
  quantity: number
  unit: Unit
  optional?: boolean
  note?: string
  displayOrder?: number
}

/** A single step on a recipe. */
export interface RecipeStepLintInput {
  index: number
  text: string
  durationMin?: number | null
  temperature?: number | null
  technique?: string
  ingredientRefs?: string[]
}

/**
 * The shape lint validates: the write shape ({@link createRecipeSchema})
 * with `RecipeIngredient.id` already minted, plus optional `nutritionPerServing`
 * (passed by the regeneration pipeline; absent for normal saves).
 */
export interface RecipeInput {
  name?: string | null
  servings?: number | null
  prepTime?: number | null
  cookTime?: number | null
  difficulty?: Difficulty
  meals?: Meal[]
  seasons?: Season[]
  equipment?: string[]
  tags?: string[]
  internalTags?: string[]
  ingredients: RecipeIngredientLintInput[]
  steps: RecipeStepLintInput[]
  nutritionPerServing?: NutritionPerServing | null
}

/** Catalog rows passed in by the caller; the validator never queries the DB. */
export interface CatalogIngredient {
  id: string
  name: string
  allergenTags?: string[]
  fdcId?: number | null
  density?: number | null
  unitWeight?: number | null
}

export interface LintOptions {
  ingredientCatalog: CatalogIngredient[]
  /** When true, suppresses QUANTITY_OUT_OF_RANGE errors. Other rules are unaffected. */
  force?: boolean
}

export interface LintIssue {
  /** Stable, machine-readable code (e.g. 'STEP_INGREDIENT_NOT_LISTED'). */
  code: string
  /** Spanish, surfaced to the user. */
  message: string
  /** Dot-path into the recipe shape, e.g. 'steps[3].text' or 'ingredients[0]'. */
  path?: string
}

export interface LintResult {
  /** false if any blocking error fired (after applying force-overrides). */
  ok: boolean
  errors: LintIssue[]
  warnings: LintIssue[]
}

// ─── Normalization & fuzzy match helpers ─────────────────────────

/** Lowercase, strip diacritics, trim, collapse whitespace. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining marks
    .replace(/ñ/g, 'n')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Trivial Spanish noun stem: drop the plural «s», then the final vowel
 * (a/o/e), so singular and plural share a root: «sopa»/«sopas» → «sop»,
 * «tomate»/«tomates» → «tomat», «limón»/«limones» → «limon». Words of 3
 * letters or fewer stay as they are («pan», «ajo»).
 *
 * PRO-203 (2026-10-18): the old rule dropped «as» only from words of 5+
 * letters, so «sopas» → «sop» but «sopa» stayed «sopa» and the catalogue
 * didn't seem to have «sopas» (catalogue wishes, PRO-154).
 */
export function stem(word: string): string {
  let w = word
  if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1)
  if (w.length > 3 && /[aoe]$/.test(w)) w = w.slice(0, -1)
  return w
}

/** Iterative Levenshtein distance — pure TS, no deps. */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (a.length === 0) return b.length
  if (b.length === 0) return a.length

  // Two-row DP keeps memory at O(min(a, b))
  const m = a.length
  const n = b.length
  let prev = new Array<number>(n + 1)
  let curr = new Array<number>(n + 1)
  for (let j = 0; j <= n; j++) prev[j] = j

  for (let i = 1; i <= m; i++) {
    curr[0] = i
    const ai = a.charCodeAt(i - 1)
    for (let j = 1; j <= n; j++) {
      const cost = ai === b.charCodeAt(j - 1) ? 0 : 1
      const del = prev[j] + 1
      const ins = curr[j - 1] + 1
      const sub = prev[j - 1] + cost
      curr[j] = del < ins ? (del < sub ? del : sub) : (ins < sub ? ins : sub)
    }
    const tmp = prev
    prev = curr
    curr = tmp
  }
  return prev[n]
}

/**
 * Token-equivalent for step→ingredient matching. Exact match, or — for tokens
 * long enough to make a typo plausible — Levenshtein distance ≤ 1.
 *
 * Earlier this also accepted distance ≤ 2 for tokens ≥ 6 chars; that produced
 * false positives like "cazuela" → "canela" (the catalog ingredient was never
 * mentioned in the step, but the lint flagged it anyway). Spanish plurals and
 * gender are already covered by `stem()` upstream — fuzziness here was paying
 * for typos but the price was wrong matches on common cooking nouns.
 */
function isFuzzyMatch(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  const len = Math.max(a.length, b.length)
  if (len < 7) return false
  return levenshtein(a, b) <= 1
}

/**
 * Tokenize a normalized step text into a list of word tokens (length ≥ 2)
 * plus their stems. Punctuation is split out.
 */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2)
}

/**
 * Catalog index built once per lint call. Maps normalized name → catalog row,
 * and pre-computes token sets for cheap step-text matching.
 */
interface IndexedCatalogRow {
  row: CatalogIngredient
  normName: string
  nameTokens: string[]
  nameStems: string[]
  /** Every word of the name, single letters and stop words included (strict check). */
  words: string[]
}

interface CatalogIndex {
  byId: Map<string, CatalogIngredient>
  /** Same map as byId but pointing at the pre-tokenized representation. */
  indexedById: Map<string, IndexedCatalogRow>
  /** All catalog rows with their normalized name & stem-token list. */
  rows: IndexedCatalogRow[]
}

function buildCatalogIndex(catalog: CatalogIngredient[]): CatalogIndex {
  const byId = new Map<string, CatalogIngredient>()
  const indexedById = new Map<string, IndexedCatalogRow>()
  const rows: IndexedCatalogRow[] = []
  for (const row of catalog) {
    byId.set(row.id, row)
    const normName = normalize(row.name)
    const tokens = tokenize(normName)
    const indexed: IndexedCatalogRow = {
      row,
      normName,
      nameTokens: tokens,
      nameStems: tokens.map(stem),
      words: words(normName),
    }
    indexedById.set(row.id, indexed)
    rows.push(indexed)
  }
  return { byId, indexedById, rows }
}

/**
 * Does the step mention this recipe's OWN ingredient? (ORPHAN_INGREDIENT)
 *
 * Deliberately loose — a false "mentioned" only spares an orphan error:
 *   1. the full name appears at word boundaries;
 *   2. a single-word name matches a word or its stem (plural, gender) or a
 *      typo at Levenshtein ≤ 1;
 *   3. a multi-word name matches on its head noun ("añade el aceite" →
 *      "aceite de oliva virgen": Spanish puts the head first and recipe
 *      writers drop the qualifiers) or, for two words, on the bigram.
 *
 * The opposite check — does the step name an ingredient the recipe doesn't
 * list? — is {@link mentionsUnlistedIngredient}, which is strict.
 */
function stepMentionsIngredient(
  textTokens: string[],
  textStems: string[],
  fullNormalizedText: string,
  cat: CatalogIndex['rows'][number],
): boolean {
  if (cat.normName.length === 0) return false
  // Full-name substring at word boundaries (cheap and precise; avoids "sal"
  // matching inside "saltea")
  if (cat.nameTokens.length >= 2 && containsWholePhrase(fullNormalizedText, cat.normName)) return true

  if (cat.nameTokens.length === 1) {
    const target = cat.nameTokens[0]
    const targetStem = cat.nameStems[0]
    for (let i = 0; i < textTokens.length; i++) {
      if (isFuzzyMatch(textTokens[i], target)) return true
      if (isFuzzyMatch(textStems[i], targetStem)) return true
    }
    return false
  }

  const head = cat.nameTokens[0]
  const headStem = cat.nameStems[0]
  if (isContentToken(head)) {
    for (let i = 0; i < textTokens.length; i++) {
      if (isFuzzyMatch(textTokens[i], head)) return true
      if (isFuzzyMatch(textStems[i], headStem)) return true
    }
  }

  if (cat.nameTokens.length === 2) {
    const [a, b] = cat.nameTokens
    for (let i = 0; i < textTokens.length - 1; i++) {
      if (isFuzzyMatch(textTokens[i], a) && isFuzzyMatch(textTokens[i + 1], b)) return true
    }
  }
  return false
}

// ─── Strict check: ingredients named in a step but not listed (PRO-289) ──
//
// The 2026-10-20 batch (cocina-01) was rejected 26 times out of 32, almost
// always wrongly: stems and typo-tolerance read «pulpa» as «pulpo», «pero» as
// «pera», «pardinas» as «sardinas», «pechuga» as «lechuga»; «hasta que esté
// dorada» as the fish; «lo pasas por harina» as raisins; a batter («una pasta
// espesa») as pasta; «pollo» as missing when the list says «muslos de pollo»;
// and every «agua» as an ingredient to buy. So this check matches whole words
// only (singular/plural, never gender, never typos), reads a few homographs in
// context, and accepts a word of the recipe's own ingredient names.

/** Words of a text, normalized: [a-z0-9] runs, single letters kept («a», «y» matter for context). */
function words(text: string): string[] {
  const out = normalize(text).replace(/[^a-z0-9]+/g, ' ').trim()
  return out ? out.split(' ') : []
}

/**
 * Same word up to Spanish number only: «pollo»/«pollos», «limón»/«limones»,
 * «pasa»/«pasas». Never across gender («pulpo» ≠ «pulpa», «pera» ≠ «pero»,
 * «dorada» ≠ «dorado») and never typos («sardinas» ≠ «pardinas»).
 */
export function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  return long === short + 's' || long === short + 'es'
}

/** Is `word`, up to number, in `set`? */
function hasSameWord(set: ReadonlySet<string>, word: string): boolean {
  if (set.has(word) || set.has(word + 's') || set.has(word + 'es')) return true
  if (word.endsWith('es') && set.has(word.slice(0, -2))) return true
  return word.endsWith('s') && set.has(word.slice(0, -1))
}

/** Water and salt are never bought, so a step may use them unlisted. */
const FREE_STAPLE_HEADS = new Set(['agua', 'sal'])
const FREE_STAPLE_QUALIFIERS = new Set([
  'de', 'del', 'la', 'en', 'fina', 'fino', 'gruesa', 'grueso', 'marina', 'escamas', 'mesa', 'grifo', 'mineral',
  'caliente', 'fria', 'templada', 'tibia', 'hirviendo', 'yodada', 'maldon', 'kosher',
])
function isFreeStaple(nameWords: string[]): boolean {
  return FREE_STAPLE_HEADS.has(nameWords[0]) && nameWords.slice(1).every(w => FREE_STAPLE_QUALIFIERS.has(w))
}

/** Collective words a step uses for things already listed («saltea las verduras»). */
const COLLECTIVE_NAMES = new Set([
  'verdura', 'verduras', 'hortaliza', 'hortalizas', 'fruta', 'frutas', 'especia', 'especias', 'hierbas',
  'hierbas aromaticas', 'legumbre', 'legumbres', 'marisco', 'mariscos',
])

/** A generic name is covered by any listed member: «cuece la pasta» with «espaguetis» listed. */
const FAMILY_MEMBERS: Record<string, string[]> = {
  pasta: [
    'espagueti', 'espaguetis', 'spaghetti', 'macarron', 'macarrones', 'tallarin', 'tallarines', 'fideo', 'fideos',
    'lasana', 'canelon', 'canelones', 'penne', 'fusilli', 'tagliatelle', 'linguine', 'fettuccine', 'rigatoni',
    'farfalle', 'raviolis', 'ravioli', 'tortellini', 'noquis', 'gnocchi', 'plumas', 'helices', 'coditos', 'orzo',
  ],
  pescado: [
    'merluza', 'bacalao', 'salmon', 'dorada', 'lubina', 'caballa', 'sardina', 'boqueron', 'atun', 'bonito',
    'rape', 'rodaballo', 'lenguado', 'corvina', 'besugo', 'pescadilla', 'trucha', 'emperador', 'mero', 'gallo',
    'abadejo', 'panga', 'palometa', 'perca', 'jurel',
  ],
}
FAMILY_MEMBERS['pescado blanco'] = FAMILY_MEMBERS.pescado
FAMILY_MEMBERS.cebolla = ['cebolleta', 'chalota'] // «la cebolla» with «cebolleta» listed

/**
 * «zumo de limón», «dientes de ajo», «la salsa de tomate» (made in a step
 * before): a part of something listed, or made from it, is listed.
 */
const PART_WORDS = new Set([
  'zumo', 'jugo', 'ralladura', 'piel', 'cascara', 'diente', 'dientes', 'hoja', 'hojas', 'rama', 'ramas',
  'ramita', 'ramitas', 'gajo', 'gajos', 'pulpa', 'carne', 'yema', 'yemas', 'clara', 'claras', 'corazon', 'corazones',
  'salsa',
])

/**
 * Words before a noun (article, number, «de», «con»): «la dorada», «dos
 * doradas», «lomos de dorada». No «este/esta»: without accents they are
 * «esté/está» («hasta que esté dorada»).
 */
const NOUN_CUES = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'cada', 'ese', 'esa', 'esos', 'esas', 'su', 'sus', 'de',
  'del', 'con', 'al', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'ocho', 'media', 'medio',
])
/** Adjective or participle shape: «dorada(s)», «picado», «rallada», «cocido». */
const PARTICIPLE_RE = /(ad|id)(o|a|os|as)$/
/** After the verb «pasar»: «lo pasas por harina», «pasa a una fuente». */
const AFTER_PASAR = new Set([
  'por', 'a', 'al', 'el', 'la', 'los', 'las', 'lo', 'un', 'una', 'unos', 'unas', 'todo', 'toda', 'todos', 'todas',
  'bien', 'enseguida', 'luego', 'despues',
])
/** «una pasta espesa», «la pasta resultante»: a paste or a batter, not noodles. */
const PASTE_WORDS = new Set([
  'homogenea', 'fina', 'espesa', 'lisa', 'suave', 'densa', 'untable', 'cremosa', 'compacta', 'resultante',
  'uniforme', 'gruesa', 'ligera', 'pegajosa', 'blanda', 'ligada',
])
/** «pasta de trigo / de lentejas» is still pasta; «pasta de la masa / de sésamo» is a paste. */
const PASTA_OF = new Set(['trigo', 'semola', 'espelta', 'lentejas', 'lenteja', 'garbanzos', 'garbanzo', 'arroz', 'maiz', 'guisantes', 'huevo'])
/** Cooking noodles: «cuece la pasta», «escúrrela», «al dente». («cocina» is not a cue: batters are cooked too.) */
const NOODLE_COOKING_RE = /^(cuec|cuez|cocer|hierv|herv|escurr)/
const UTENSILS = new Set(['sarten', 'cazo', 'cazuela', 'olla', 'cuchillo', 'cuchara', 'paleta', 'espatula', 'rallador'])

/**
 * The step word at `i` matched a single-word catalog name: is it that
 * ingredient here, or a homograph? Participles/adjectives («hasta que esté
 * dorada», «la carne picada») count only after an article, a number or «de»;
 * «pasas» only as a noun, not the verb; «pasta» only when the step cooks
 * noodles and it isn't a paste or a batter; «mango» not as a pan's handle.
 */
function readsAsIngredient(name: string, w: string[], i: number): boolean {
  const word = w[i]
  const prev = w[i - 1] ?? ''
  const next = w[i + 1] ?? ''
  if (sameWord(name, 'pasas')) {
    if (word !== 'pasas') return false // «pasa a una fuente»
    if (!NOUN_CUES.has(prev) && prev !== 'y' && prev !== 'e') return false // «lo pasas»
    return !AFTER_PASAR.has(next) // «las pasas por harina»
  }
  if (sameWord(name, 'pasta')) {
    if (prev === 'una' || prev === 'unas' || PASTE_WORDS.has(next)) return false
    if (next === 'de' && !PASTA_OF.has(w[i + 2] ?? '')) return false
    return w.some(x => NOODLE_COOKING_RE.test(x) || x === 'dente')
  }
  if (sameWord(name, 'mango')) {
    if (next === 'de' && (UTENSILS.has(w[i + 2] ?? '') || UTENSILS.has(w[i + 3] ?? ''))) return false
    if (prev === 'el' && w[i - 2] === 'por') return false // «sujétala por el mango»
  }
  if (PARTICIPLE_RE.test(word)) return NOUN_CUES.has(prev) || /^\d+$/.test(prev)
  return true
}

/** Does the step (its words) name this catalog ingredient, read strictly? */
function mentionsUnlistedIngredient(w: string[], cat: IndexedCatalogRow): boolean {
  const n = cat.words
  if (n.length === 0 || isFreeStaple(n) || COLLECTIVE_NAMES.has(cat.normName)) return false
  outer: for (let i = 0; i + n.length <= w.length; i++) {
    for (let k = 0; k < n.length; k++) {
      if (!sameWord(w[i + k], n[k])) continue outer
    }
    if (n.length > 1 || readsAsIngredient(n[0], w, i)) return true
  }
  return false
}

/** The recipe's own ingredient names, as words. */
interface RecipeLexicon {
  /** Head nouns («aceite» of «aceite de oliva virgen»). */
  heads: Set<string>
  /** Every significant word («muslos», «pollo» of «muslos de pollo»). */
  words: Set<string>
}

/**
 * A catalog ingredient the step names but the recipe doesn't list is still
 * fine when the recipe's own names account for it:
 *   - same head noun (2026-05-16): «aceite de girasol» when «aceite de oliva»
 *     is listed — the writer meant their own aceite;
 *   - every significant word of it is in the recipe's names: «pollo» with
 *     «muslos de pollo», «cerdo» with «lomo de cerdo», «pollo» with «caldo de
 *     pollo» (PRO-289);
 *   - a part of something listed, or made from it: «zumo de limón»,
 *     «dientes de ajo», «salsa de tomate»;
 *   - a generic name covered by a listed member: «pasta» with «espaguetis».
 */
function explainedByRecipe(cat: IndexedCatalogRow, lex: RecipeLexicon): boolean {
  const content = cat.words.filter(isContentToken)
  if (content.length === 0) return false
  if (hasSameWord(lex.heads, cat.words[0])) return true
  if (content.every(x => hasSameWord(lex.words, x))) return true
  if (PART_WORDS.has(cat.words[0]) && content.length > 1 && content.slice(1).every(x => hasSameWord(lex.words, x))) {
    return true
  }
  const members = FAMILY_MEMBERS[cat.normName]
  return !!members && members.some(m => hasSameWord(lex.words, m))
}

/** Spanish stop words / articles / prepositions that can't be a head noun. */
const STOP_WORDS = new Set([
  'de', 'al', 'del', 'la', 'el', 'con', 'sin', 'en', 'a',
  'los', 'las', 'una', 'uno', 'que', 'por', 'para',
])

/**
 * A token worth treating as the head noun of a multi-word ingredient name.
 * 3 chars minimum so "pan" (head of "pan integral", "pan blanco") still
 * matches; shorter tokens are almost always Spanish articles or pronouns.
 */
function isContentToken(token: string): boolean {
  if (token.length < 3) return false
  return !STOP_WORDS.has(token)
}

/** Substring containment, but only at word boundaries (start/end or whitespace-flanked). */
function containsWholePhrase(haystack: string, needle: string): boolean {
  if (!needle) return false
  let from = 0
  while (true) {
    const idx = haystack.indexOf(needle, from)
    if (idx === -1) return false
    const before = idx === 0 ? ' ' : haystack[idx - 1]
    const after = idx + needle.length >= haystack.length ? ' ' : haystack[idx + needle.length]
    if (!/[a-z0-9]/.test(before) && !/[a-z0-9]/.test(after)) return true
    from = idx + 1
  }
}

// ─── Time-hint regex (Spanish) ──────────────────────────────────

const TIME_HINT_RE = /(\d+)\s*(min(uto)?s?|hora|horas|h)\b|media\s+hora/i

// ─── Validator ──────────────────────────────────────────────────

const ML_OR_G: ReadonlySet<Unit> = new Set<Unit>(['g', 'ml'])

export function lintRecipe(recipe: RecipeInput, opts: LintOptions): LintResult {
  const errors: LintIssue[] = []
  const warnings: LintIssue[] = []

  const catalog = buildCatalogIndex(opts.ingredientCatalog ?? [])

  // 1. MISSING_NAME
  if (!recipe.name || recipe.name.trim().length === 0) {
    errors.push({
      code: 'MISSING_NAME',
      message: 'La receta necesita un nombre.',
      path: 'name',
    })
  }

  // 2. MISSING_SERVINGS
  if (recipe.servings == null || !Number.isFinite(recipe.servings) || recipe.servings < 1) {
    errors.push({
      code: 'MISSING_SERVINGS',
      message: 'Indica cuántas raciones rinde la receta (mínimo 1).',
      path: 'servings',
    })
  }

  // 3. NO_INGREDIENTS
  const ingredients = recipe.ingredients ?? []
  if (ingredients.length === 0) {
    errors.push({
      code: 'NO_INGREDIENTS',
      message: 'La receta debe tener al menos un ingrediente.',
      path: 'ingredients',
    })
  }

  // 4. NO_STEPS
  const steps = recipe.steps ?? []
  if (steps.length === 0) {
    errors.push({
      code: 'NO_STEPS',
      message: 'La receta debe tener al menos un paso.',
      path: 'steps',
    })
  }

  // Pre-compute per-step token data once (used by rule 5 and rule 6).
  const stepData = steps.map(step => {
    const fullNorm = normalize(step.text ?? '')
    const tokens = tokenize(fullNorm)
    const stems = tokens.map(stem)
    return { step, fullNorm, tokens, stems, words: words(fullNorm) }
  })

  // Set of catalog ingredient ids attached to this recipe.
  const recipeIngredientIds = new Set(ingredients.map(i => i.ingredientId))

  // The recipe's own names, as words, to tell when a catalog ingredient the
  // step names is really one of the recipe's (see explainedByRecipe). Heads
  // are the user's rule of 2026-05-16: "if recipe has aceite and step
  // mentions aceite de oliva → no error; if recipe has aceite de oliva and
  // step mentions aceite → no error".
  const lexicon: RecipeLexicon = { heads: new Set(), words: new Set() }
  for (const ing of ingredients) {
    const indexed = catalog.indexedById.get(ing.ingredientId)
    if (!indexed) continue
    const head = indexed.nameTokens[0]
    if (head && isContentToken(head)) lexicon.heads.add(head)
    for (const w of indexed.words) if (isContentToken(w)) lexicon.words.add(w)
  }

  // Map recipe-ingredient row id → its catalog ingredient id (for ingredientRefs lookup).
  const rowIdToCatalogId = new Map<string, string>()
  for (const ing of ingredients) {
    rowIdToCatalogId.set(ing.id, ing.ingredientId)
  }

  // 5. STEP_INGREDIENT_NOT_LISTED
  // For each step, detect catalog ingredients named in the text (whole words,
  // homographs read in context — never a head-only match, or "aceite" would
  // pull in every "aceite de X"). Error when one is not in this recipe (by
  // ingredientId), not in step.ingredientRefs (row id → catalog id) and not
  // accounted for by the recipe's own names.
  steps.forEach((step, i) => {
    const data = stepData[i]
    if (!data) return
    const refsCatalogIds = new Set<string>()
    for (const ref of step.ingredientRefs ?? []) {
      const catId = rowIdToCatalogId.get(ref)
      if (catId) refsCatalogIds.add(catId)
    }
    for (const cat of catalog.rows) {
      if (recipeIngredientIds.has(cat.row.id)) continue
      if (refsCatalogIds.has(cat.row.id)) continue
      if (!mentionsUnlistedIngredient(data.words, cat)) continue
      if (explainedByRecipe(cat, lexicon)) continue
      errors.push({
        code: 'STEP_INGREDIENT_NOT_LISTED',
        message: `El paso ${i + 1} menciona "${cat.row.name}" pero no aparece en los ingredientes ni está vinculado.`,
        path: `steps[${i}].text`,
      })
    }
  })

  // 6. ORPHAN_INGREDIENT
  // For each non-optional ingredient: must be mentioned by name in some step
  // OR referenced by some step's ingredientRefs.
  const refdRowIds = new Set<string>()
  for (const step of steps) {
    for (const ref of step.ingredientRefs ?? []) refdRowIds.add(ref)
  }
  ingredients.forEach((ing, i) => {
    if (ing.optional) return
    if (refdRowIds.has(ing.id)) return
    const indexedRow = catalog.indexedById.get(ing.ingredientId)
    if (!indexedRow) {
      // Unknown catalog ingredient — can't fuzzy-match. We can still surface as orphan.
      errors.push({
        code: 'ORPHAN_INGREDIENT',
        message: `El ingrediente #${i + 1} no se menciona en ningún paso.`,
        path: `ingredients[${i}]`,
      })
      return
    }
    let mentioned = false
    for (const data of stepData) {
      if (stepMentionsIngredient(data.tokens, data.stems, data.fullNorm, indexedRow)) {
        mentioned = true
        break
      }
    }
    if (!mentioned) {
      errors.push({
        code: 'ORPHAN_INGREDIENT',
        message: `El ingrediente "${indexedRow.row.name}" no se menciona en ningún paso.`,
        path: `ingredients[${i}]`,
      })
    }
  })

  // 7. QUANTITY_OUT_OF_RANGE — only g/ml; force bypasses
  if (recipe.servings && recipe.servings >= 1) {
    ingredients.forEach((ing, i) => {
      if (!ML_OR_G.has(ing.unit)) return
      const cat = catalog.byId.get(ing.ingredientId)
      // Frying/confit fat: the range applies to what is eaten, not to the pan,
      // and only its ceiling (a small fry absorbs less than the usual minimum).
      const medium = cookingMediumFactor(ing.note, cat)
      const perServing = (ing.quantity * medium) / recipe.servings!
      const range = pickRange(cat?.name)
      const max = range?.maxPerServingG ?? globalCeiling
      const min = medium < 1 ? 0 : (range?.minPerServingG ?? 0)
      if (perServing > max || perServing < min) {
        if (!opts.force) {
          const label = cat?.name ?? `ingrediente #${i + 1}`
          errors.push({
            code: 'QUANTITY_OUT_OF_RANGE',
            message: `La cantidad de "${label}" (${perServing.toFixed(0)} ${ing.unit} por ración${medium < 1 ? ', lo que absorbe la fritura' : ''}) está fuera del rango razonable (${min}-${max} ${ing.unit}).`,
            path: `ingredients[${i}]`,
          })
        }
      }
    })
  }

  // 8. STEP_REF_DANGLING
  steps.forEach((step, i) => {
    const refs = step.ingredientRefs ?? []
    refs.forEach((ref, j) => {
      if (!rowIdToCatalogId.has(ref)) {
        errors.push({
          code: 'STEP_REF_DANGLING',
          message: `El paso ${i + 1} referencia un ingrediente que no existe en la receta.`,
          path: `steps[${i}].ingredientRefs[${j}]`,
        })
      }
    })
  })

  // 9. TIME_INCONSISTENT
  if (
    recipe.prepTime != null &&
    recipe.cookTime != null &&
    steps.length > 0 &&
    steps.every(s => s.durationMin != null)
  ) {
    const sum = steps.reduce((acc, s) => acc + (s.durationMin ?? 0), 0)
    const budget = recipe.prepTime + recipe.cookTime
    if (sum > budget * 1.2) {
      errors.push({
        code: 'TIME_INCONSISTENT',
        message: `La suma de los pasos (${sum} min) supera prep+cook (${budget} min) en más de un 20%.`,
        path: 'steps',
      })
    }
  }

  // 10. TAG_LEAK_PUBLIC
  const reservedLeak = new Set<string>([
    ...MEALS.map(m => m.toLowerCase()),
    ...SEASONS.map(s => s.toLowerCase()),
    ...DIFFICULTIES.map(d => d.toLowerCase()),
    ...(recipe.internalTags ?? []).map(t => t.toLowerCase()),
  ])
  ;(recipe.tags ?? []).forEach((tag, i) => {
    if (reservedLeak.has(tag.toLowerCase())) {
      errors.push({
        code: 'TAG_LEAK_PUBLIC',
        message: `El tag público "${tag}" colisiona con un valor reservado (comida, estación, dificultad o tag interno).`,
        path: `tags[${i}]`,
      })
    }
  })

  // ─── Warnings ──────────────────────────────────────────────────

  // NUTRITION_GAP — ingredient row references catalog row lacking fdcId
  ingredients.forEach((ing, i) => {
    const cat = catalog.byId.get(ing.ingredientId)
    if (!cat) return
    if (cat.fdcId == null) {
      warnings.push({
        code: 'NUTRITION_GAP',
        message: `"${cat.name}" no tiene mapeo de USDA (fdcId); la nutrición será incompleta.`,
        path: `ingredients[${i}]`,
      })
    }
  })

  // MISSING_DENSITY_FOR_ML
  ingredients.forEach((ing, i) => {
    if (ing.unit !== 'ml') return
    const cat = catalog.byId.get(ing.ingredientId)
    if (!cat) return
    if (cat.density == null) {
      warnings.push({
        code: 'MISSING_DENSITY_FOR_ML',
        message: `"${cat.name}" se usa en ml pero no tiene densidad; no se podrá convertir a gramos.`,
        path: `ingredients[${i}]`,
      })
    }
  })

  // KCAL_OUT_OF_BAND
  if (recipe.nutritionPerServing && typeof recipe.nutritionPerServing.kcal === 'number') {
    const kcal = recipe.nutritionPerServing.kcal
    if (kcal < 150 || kcal > 1500) {
      warnings.push({
        code: 'KCAL_OUT_OF_BAND',
        message: `La receta tiene ${kcal.toFixed(0)} kcal por ración; revisa cantidades (rango razonable: 150–1500).`,
        path: 'nutritionPerServing.kcal',
      })
    }
  }

  // STEP_HAS_TIME_HINT_NO_DURATION
  steps.forEach((step, i) => {
    if (step.durationMin != null) return
    if (TIME_HINT_RE.test(step.text ?? '')) {
      warnings.push({
        code: 'STEP_HAS_TIME_HINT_NO_DURATION',
        message: `El paso ${i + 1} contiene una pista de tiempo; añade durationMin.`,
        path: `steps[${i}].durationMin`,
      })
    }
  })

  // NOTE_STARTS_WITH_NUMBER (PRO-184): «6 dientes, laminados» belongs in
  // quantity + unit; the ficha scales only a countable amount of the note.
  ingredients.forEach((ing, i) => {
    if (!noteStartsWithNumber(ing.note)) return
    warnings.push({
      code: 'NOTE_STARTS_WITH_NUMBER',
      message: `La nota del ingrediente ${i + 1} empieza por un número («${String(ing.note).trim()}»): pon esa cantidad en cantidad y unidad (p. ej. 6 u) y deja en la nota solo cómo va («laminados»).`,
      path: `ingredients[${i}].note`,
    })
  })

  // BUY_* — rows the shopping list / shop orders can't use (recipeShoppability.ts)
  const named = ingredients
    .map((ing, i) => ({ ing, i, cat: catalog.byId.get(ing.ingredientId) }))
    .filter((x): x is typeof x & { cat: CatalogIngredient } => !!x.cat)
  for (const issue of shoppabilityIssues(
    named.map(({ ing, cat }) => ({ name: cat.name, quantity: ing.quantity, unit: ing.unit, note: ing.note, optional: ing.optional })),
  )) {
    warnings.push({ code: issue.code, message: issue.message, path: `ingredients[${named[issue.index].i}]` })
  }

  // NO_EQUIPMENT
  if (!recipe.equipment || recipe.equipment.length === 0) {
    warnings.push({
      code: 'NO_EQUIPMENT',
      message: 'La receta no lista ningún utensilio. Considera añadir al menos uno.',
      path: 'equipment',
    })
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
  }
}

/** Look up a sanity range by ingredient name, normalized. */
function pickRange(name: string | undefined): QuantityRange | undefined {
  if (!name) return undefined
  const norm = normalize(name)
  if (INGREDIENT_RANGES[norm]) return INGREDIENT_RANGES[norm]
  // Fallback: match against the first whitespace-separated token (e.g. "pollo de corral" → "pollo")
  const first = norm.split(' ')[0]
  if (first && INGREDIENT_RANGES[first]) return INGREDIENT_RANGES[first]
  return undefined
}
