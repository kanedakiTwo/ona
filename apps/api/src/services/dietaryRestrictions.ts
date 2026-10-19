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
import { ALLERGEN_TAGS, inferAllergenTagsFromName, nameHasTerm, type AllergenTag } from './nutrition/allergens.js'

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
  'cerdo', 'jamon', 'chorizo', 'panceta', 'pancetta', 'bacon', 'beicon', 'tocino', 'lomo', 'salchichon', 'fuet',
  'sobrasada', 'morcilla', 'butifarra', 'lacon', 'cochinillo', 'secreto iberico', 'presa iberica',
  'pluma iberica', 'manteca de cerdo', 'costilla de cerdo', 'costillas de cerdo', 'carrillada', 'mortadela',
  'chistorra', 'longaniza', 'torrezno', 'chicharron', 'codillo', 'papada', 'careta', 'guanciale', 'lardo',
  'prosciutto', 'salami', 'espinazo',
]

// PRO-61 (2026-10-12, Miguel: «reglas prudentes»): cuts, offal and dishes
// whose name doesn't say which animal («Costillas», «Rabo», «Sobras del
// cocido») count as meat. «Cocido» only as the dish (start of the name or
// «del/de cocido»), so «garbanzos cocidos» is still vegetarian. A term that
// starts with ^ only matches at the start of the ingredient name.
const MEAT_TERMS = [
  ...PORK_TERMS,
  'carne', 'pollo', 'pavo', 'ternera', 'vaca', 'vacuno', 'buey', 'cordero', 'cabrito', 'conejo', 'pato',
  'codorniz', 'perdiz', 'ciervo', 'venado', 'jabali', 'cecina', 'salchicha', 'hamburguesa', 'albondiga',
  'chuleta', 'chuleton', 'entrecot', 'solomillo', 'filete de ternera', 'pechuga', 'muslo', 'contramuslo',
  'alitas', 'carrillera', 'rabo de toro', 'higado', 'mollejas', 'callos', 'magret', 'foie', 'pate',
  'caldo de pollo', 'caldo de carne', 'fondo de carne', 'gelatina', 'pepperoni', 'kebab', 'sesos',
  // Cuts and offal on their own.
  'costilla', 'rabo', 'oreja', 'morro', 'manitas', 'rinon', 'molleja', 'entrana', 'morcillo', 'jarrete',
  'osobuco', 'tuetano', 'hueso de cana', 'hueso de rodilla', 'hueso blanco', 'aguja', 'falda', 'babilla',
  'picana', 'lengua', 'casqueria', 'criadilla', 'menudillo', 'asadura', 'bistec', 'escalope', 'cachopo',
  'flamenquin', 'san jacobo', 'churrasco', '^gallina', 'cuarto de gallina', 'caldo de gallina', 'capon',
  'pularda', 'pichon', 'faisan', 'liebre', 'oca', 'ganso', 'embutido', 'fiambre', 'steak tartar',
  // Dishes made of meat.
  '^cocido', 'del cocido', 'de cocido', 'ropa vieja', 'pringa',
]

const FISH_TERMS = [
  'pescado', 'atun', 'bonito', 'salmon', 'bacalao', 'merluza', 'lubina', 'dorada', 'caballa', 'sardina',
  'boqueron', 'anchoa', 'trucha', 'rape', 'rodaballo', 'emperador', 'pez espada', 'lenguado',
  'surimi', 'caviar', 'huevas', 'salsa de pescado', 'caldo de pescado', 'fumet', 'gamba', 'langostino',
  'cigala', 'langosta', 'cangrejo', 'bogavante', 'mejillon', 'almeja', 'berberecho', 'pulpo', 'calamar',
  'sepia', 'chipiron', 'vieira', 'ostra', 'navaja', 'marisco',
  'corvina', 'besugo', 'pescadilla', 'jurel', 'chicharro', 'mero', 'pargo', 'palometa', 'abadejo',
  'carbonero', 'arenque', 'angula', 'gula', 'cazon', 'raya', 'mojama', 'ventresca', 'kokotxa', 'cococha',
  'bacaladilla', 'tilapia', 'panga', 'perca', 'erizo', 'percebe', 'necora', 'centolla', 'carabinero',
  'quisquilla', 'camaron', 'zamburina', 'dashi', 'katsuobushi', 'worcestershire', 'perrins',
]

const ANIMAL_PRODUCT_TERMS = [
  'leche', 'queso', 'yogur', 'nata', 'mantequilla', 'ghee', 'requeson', 'kefir', 'cuajada', 'mascarpone',
  'mozzarella', 'parmesano', 'burrata', 'ricotta', 'feta', 'crema de leche', 'huevo', 'clara', 'yema',
  'miel', 'gelatina',
]

// PRO-144 (beta, 2026-10-16: «Riñones al jerez» to a household with a
// 3-year-old). «Sin alcohol» skips any recipe with an alcoholic drink among
// its ingredients — even the wine of a sofrito, which could be left out:
// better too many than too few. Whole words, so «ron» doesn't hit «ronqueta»
// nor «cava» «cavar». Vinegars («vinagre de vino / de jerez / de sidra») and
// brewer's yeast («levadura de cerveza») have no alcohol and don't count.
// Also checked against the recipe's name when the caller passes it
// («Carrilleras de ternera con vino tinto»).
export const ALCOHOL_TERMS = [
  'alcohol', 'vino', 'jerez', 'cerveza', 'sidra', 'brandy', 'conac', 'cognac', 'licor', 'ron', 'oporto',
  'vermut', 'vermu', 'cava', 'champan', 'champagne', 'whisky', 'whiskey', 'bourbon', 'ginebra', 'vodka',
  'tequila', 'orujo', 'aguardiente', 'pacharan', 'marsala', 'pedro ximenez', 'amontillado', 'sake', 'mirin',
  'calvados', 'armagnac', 'kirsch', 'amaretto', 'cointreau', 'grand marnier', 'triple seco',
]

const NOT_ALCOHOL = [
  /(^|[^a-z0-9])vinagre(ta)?s?(( de| del| al)? (vino|vinos|jerez|sidra|cava|cerveza|oporto|pedro ximenez|moscatel|modena|manzana|arroz|blanco|tinto|rosado|balsamico))+/g,
  /(^|[^a-z0-9])levadura (de )?cerveza/g,
]

/** True when a normalised ingredient (or recipe) name has an alcoholic drink. */
export function nameHasAlcohol(normalizedName: string): boolean {
  let n = normalizedName
  for (const re of NOT_ALCOHOL) n = n.replace(re, ' ')
  return ALCOHOL_TERMS.some((t) => nameHasTerm(n, t))
}

interface DietRule {
  allergens: AllergenTag[]
  terms: string[]
  /** Also excludes alcoholic drinks (ALCOHOL_TERMS, vinegars excepted). */
  alcohol?: boolean
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
  halal: { allergens: [], terms: PORK_TERMS, alcohol: true },
  alcohol: { allergens: [], terms: [], alcohol: true }, // "sin alcohol"
  'bebidas alcoholicas': { allergens: [], terms: [], alcohol: true },
}

const PREFIXES = [
  /^(soy |es )?(alergic[oa]|intolerante) (a los |a las |a la |al |a )?/,
  /^(alergia|intolerancia) (a los |a las |a la |al |a )?/,
  /^no (como|tomo|puedo tomar|puedo comer) /,
  /^nada de /,
  /^sin /,
  /^dieta /,
  // PRO-197: «soy celíaco», «soy vegetariana» (as told to Mimo) → the diet itself.
  /^(soy|somos|es) /,
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
  /** «Sin alcohol» (or halal): no alcoholic drink in the ingredients or the name. */
  alcohol: boolean
}

/**
 * Compile restriction entries (allergies, diets, free text) and dislikes
 * (always free-text terms) into one predicate input.
 */
export function compileRestrictions(restrictions: readonly string[], dislikes: readonly string[] = []): CompiledRestrictions {
  const allergens = new Set<AllergenTag>()
  const terms = new Set<string>()
  let alcohol = false
  for (const raw of restrictions) {
    const key = restrictionKey(raw)
    if (!key) continue
    // «cocinamos siempre sin alcohol», «nada con alcohol»…
    const diet = DIETS[key] ?? (nameHasTerm(key, 'alcohol') ? DIETS.alcohol : undefined)
    if (diet) {
      diet.allergens.forEach((a) => allergens.add(a))
      diet.terms.forEach((t) => terms.add(t))
      if (diet.alcohol) alcohol = true
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
  return { allergens, terms: [...terms], alcohol }
}

// nameHasTerm lives in nutrition/allergens.ts (PRO-160: the peanut rule
// uses it too); re-exported here for the existing callers.
export { nameHasTerm }

export interface RestrictableRecipe {
  /** Recipe name: only the alcohol rule reads it («Riñones al jerez»). */
  name?: string | null
  /** Recipe-level allergen union (recipes.allergens). */
  allergens?: readonly string[] | null
  ingredients: ReadonlyArray<{
    ingredientName: string
    allergenTags?: readonly string[] | null
    /**
     * PRO-198: what a compound ingredient contains (`ingredients.contains_tags`:
     * «cerdo», «pollo», «gluten»…). Each tag counts as an allergen tag when it
     * is one, and as a word of the name for diets, dislikes and alcohol.
     */
    containsTags?: readonly string[] | null
  }>
}

/** True when the recipe contains something the compiled restrictions exclude. */
export function violatesRestrictions(recipe: RestrictableRecipe, rules: CompiledRestrictions): boolean {
  if (rules.allergens.size === 0 && rules.terms.length === 0 && !rules.alcohol) return false
  if (rules.alcohol && recipe.name && nameHasAlcohol(normalizeText(recipe.name))) return true
  if (rules.allergens.size > 0) {
    if ((recipe.allergens ?? []).some((a) => rules.allergens.has(a as AllergenTag))) return true
  }
  for (const ing of recipe.ingredients) {
    if (rules.allergens.size > 0) {
      if ((ing.allergenTags ?? []).some((a) => rules.allergens.has(a as AllergenTag))) return true
      if (inferAllergenTagsFromName(ing.ingredientName).some((a) => rules.allergens.has(a))) return true
    }
    if (rules.terms.length > 0 || rules.alcohol) {
      const name = normalizeText(ing.ingredientName)
      if (rules.terms.some((t) => nameHasTerm(name, t))) return true
      if (rules.alcohol && nameHasAlcohol(name)) return true
    }
    // PRO-198: what a compound ingredient contains counts as an allergen tag
    // and as a word of its name.
    for (const raw of ing.containsTags ?? []) {
      const tag = normalizeText(raw)
      if (!tag) continue
      if (rules.allergens.has(tag as AllergenTag)) return true
      if (rules.terms.some((t) => nameHasTerm(tag, t))) return true
      if (rules.alcohol && nameHasAlcohol(tag)) return true
    }
  }
  return false
}

/**
 * Ids of the recipes that break the user's allergies / diet (not dislikes).
 * Used by GET /recipes?fitsMe=1 — the menu's «Elegir otra receta» picker.
 */
export function recipeIdsBreakingRestrictions(
  recipes: ReadonlyArray<RestrictableRecipe & { id: string }>,
  restrictions: readonly string[],
): string[] {
  const rules = compileRestrictions(restrictions)
  if (rules.allergens.size === 0 && rules.terms.length === 0 && !rules.alcohol) return []
  return recipes.filter((r) => violatesRestrictions(r, rules)).map((r) => r.id)
}
