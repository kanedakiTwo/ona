/**
 * Allergen helpers.
 *
 * Pure functions:
 *
 *   - `allergenUnion(ingredients, catalog)` — returns the deduped, sorted
 *     union of the allergen tags carried by every ingredient on a recipe
 *     (optional rows included — the badge is conservative).
 *
 *   - `inferAllergenTagsFromName(name)` — staple-collapse rule engine
 *     used by the seed script to pre-fill `ingredient.allergenTags` from
 *     a Spanish ingredient name. Case- and accent-insensitive.
 *
 *   - `effectiveAllergens(stored, ingredientNames)` — what the recipe ficha
 *     shows: stored union + name inference, additive.
 *
 * Spec: ../../../../../specs/nutrition.md ("Allergens")
 */

// ─── Tag catalogue ──────────────────────────────────────────────

export const ALLERGEN_TAGS = [
  'gluten',
  'lactosa',
  'huevo',
  'frutos_secos',
  'cacahuetes',
  'soja',
  'pescado',
  'marisco',
  'crustaceos',
  'moluscos',
  'apio',
  'mostaza',
  'sesamo',
  'altramuces',
  'sulfitos',
] as const

export type AllergenTag = (typeof ALLERGEN_TAGS)[number]

const ALLERGEN_TAG_SET: ReadonlySet<string> = new Set(ALLERGEN_TAGS)

// ─── allergenUnion ──────────────────────────────────────────────

/**
 * Union of allergen tags across all ingredients on a recipe.
 *
 * Optional ingredients are included by design: the recipe-level allergen
 * badge is the worst case the eater might encounter.
 *
 * Tags not in `ALLERGEN_TAGS` are dropped silently — keeps callers from
 * leaking stray strings into the recipe payload.
 */
export function allergenUnion(
  ingredients: Array<{ ingredientId: string }>,
  catalog: Map<string, { allergenTags?: string[] | null }>,
): AllergenTag[] {
  const seen = new Set<AllergenTag>()
  for (const ing of ingredients) {
    const entry = catalog.get(ing.ingredientId)
    if (!entry) continue
    const tags = entry.allergenTags
    if (!tags || tags.length === 0) continue
    for (const tag of tags) {
      if (ALLERGEN_TAG_SET.has(tag)) {
        seen.add(tag as AllergenTag)
      }
    }
  }
  return Array.from(seen).sort()
}

// ─── inferAllergenTagsFromName ─────────────────────────────────

/**
 * Strip diacritics and lowercase: "Salmón" → "salmon", "ALMENDRA" → "almendra".
 */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .toLowerCase()
    .trim()
}

/**
 * Case- and accent-insensitive substring match. Only used for the
 * «gluten-free base» check, which removes a tag: keeping it substring there
 * never drops a gluten tag that the old rules gave.
 */
function containsAny(haystack: string, needles: readonly string[]): boolean {
  for (const n of needles) {
    if (haystack.includes(n)) return true
  }
  return false
}

const termRegexCache = new Map<string, RegExp>()

/**
 * Whole-word, plural-tolerant match of a normalised term in a normalised name.
 * A term starting with ^ only matches at the start of the name. A term ending
 * with * is a word stem: it matches any word that starts with it
 * («empanad*» → empanadilla, empanado; «ques*» → quesito, quesadilla).
 */
export function nameHasTerm(normalizedName: string, term: string): boolean {
  let re = termRegexCache.get(term)
  if (!re) {
    const anchored = term.startsWith('^')
    const stem = term.endsWith('*')
    const body = term.slice(anchored ? 1 : 0, stem ? -1 : undefined)
    const escaped = body.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const tail = stem ? '' : '(e?s)?($|[^a-z0-9])'
    re = new RegExp(`${anchored ? '^' : '(^|[^a-z0-9])'}${escaped}${tail}`)
    termRegexCache.set(term, re)
  }
  return re.test(normalizedName)
}

/** True when any term of the list is in the name (see `nameHasTerm`). */
function hasAnyTerm(normalizedName: string, terms: readonly string[]): boolean {
  return terms.some((t) => nameHasTerm(normalizedName, t))
}

/** Remove phrases that name something else («nuez moscada» is a spice). */
function stripPhrases(normalizedName: string, phrases: readonly string[]): string {
  let s = normalizedName
  for (const p of phrases) s = s.split(p).join(' ')
  return s
}

// Each rule's keyword list is stored already normalized (no diacritics,
// lowercase) so we only normalize the input once.
//
// PRO-193 (2026-10-17): every list matches **whole words** (with their
// plural) instead of substrings, so «panceta» is not «pan» and «manitas» is
// not «maní». Compounds that used to be caught as substrings are listed
// explicitly, as a whole word or as a stem ending in * («panko»,
// «empanad*», «apionabo», «salmonete», «natill*», «ques*»…), so no tag the
// substring rules gave on a real ingredient is lost. A few phrases that
// name something else are removed before matching («pasta de tomate» is not
// pasta, «leche de coco» is not milk, «nuez moscada» is not a nut).
//
// Gluten is conservative on purpose (PRO-61, Miguel 2026-10-12, «reglas
// prudentes»): for a coeliac a missed tag is a reaction, an extra one only
// costs a recipe. Rules:
//   - cereals with gluten and their products always count;
//   - any flour / pasta / noodle counts unless it names a gluten-free base
//     (arroz, maíz, garbanzo, almendra, trigo sarraceno, mandioca);
//   - soy sauce (salsa de soja, tamari, shoyu) counts — it is usually brewed
//     with wheat — unless it says «sin gluten»;
//   - anything labelled «sin gluten» never counts.
const GLUTEN_KEYWORDS = [
  'trigo',
  'cebada',
  'centeno',
  'avena',
  'espelta',
  'kamut',
  'cuscus',
  'bulgur',
  'seitan',
  'pan',
  'panko',
  'panecill*',
  'panettone',
  'panetone',
  'empanad*',
  'cervez*',
  'malta',
  'worcestershire',
  'perrins',
  'gallet*',
  'bizcoch*',
  'hojaldr*',
  'rebozad*',
  'tempura',
  'picatost*',
]

/** Flour-like products: gluten unless they name a gluten-free base. */
const GLUTEN_FLOUR_LIKE = [
  'harina',
  'pasta',
  'fideo',
  'noodle',
  'espagueti',
  'spaghetti',
  'macarron',
  'tallarin',
  'lasana',
  'canelon',
  'noqui',
  'gnocchi',
  'semola',
  'masa',
]

/** «Pasta de …» that is a paste, not pasta (PRO-193). */
const NOT_PASTA_PHRASES = ['pasta de tomate', 'pasta de curry', 'pasta de sesamo']

const GLUTEN_FREE_BASES = ['arroz', 'maiz', 'garbanzo', 'almendra', 'trigo sarraceno', 'mandioca']

const SOY_SAUCE_KEYWORDS = ['salsa de soja', 'tamari', 'shoyu']

function hasGluten(n: string): boolean {
  if (n.includes('sin gluten')) return false
  // Buckwheat is not wheat: drop it before looking for "trigo".
  const s = n.replace(/trigo sarraceno/g, ' ')
  if (hasAnyTerm(s, GLUTEN_KEYWORDS)) return true
  if (hasAnyTerm(n, SOY_SAUCE_KEYWORDS)) return true
  const flour = stripPhrases(n, NOT_PASTA_PHRASES)
  if (hasAnyTerm(flour, GLUTEN_FLOUR_LIKE) && !containsAny(n, GLUTEN_FREE_BASES)) return true
  return false
}

const LACTOSE_KEYWORDS = [
  'leche',
  'ques*',
  'yogur*',
  'mantequill*',
  'nata',
  'natill*',
  'crema',
  'requeson',
  'mascarpone',
  'parmesano',
  'mozzarella',
  'feta',
  'cuajada',
]

/** Plant drinks called «leche de …» (PRO-193). */
const NOT_MILK_PHRASES = [
  'leche de coco',
  'leche de almendras',
  'leche de almendra',
  'leche de avena',
  'leche de soja',
  'leche de arroz',
]

const EGG_KEYWORDS = ['huevo', 'clara', 'yema', 'mayonesa']

const TREE_NUT_KEYWORDS = [
  'almendr*',
  'nuez de macadamia',
  'nuez',
  'nueces',
  'avellan*',
  'pistach*',
  'anacard*',
  'pecana',
  'castana',
  'frutos secos',
]

/** Nutmeg is a spice, not a nut (PRO-193). */
const NOT_NUT_PHRASES = ['nuez moscada']

// Peanut: whole word since PRO-160 («manitas de cerdo», «mandarina»).
const PEANUT_KEYWORDS = ['cacahuete', 'mani']

const SOY_KEYWORDS = [
  'soja',
  'tofu',
  'tempeh',
  'edamame',
  'tamari',
  'miso',
]

const FISH_KEYWORDS = [
  'pescad*',
  'salmon',
  'salmonete',
  'bacalao',
  'atun',
  'merluza',
  'lubina',
  'dorada',
  'caballa',
  'sardin*',
  'boqueron',
  'anchoa',
  'trucha',
  'corvina',
  'rape',
  'rodaballo',
  'lenguado',
  'besugo',
  'jurel',
  'emperador',
  'pez espada',
  'bonito',
  'surimi',
  'fumet',
  'worcestershire',
  'perrins',
]

const CRUSTACEAN_KEYWORDS = [
  'gamba',
  'langostin*',
  'cigala',
  'langosta',
  'cangrejo',
  'bogavante',
]

const MOLLUSC_KEYWORDS = [
  'mejillon',
  'almeja',
  'berberecho',
  'pulpo',
  'calamar',
  'sepia',
  'chipiron',
  'vieira',
  'ostra',
]

const CELERY_KEYWORDS = ['apio', 'apionabo']
const MUSTARD_KEYWORDS = ['mostaza']
const SESAME_KEYWORDS = ['sesamo', 'tahini', 'tahina']
const LUPIN_KEYWORDS = ['altramuz', 'altramuces']
const SULFITE_KEYWORDS = ['vino', 'vinagre', 'vinagret*']

/**
 * Infer EU-labelling allergen tags from a Spanish ingredient name.
 *
 * Used by the seed script (Task 7) to pre-fill the catalog, by ingredient
 * auto-create, by the restriction filter (dietaryRestrictions.ts) and by
 * `effectiveAllergens` below. The output is deduped and alphabetically
 * sorted for deterministic snapshots.
 */
export function inferAllergenTagsFromName(name: string): AllergenTag[] {
  const tags = new Set<AllergenTag>()
  const n = normalize(name)
  if (n.length === 0) return []

  if (hasGluten(n)) tags.add('gluten')
  if (hasAnyTerm(stripPhrases(n, NOT_MILK_PHRASES), LACTOSE_KEYWORDS)) tags.add('lactosa')
  if (hasAnyTerm(n, EGG_KEYWORDS)) tags.add('huevo')
  if (hasAnyTerm(stripPhrases(n, NOT_NUT_PHRASES), TREE_NUT_KEYWORDS)) tags.add('frutos_secos')
  if (hasAnyTerm(n, PEANUT_KEYWORDS)) tags.add('cacahuetes')
  if (hasAnyTerm(n, SOY_KEYWORDS)) tags.add('soja')
  if (hasAnyTerm(n, FISH_KEYWORDS)) tags.add('pescado')
  if (hasAnyTerm(n, CRUSTACEAN_KEYWORDS)) {
    tags.add('crustaceos')
    tags.add('marisco')
  }
  if (hasAnyTerm(n, MOLLUSC_KEYWORDS)) {
    tags.add('moluscos')
    tags.add('marisco')
  }
  if (hasAnyTerm(n, CELERY_KEYWORDS)) tags.add('apio')
  if (hasAnyTerm(n, MUSTARD_KEYWORDS)) tags.add('mostaza')
  if (hasAnyTerm(n, SESAME_KEYWORDS)) tags.add('sesamo')
  if (hasAnyTerm(n, LUPIN_KEYWORDS)) tags.add('altramuces')
  if (hasAnyTerm(n, SULFITE_KEYWORDS)) tags.add('sulfitos')

  return Array.from(tags).sort()
}

/**
 * The allergens a recipe's ficha shows: the stored union (`recipes.allergens`,
 * computed from catalogue tags when the recipe was saved) plus what the
 * ingredient names say today. Additive only — a stored tag is never dropped.
 *
 * PRO-61 (2026-10-12): stored unions went stale when the name rules were
 * missing words («Harina de fuerza», «Salsa de soja» → no gluten). Computing
 * this when the recipe is read fixes every recipe at once without touching
 * the database, and stays right as the rules improve.
 */
export function effectiveAllergens(
  stored: readonly string[] | null | undefined,
  ingredientNames: readonly string[],
): AllergenTag[] {
  const seen = new Set<AllergenTag>()
  for (const t of stored ?? []) if (ALLERGEN_TAG_SET.has(t)) seen.add(t as AllergenTag)
  for (const name of ingredientNames) for (const t of inferAllergenTagsFromName(name)) seen.add(t)
  return Array.from(seen).sort()
}
