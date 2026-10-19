/**
 * PRO-196 — cured meats and gluten.
 *
 * Whether a chorizo, a morcilla, a sausage, a pâté or a jamón de york has
 * gluten depends on the brand (most Spanish chorizos say «sin gluten»).
 * Tagging them all `gluten` (Cocina, 2026-10-17, by prudence) left coeliac
 * households without lentejas con chorizo, fabada or cocido. Miguel
 * (2026-10-18, answer B): the catalogue drops that tag (migration
 * `0072_embutidos_sin_gluten.sql`; the cocido leftovers keep it) and, in a
 * household with coeliac disease, the shopping list asks for «<embutido> sin
 * gluten» and the recipe says «Elige embutido sin gluten».
 *
 * Spec: specs/shopping.md, specs/recipes.md.
 */
import type { ShoppingItem } from '@ona/shared'
import { compileRestrictions, nameHasTerm, normalizeText } from './dietaryRestrictions.js'

/** Appended to a cured meat's name on a coeliac household's shopping list. */
export const GLUTEN_FREE_SUFFIX = 'sin gluten'

/** Shown on the recipe (web ficha and Mimo) to a coeliac household. Legal reviews it (PRO-196). */
export const CHOOSE_GLUTEN_FREE_CHARCUTERIE = 'Elige embutido sin gluten'

/** Cured meats whose gluten depends on the brand. Whole words, plural-tolerant. */
const BRAND_DEPENDENT_TERMS = [
  'chorizo', 'chistorra', 'morcilla', 'butifarra', 'salchicha', 'salchichon', 'fuet', 'longaniza', 'sobrasada',
  'mortadela', 'salami', 'foie', 'foie gras', 'pate', 'jamon de york', 'jamon cocido', 'fiambre', 'embutido',
]

/** Compounds that keep their own tag (the cocido leftovers, PRO-198) or aren't a cured meat to buy. */
const NOT_CHARCUTERIE = ['^sobras', 'caldo']

/** True for a cured meat whose gluten depends on the brand («chorizo oreado», «jamón de york»). */
export function isBrandDependentGlutenCharcuterie(name: string): boolean {
  const n = normalizeText(name)
  if (!n || n.includes('sin gluten')) return false
  if (NOT_CHARCUTERIE.some((t) => nameHasTerm(n, t))) return false
  return BRAND_DEPENDENT_TERMS.some((t) => nameHasTerm(n, t))
}

/** True when the user's restrictions (profile + memory, already merged) include gluten. */
export function isCoeliacHousehold(restrictions: readonly string[]): boolean {
  return compileRestrictions(restrictions).allergens.has('gluten')
}

/**
 * Coeliac household: menu items that are a brand-dependent cured meat ask for
 * the gluten-free version («Chorizo oreado» → «Chorizo oreado sin gluten»).
 * Staples and manual items are the user's own words and stay as they are.
 */
export function withGlutenFreeCharcuterieNames(items: ShoppingItem[], coeliac: boolean): ShoppingItem[] {
  if (!coeliac) return items
  return items.map((it) =>
    (it.kind ?? 'menu') === 'menu' && isBrandDependentGlutenCharcuterie(it.name)
      ? { ...it, name: `${it.name} ${GLUTEN_FREE_SUFFIX}` }
      : it,
  )
}

/** The notices a recipe shows to this household (empty when none apply). */
export function recipeDietNotices(ingredientNames: readonly string[], coeliac: boolean): string[] {
  if (!coeliac) return []
  return ingredientNames.some(isBrandDependentGlutenCharcuterie) ? [CHOOSE_GLUTEN_FREE_CHARCUTERIE] : []
}
