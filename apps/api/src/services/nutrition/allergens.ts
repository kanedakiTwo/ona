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
 * Case- and accent-insensitive substring match.
 * Inputs are pre-normalized for the dictionary side (`needles`).
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
 * A term starting with ^ only matches at the start of the name.
 */
export function nameHasTerm(normalizedName: string, term: string): boolean {
  let re = termRegexCache.get(term)
  if (!re) {
    const anchored = term.startsWith('^')
    const escaped = (anchored ? term.slice(1) : term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(`${anchored ? '^' : '(^|[^a-z0-9])'}${escaped}(e?s)?($|[^a-z0-9])`)
    termRegexCache.set(term, re)
  }
  return re.test(normalizedName)
}

// Each rule's keyword list is stored already normalized (no diacritics,
// lowercase) so we only normalize the input once.
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
  'cerveza',
  'malta',
  'worcestershire',
  'perrins',
  'galleta',
  'bizcocho',
  'hojaldre',
  'rebozad',
  'tempura',
  'picatoste',
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

const GLUTEN_FREE_BASES = ['arroz', 'maiz', 'garbanzo', 'almendra', 'trigo sarraceno', 'mandioca']

const SOY_SAUCE_KEYWORDS = ['salsa de soja', 'tamari', 'shoyu']

function hasGluten(n: string): boolean {
  if (n.includes('sin gluten')) return false
  // Buckwheat is not wheat: drop it before looking for "trigo".
  const s = n.replace(/trigo sarraceno/g, '')
  if (containsAny(s, GLUTEN_KEYWORDS)) return true
  if (containsAny(n, SOY_SAUCE_KEYWORDS)) return true
  if (containsAny(n, GLUTEN_FLOUR_LIKE) && !containsAny(n, GLUTEN_FREE_BASES)) return true
  return false
}

const LACTOSE_KEYWORDS = [
  'leche',
  'queso',
  'yogur',
  'mantequilla',
  'nata',
  'crema',
  'requeson',
  'mascarpone',
  'parmesano',
  'mozzarella',
  'feta',
  'cuajada',
]

const EGG_KEYWORDS = ['huevo', 'huevos', 'clara', 'yema', 'mayonesa']

const TREE_NUT_KEYWORDS = [
  'almendra',
  'nuez de macadamia',
  'nuez',
  'avellana',
  'pistacho',
  'anacardo',
  'pecana',
  'castana',
  'frutos secos',
]

// Peanut is matched by whole word (PRO-160): as a substring «mani» tagged
// «manitas de cerdo» and «mandarina». The other lists stay substring on
// purpose — whole-word would miss panko, empanadilla, apionabo, salmonete.
const PEANUT_KEYWORDS = ['cacahuete', 'mani']

const SOY_KEYWORDS = [
  'salsa de soja',
  'soja',
  'tofu',
  'tempeh',
  'edamame',
  'tamari',
  'miso',
]

const FISH_KEYWORDS = [
  'pescado',
  'salmon',
  'bacalao',
  'atun',
  'merluza',
  'lubina',
  'dorada',
  'caballa',
  'sardina',
  'boqueron',
  'anchoa',
  'trucha',
  'corvina',
  'rape',
  'rodaballo',
  'lenguado',
  'besugo',
  'pescadilla',
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
  'langostino',
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

const CELERY_KEYWORDS = ['apio']
const MUSTARD_KEYWORDS = ['mostaza']
const SESAME_KEYWORDS = ['sesamo', 'tahini', 'tahina']
const LUPIN_KEYWORDS = ['altramuz', 'altramuces']
const SULFITE_KEYWORDS = ['vino', 'vinagre']

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
  if (containsAny(n, LACTOSE_KEYWORDS)) tags.add('lactosa')
  if (containsAny(n, EGG_KEYWORDS)) tags.add('huevo')
  if (containsAny(n, TREE_NUT_KEYWORDS)) tags.add('frutos_secos')
  if (PEANUT_KEYWORDS.some((k) => nameHasTerm(n, k))) tags.add('cacahuetes')
  if (containsAny(n, SOY_KEYWORDS)) tags.add('soja')
  if (containsAny(n, FISH_KEYWORDS)) tags.add('pescado')
  if (containsAny(n, CRUSTACEAN_KEYWORDS)) {
    tags.add('crustaceos')
    tags.add('marisco')
  }
  if (containsAny(n, MOLLUSC_KEYWORDS)) {
    tags.add('moluscos')
    tags.add('marisco')
  }
  if (containsAny(n, CELERY_KEYWORDS)) tags.add('apio')
  if (containsAny(n, MUSTARD_KEYWORDS)) tags.add('mostaza')
  if (containsAny(n, SESAME_KEYWORDS)) tags.add('sesamo')
  if (containsAny(n, LUPIN_KEYWORDS)) tags.add('altramuces')
  if (containsAny(n, SULFITE_KEYWORDS)) tags.add('sulfitos')

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
