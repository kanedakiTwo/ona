/**
 * What a user's restrictions ("sin gluten", "vegetariano", "marisco",
 * "cilantro"…) actually exclude.
 *
 * Until 2026-10-07 the matcher compared each restriction string with each
 * ingredient name for equality, so "sin gluten" only excluded an ingredient
 * literally called "sin gluten" — allergies filtered nothing. Now each entry
 * compiles to:
 *   - EU allergen tags (gluten, lactosa, huevo, frutos_secos…), checked against
 *     the recipe's allergen union, each ingredient's catalogue tags AND the
 *     name-based inference (conservative: a false positive costs a recipe, a
 *     false negative costs a reaction);
 *   - ingredient terms (whole-word, accent/case-insensitive, plural-tolerant),
 *     for diets (vegetariano, vegano, sin cerdo) and anything free-text.
 *
 * Spec: specs/menus.md ("Restrictions & allergies").
 */
import { ALLERGEN_TAGS, inferAllergenTagsFromName, type AllergenTag } from './nutrition/allergens.js'

export function normalizeText(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

const SEAFOOD: AllergenTag[] = ['marisco', 'crustaceos', 'moluscos']
const FISH_AND_SEAFOOD: AllergenTag[] = ['pescado', ...SEAFOOD]

/** Normalised alias → allergen tags. */
const ALLERGEN_ALIASES: Record<string, AllergenTag[]> = {
  gluten: ['gluten'],
  celiaco: ['gluten'],
  celiaca: ['gluten'],
  celiaquia: ['gluten'],
  trigo: ['gluten'],
  lactosa: ['lactosa'],
  lacteos: ['lactosa'],
  lacteo: ['lactosa'],
  leche: ['lactosa'],
  'proteina de leche': ['lactosa'],
  'proteina de la leche': ['lactosa'],
  aplv: ['lactosa'],
  huevo: ['huevo'],
  huevos: ['huevo'],
  'frutos secos': ['frutos_secos', 'cacahuetes'],
  'fruto seco': ['frutos_secos', 'cacahuetes'],
  nueces: ['frutos_secos'],
  almendras: ['frutos_secos'],
  avellanas: ['frutos_secos'],
  pistachos: ['frutos_secos'],
  anacardos: ['frutos_secos'],
  cacahuete: ['cacahuetes'],
  cacahuetes: ['cacahuetes'],
  mani: ['cacahuetes'],
  soja: ['soja'],
  pescado: ['pescado'],
  marisco: SEAFOOD,
  mariscos: SEAFOOD,
  crustaceos: ['crustaceos', 'marisco'],
  crustaceo: ['crustaceos', 'marisco'],
  moluscos: ['moluscos', 'marisco'],
  molusco: ['moluscos', 'marisco'],
  apio: ['apio'],
  mostaza: ['mostaza'],
  sesamo: ['sesamo'],
  altramuces: ['altramuces'],
  altramuz: ['altramuces'],
  sulfitos: ['sulfitos'],
}

const PORK_TERMS = [
  'cerdo', 'jamon', 'chorizo', 'panceta', 'bacon', 'beicon', 'tocino', 'lomo', 'salchichon', 'fuet',
  'sobrasada', 'morcilla', 'butifarra', 'lacon', 'cochinillo', 'secreto iberico', 'presa iberica',
  'pluma iberica', 'manteca de cerdo', 'costilla de cerdo', 'costillas de cerdo', 'carrillada', 'mortadela',
]

const MEAT_TERMS = [
  ...PORK_TERMS,
  'carne', 'pollo', 'pavo', 'ternera', 'vaca', 'vacuno', 'buey', 'cordero', 'cabrito', 'conejo', 'pato',
  'codorniz', 'perdiz', 'ciervo', 'venado', 'jabali', 'cecina', 'salchicha', 'hamburguesa', 'albondiga',
  'chuleta', 'chuleton', 'entrecot', 'solomillo', 'filete de ternera', 'pechuga', 'muslo', 'contramuslo',
  'alitas', 'carrillera', 'rabo de toro', 'higado', 'mollejas', 'callos', 'magret', 'foie', 'pate',
  'caldo de pollo', 'caldo de carne', 'fondo de carne', 'gelatina', 'pepperoni', 'kebab', 'sesos',
]

const FISH_TERMS = [
  'pescado', 'atun', 'bonito', 'salmon', 'bacalao', 'merluza', 'lubina', 'dorada', 'caballa', 'sardina',
  'boqueron', 'anchoa', 'trucha', 'rape', 'rodaballo', 'emperador', 'pez espada', 'lenguado',
  'surimi', 'caviar', 'huevas', 'salsa de pescado', 'caldo de pescado', 'fumet', 'gamba', 'langostino',
  'cigala', 'langosta', 'cangrejo', 'bogavante', 'mejillon', 'almeja', 'berberecho', 'pulpo', 'calamar',
  'sepia', 'chipiron', 'vieira', 'ostra', 'navaja', 'marisco',
]

const ANIMAL_PRODUCT_TERMS = [
  'leche', 'queso', 'yogur', 'nata', 'mantequilla', 'ghee', 'requeson', 'kefir', 'cuajada', 'mascarpone',
  'mozzarella', 'parmesano', 'burrata', 'ricotta', 'feta', 'crema de leche', 'huevo', 'clara', 'yema',
  'miel', 'gelatina',
]

interface DietRule {
  allergens: AllergenTag[]
  terms: string[]
}

const DIETS: Record<string, DietRule> = {
  vegetariano: { allergens: FISH_AND_SEAFOOD, terms: [...MEAT_TERMS, ...FISH_TERMS] },
  vegetariana: { allergens: FISH_AND_SEAFOOD, terms: [...MEAT_TERMS, ...FISH_TERMS] },
  ovolactovegetariano: { allergens: FISH_AND_SEAFOOD, terms: [...MEAT_TERMS, ...FISH_TERMS] },
  vegano: { allergens: [...FISH_AND_SEAFOOD, 'lactosa', 'huevo'], terms: [...MEAT_TERMS, ...FISH_TERMS, ...ANIMAL_PRODUCT_TERMS] },
  vegana: { allergens: [...FISH_AND_SEAFOOD, 'lactosa', 'huevo'], terms: [...MEAT_TERMS, ...FISH_TERMS, ...ANIMAL_PRODUCT_TERMS] },
  pescetariano: { allergens: [], terms: MEAT_TERMS },
  pescetariana: { allergens: [], terms: MEAT_TERMS },
  carne: { allergens: [], terms: MEAT_TERMS }, // "sin carne"
  cerdo: { allergens: [], terms: PORK_TERMS },
  halal: { allergens: [], terms: [...PORK_TERMS, 'vino', 'cerveza', 'licor', 'brandy', 'ron', 'conac'] },
}

const PREFIXES = [
  /^(soy |es )?(alergic[oa]|intolerante) (a los |a las |a la |al |a )?/,
  /^(alergia|intolerancia) (a los |a las |a la |al |a )?/,
  /^no (como|tomo|puedo tomar|puedo comer) /,
  /^nada de /,
  /^sin /,
  /^dieta /,
]

/** "Sin gluten" → "gluten", "alergia a los frutos secos" → "frutos secos". */
export function restrictionKey(entry: string): string {
  let s = normalizeText(entry)
  for (const re of PREFIXES) s = s.replace(re, '')
  return s.trim()
}

/**
 * A user's restrictions live in two places: the profile (`users.restrictions`,
 * onboarding + /profile chips) and long-term memory (`user_memories.restrictions`,
 * written by the voice onboarding and by "soy celíaco" told to the assistant).
 * Every filter must apply both. Deduped by meaning ("Sin gluten" = "gluten").
 */
export function mergeRestrictions(
  profile: readonly string[] | null | undefined,
  memory?: { restrictions?: { value?: unknown } | null } | null,
): string[] {
  const fromMemory = Array.isArray(memory?.restrictions?.value) ? (memory!.restrictions!.value as unknown[]) : []
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of [...(profile ?? []), ...fromMemory]) {
    if (typeof r !== 'string') continue
    const key = restrictionKey(r)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

export interface CompiledRestrictions {
  /** Allergen tags the user must never be served. */
  allergens: Set<AllergenTag>
  /** Normalised ingredient terms (whole word, plural-tolerant). */
  terms: string[]
}

/**
 * Compile restriction entries (allergies, diets, free text) and dislikes
 * (always free-text terms) into one predicate input.
 */
export function compileRestrictions(restrictions: readonly string[], dislikes: readonly string[] = []): CompiledRestrictions {
  const allergens = new Set<AllergenTag>()
  const terms = new Set<string>()
  for (const raw of restrictions) {
    const key = restrictionKey(raw)
    if (!key) continue
    const diet = DIETS[key]
    if (diet) {
      diet.allergens.forEach((a) => allergens.add(a))
      diet.terms.forEach((t) => terms.add(t))
      continue
    }
    const tags = ALLERGEN_ALIASES[key] ?? ((ALLERGEN_TAGS as readonly string[]).includes(key) ? [key as AllergenTag] : null)
    if (tags) {
      tags.forEach((a) => allergens.add(a))
      continue
    }
    terms.add(key) // free text: "cilantro", "picante"…
  }
  for (const raw of dislikes) {
    const key = restrictionKey(raw)
    if (key) terms.add(key)
  }
  return { allergens, terms: [...terms] }
}

const termRegexCache = new Map<string, RegExp>()

/** Whole-word, plural-tolerant match of a normalised term in a normalised name. */
export function nameHasTerm(normalizedName: string, term: string): boolean {
  let re = termRegexCache.get(term)
  if (!re) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    re = new RegExp(`(^|[^a-z0-9])${escaped}(e?s)?($|[^a-z0-9])`)
    termRegexCache.set(term, re)
  }
  return re.test(normalizedName)
}

export interface RestrictableRecipe {
  /** Recipe-level allergen union (recipes.allergens). */
  allergens?: readonly string[] | null
  ingredients: ReadonlyArray<{ ingredientName: string; allergenTags?: readonly string[] | null }>
}

/** True when the recipe contains something the compiled restrictions exclude. */
export function violatesRestrictions(recipe: RestrictableRecipe, rules: CompiledRestrictions): boolean {
  if (rules.allergens.size === 0 && rules.terms.length === 0) return false
  if (rules.allergens.size > 0) {
    if ((recipe.allergens ?? []).some((a) => rules.allergens.has(a as AllergenTag))) return true
  }
  for (const ing of recipe.ingredients) {
    if (rules.allergens.size > 0) {
      if ((ing.allergenTags ?? []).some((a) => rules.allergens.has(a as AllergenTag))) return true
      if (inferAllergenTagsFromName(ing.ingredientName).some((a) => rules.allergens.has(a))) return true
    }
    if (rules.terms.length > 0) {
      const name = normalizeText(ing.ingredientName)
      if (rules.terms.some((t) => nameHasTerm(name, t))) return true
    }
  }
  return false
}
