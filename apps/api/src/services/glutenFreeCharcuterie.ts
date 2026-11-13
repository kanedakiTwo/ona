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
 * gluten» and the recipe says «Elige embutido sin gluten». PRO-1063 does the
 * same for blended spices and stocks («Elige chili en polvo sin gluten»).
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

// PRO-1063 (Dani y Sara, 2026-10-27): blended spices and stocks are the same
// case. Chili en polvo, curry, ras el hanout and a stock in a cube or a brick
// may carry gluten depending on the brand; Mimo said so in the chat but the
// recipe and the list didn't. Cocina adds the blends that are missing here.
/** Blended spices whose gluten depends on the brand. Whole words, plural-tolerant. */
const BRAND_DEPENDENT_BLENDS = ['chili en polvo', 'chile en polvo', 'curry', 'ras el hanout']

/** Stocks (cube, brick or powder) whose gluten depends on the brand. */
const BRAND_DEPENDENT_STOCKS = ['caldo', 'cubito', 'pastilla de caldo', 'fumet']

/** Bones for making the stock at home aren't a stock to buy. */
const NOT_STOCK = ['hueso', 'huesos']

/** True for a blended spice or a stock whose gluten depends on the brand («chili en polvo», «caldo de verduras»). */
export function isBrandDependentGlutenBlendOrStock(name: string): boolean {
  const n = normalizeText(name)
  if (!n || n.includes('sin gluten')) return false
  if (BRAND_DEPENDENT_BLENDS.some((t) => nameHasTerm(n, t))) return true
  if (NOT_STOCK.some((t) => nameHasTerm(n, t))) return false
  return BRAND_DEPENDENT_STOCKS.some((t) => nameHasTerm(n, t))
}

/** True for anything a coeliac household must buy with the «sin gluten» label: a cured meat, a blend or a stock. */
export function needsGlutenFreeLabel(name: string): boolean {
  return isBrandDependentGlutenCharcuterie(name) || isBrandDependentGlutenBlendOrStock(name)
}

/** The recipe notice for one blend or stock line: «Elige chili en polvo sin gluten». */
export function chooseGlutenFree(name: string): string {
  return `Elige ${name.trim().toLocaleLowerCase('es')} ${GLUTEN_FREE_SUFFIX}`
}

/** True when the user's restrictions (profile + memory, already merged) include gluten. */
export function isCoeliacHousehold(restrictions: readonly string[]): boolean {
  return compileRestrictions(restrictions).allergens.has('gluten')
}

/**
 * Coeliac household: menu items that are a brand-dependent cured meat, blend
 * or stock ask for the gluten-free version («Chorizo oreado» → «Chorizo
 * oreado sin gluten», «Caldo de verduras» → «Caldo de verduras sin gluten»).
 * Staples and manual items are the user's own words and stay as they are.
 */
export function withGlutenFreeCharcuterieNames(items: ShoppingItem[], coeliac: boolean): ShoppingItem[] {
  if (!coeliac) return items
  return items.map((it) =>
    (it.kind ?? 'menu') === 'menu' && needsGlutenFreeLabel(it.name)
      ? { ...it, name: `${it.name} ${GLUTEN_FREE_SUFFIX}` }
      : it,
  )
}

/**
 * The notices a recipe shows to this household (empty when none apply):
 * «Elige embutido sin gluten» once, then one «Elige <blend or stock> sin
 * gluten» per line, in the recipe's order and without repeats.
 */
export function recipeDietNotices(ingredientNames: readonly string[], coeliac: boolean): string[] {
  if (!coeliac) return []
  const notices = ingredientNames.some(isBrandDependentGlutenCharcuterie) ? [CHOOSE_GLUTEN_FREE_CHARCUTERIE] : []
  for (const name of ingredientNames) {
    if (isBrandDependentGlutenCharcuterie(name) || !isBrandDependentGlutenBlendOrStock(name)) continue
    const notice = chooseGlutenFree(name)
    if (!notices.includes(notice)) notices.push(notice)
  }
  return notices
}
