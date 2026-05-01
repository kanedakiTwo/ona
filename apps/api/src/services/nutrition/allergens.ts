/**
 * Allergen helpers.
 *
 * Two pure functions:
 *
 *   - `allergenUnion(ingredients, catalog)` — returns the deduped, sorted
 *     union of the allergen tags carried by every ingredient on a recipe
 *     (optional rows included — the badge is conservative).
 *
 *   - `inferAllergenTagsFromName(name)` — staple-collapse rule engine
 *     used by the seed script to pre-fill `ingredient.allergenTags` from
 *     a Spanish ingredient name. Case- and accent-insensitive.
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

// Each rule's keyword list is stored already normalized (no diacritics,
// lowercase) so we only normalize the input once.
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
  'harina de trigo',
  'pan',
  'pasta',
]

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

const EGG_KEYWORDS = ['huevo', 'huevos', 'clara', 'yema']

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
 * Used by the seed script (Task 7) to pre-fill the catalog. The output
 * is deduped and alphabetically sorted for deterministic snapshots.
 */
export function inferAllergenTagsFromName(name: string): AllergenTag[] {
  const tags = new Set<AllergenTag>()
  const n = normalize(name)
  if (n.length === 0) return []

  if (containsAny(n, GLUTEN_KEYWORDS)) tags.add('gluten')
  if (containsAny(n, LACTOSE_KEYWORDS)) tags.add('lactosa')
  if (containsAny(n, EGG_KEYWORDS)) tags.add('huevo')
  if (containsAny(n, TREE_NUT_KEYWORDS)) tags.add('frutos_secos')
  if (containsAny(n, PEANUT_KEYWORDS)) tags.add('cacahuetes')
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
