/**
 * PRO-73 — quality gate for catalogue recipes (quantities and steps).
 *
 * The hogares de prueba got catalogue recipes with 75 g of chicken for two,
 * one egg in a tortilla for two, 25 g of pasta per person or no steps at all,
 * and the shopping list and Mimo copied them. Until Cocina's corrections land
 * (batched, for Miguel's OK), the menu generator skips the recipes this audit
 * flags. It is computed in code from the recipe as loaded: nothing is written
 * to the database, and a recipe drops out of the check as soon as it's fixed.
 *
 * A system recipe (no author) fails when:
 *   - it has no steps;
 *   - it has 2 ingredients or fewer;
 *   - its main protein per serving (meat, fish, seafood, eggs, tofu…, all
 *     added up; cured meats and yolks are garnish, not the main) is under
 *     80 g or over 300 g;
 *   - its pasta, rice or dry pulses per serving (added up) are under 50 g or
 *     over 150 g.
 * Quantity checks only run when every counted ingredient converts to grams
 * (g, ml, or units with a known weight); an unknown weight never flags.
 *
 * Users' own recipes are never audited: their quantities are theirs.
 *
 * Spec: specs/menus.md («Catalogue quality gate»).
 */
import { normalizeText } from './dietaryRestrictions.js'

export const MAIN_PROTEIN_RANGE_G = { min: 80, max: 300 } as const
export const STARCH_RANGE_G = { min: 50, max: 150 } as const

export type CatalogAuditIssue = 'sin_pasos' | 'pocos_ingredientes' | 'proteina_fuera_de_rango' | 'base_fuera_de_rango'

export interface AuditIngredient {
  name: string
  quantity: number
  unit: string
  /** ingredients.unit_weight (g per unit), when known. */
  unitWeight?: number | null
  /** ingredients.density (g per ml), when known. */
  density?: number | null
}

export interface AuditableRecipe {
  name: string
  servings: number
  stepCount: number
  ingredients: readonly AuditIngredient[]
}

export interface CatalogAuditResult {
  issues: CatalogAuditIssue[]
  /** Grams per serving of the main protein / the starch base (null = not counted or unknown). */
  proteinPerServingG: number | null
  starchPerServingG: number | null
}

// ─── Ingredient groups (accent/case-insensitive, whole words, plurals) ──

/** Meat, fish, seafood, eggs and plant proteins that make the main of a dish. */
const PROTEIN_TERMS = [
  // meat
  'pollo', 'pavo', 'ternera', 'vaca', 'buey', 'cerdo', 'cordero', 'cabrito', 'conejo', 'pato', 'codorniz',
  'carne', 'aguja', 'costilla', 'secreto', 'presa', 'pluma', 'lomo', 'solomillo', 'entrana', 'entrecot',
  'chuleta', 'chuleton', 'carrillera', 'rabo', 'oreja', 'rinon', 'higado', 'morcillo', 'jarrete', 'osobuco',
  'pechuga', 'muslo', 'contramuslo', 'alitas', 'albondiga', 'hamburguesa', 'magret', 'cochinita',
  'salchicha', 'sobras del cocido',
  // fish and seafood
  'pescado', 'atun', 'bonito', 'salmon', 'bacalao', 'merluza', 'lubina', 'dorada', 'caballa', 'sardina',
  'boqueron', 'anchoa', 'trucha', 'rape', 'rodaballo', 'lenguado', 'corvina', 'besugo', 'pescadilla',
  'emperador', 'pez espada', 'surimi', 'gamba', 'langostino', 'mejillon', 'almeja', 'pulpo', 'calamar',
  'sepia', 'chipiron', 'vieira',
  // eggs and plant proteins
  'huevo', 'clara', 'tofu', 'tempeh', 'seitan',
]

/**
 * Cured meats and yolks flavour or garnish a dish (jamón on peas or melon,
 * chorizo in beans, a yolk to glaze a pizza): they are not its main protein,
 * so they don't count towards the 80–300 g range.
 */
const GARNISH_PROTEIN_TERMS = [
  'jamon', 'panceta', 'chorizo', 'morcilla', 'sobrasada', 'salchichon', 'fuet', 'beicon', 'bacon', 'lacon',
  'yema',
]

/** Pasta, rice and dry pulses: the base of the dish. */
const STARCH_TERMS = [
  'arroz', 'pasta', 'espagueti', 'espaguetis', 'spaghetti', 'macarron', 'tallarin', 'fideo', 'fideua',
  'noodle', 'lasana', 'canelon', 'lenteja', 'garbanzo', 'alubia', 'judia', 'frijol', 'soja texturizada',
]

/** Names that contain a term but aren't the thing itself (stocks, sauces, flours…). */
const NOT_THE_THING = ['caldo', 'fondo', 'fumet', 'salsa', 'pastilla', 'concentrado', 'harina']
/** …and for the base: drinks, vinegars, fresh green beans, cooked/canned pulses (their weight is not dry weight). */
const NOT_A_DRY_BASE = [
  ...NOT_THE_THING, 'vinagre', 'leche de', 'papel de', 'bebida de', 'judia verde', 'judias verdes', 'cocid',
  'bote', 'en conserva',
]

function hasWord(name: string, term: string): boolean {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}(e?s)?($|[^a-z0-9])`).test(name)
}

export function isMainProtein(name: string): boolean {
  const n = normalizeText(name)
  if (NOT_THE_THING.some((x) => n.includes(x))) return false
  if (GARNISH_PROTEIN_TERMS.some((t) => hasWord(n, t))) return false
  return PROTEIN_TERMS.some((t) => hasWord(n, t))
}

export function isStarchBase(name: string): boolean {
  const n = normalizeText(name)
  if (NOT_A_DRY_BASE.some((x) => n.includes(x))) return false
  return STARCH_TERMS.some((t) => hasWord(n, t))
}

/** Typical weights when the catalogue has none (only what the catalogue lists by units). */
const FALLBACK_UNIT_WEIGHT_G: Array<[string, number]> = [['huevo', 55]]

/** Grams for an ingredient line, or null when its weight is unknown. */
export function lineGrams(ing: AuditIngredient): number | null {
  const q = Number(ing.quantity)
  if (!Number.isFinite(q)) return null
  switch (ing.unit) {
    case 'g':
      return q
    case 'ml':
      return q * (ing.density ?? 1)
    case 'u': {
      if (ing.unitWeight != null && ing.unitWeight > 0) return q * ing.unitWeight
      const n = normalizeText(ing.name)
      const fallback = FALLBACK_UNIT_WEIGHT_G.find(([term]) => hasWord(n, term))
      return fallback ? q * fallback[1] : null
    }
    default:
      return null // cda, cdita, pizca, al gusto: never a main protein or a base
  }
}

function perServing(ings: readonly AuditIngredient[], servings: number): number | null {
  if (ings.length === 0) return null
  let total = 0
  for (const i of ings) {
    const g = lineGrams(i)
    if (g == null) return null
    total += g
  }
  return Math.round(total / Math.max(1, servings))
}

/** Pure: the issues of one catalogue recipe (empty = fine). */
export function auditCatalogRecipe(recipe: AuditableRecipe): CatalogAuditResult {
  const issues: CatalogAuditIssue[] = []
  if (recipe.stepCount <= 0) issues.push('sin_pasos')
  if (recipe.ingredients.length <= 2) issues.push('pocos_ingredientes')

  const servings = recipe.servings > 0 ? recipe.servings : 1
  const proteinPerServingG = perServing(recipe.ingredients.filter((i) => isMainProtein(i.name)), servings)
  const starchPerServingG = perServing(recipe.ingredients.filter((i) => isStarchBase(i.name)), servings)
  if (proteinPerServingG != null && (proteinPerServingG < MAIN_PROTEIN_RANGE_G.min || proteinPerServingG > MAIN_PROTEIN_RANGE_G.max)) {
    issues.push('proteina_fuera_de_rango')
  }
  if (starchPerServingG != null && (starchPerServingG < STARCH_RANGE_G.min || starchPerServingG > STARCH_RANGE_G.max)) {
    issues.push('base_fuera_de_rango')
  }
  return { issues, proteinPerServingG, starchPerServingG }
}

/**
 * What the menu matcher sees (`RecipeWithIngredients.catalogAuditIssues`):
 * the audit's issues for a system recipe, nothing for a user's own recipe.
 */
export function catalogAuditIssuesFor(authorId: string | null | undefined, recipe: AuditableRecipe): CatalogAuditIssue[] {
  return authorId == null ? auditCatalogRecipe(recipe).issues : []
}

export const AUDIT_ISSUE_LABEL: Record<CatalogAuditIssue, string> = {
  sin_pasos: 'sin pasos',
  pocos_ingredientes: '2 ingredientes o menos',
  proteina_fuera_de_rango: `proteína principal por ración fuera de ${MAIN_PROTEIN_RANGE_G.min}–${MAIN_PROTEIN_RANGE_G.max} g`,
  base_fuera_de_rango: `pasta, arroz o legumbre por ración fuera de ${STARCH_RANGE_G.min}–${STARCH_RANGE_G.max} g`,
}
