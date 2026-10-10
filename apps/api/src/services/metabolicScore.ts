import type { DayMenu, Season } from '@ona/shared'
import { nameHasTerm, normalizeText } from './dietaryRestrictions.js'

/**
 * Mimoia's "opinion" inside the menu generator (kb/10 mandamientos.md: insulin
 * and inflammation, not calories; real food with fibre; variety of plants).
 * The generator used to optimise calories + macros only. Pure and computed
 * once per recipe from ingredient names, so the 200-iteration search stays
 * in memory.
 */

/** High insulin response / refined: sugar, refined flours and grains, juices, sweet bakes. */
const REFINED = [
  'azucar', 'azucar moreno', 'miel', 'sirope', 'jarabe', 'edulcorante', 'zumo', 'refresco', 'harina de trigo',
  'harina blanca', 'harina', 'pan blanco', 'pan de molde', 'pan', 'baguette', 'pasta', 'espagueti', 'macarron',
  'tallarin', 'fideo', 'lasana', 'arroz blanco', 'galleta', 'bizcocho', 'cereales de desayuno', 'chocolate con leche',
  'mermelada', 'ketchup', 'maicena', 'pure de patata instantaneo', 'cuscus', 'semola',
]

/** Ultra-processed / pro-inflammatory fats and meats. */
const PROCESSED = [
  'embutido', 'salchicha', 'bacon', 'beicon', 'chorizo', 'salchichon', 'mortadela', 'nuggets', 'margarina',
  'aceite de girasol', 'aceite de soja', 'aceite de maiz', 'aceite vegetal', 'nata industrial', 'salsa industrial',
  'caldo en pastilla', 'pastilla de caldo',
]

/** Plants that count for weekly variety (and for the "real food" bonus). */
const PLANTS = [
  'acelga', 'aguacate', 'ajo', 'alcachofa', 'apio', 'berenjena', 'berro', 'boniato', 'brocoli', 'calabacin', 'calabaza',
  'canonigos', 'cebolla', 'cebolleta', 'champinon', 'seta', 'col', 'coliflor', 'repollo', 'lombarda', 'col rizada',
  'kale', 'endibia', 'escarola', 'esparrago', 'espinaca', 'guisante', 'haba', 'judia verde', 'lechuga', 'nabo',
  'pepino', 'pimiento', 'puerro', 'rabano', 'remolacha', 'rucula', 'tomate', 'zanahoria', 'hinojo', 'okra',
  'lenteja', 'garbanzo', 'alubia', 'judia blanca', 'frijol', 'soja verde', 'edamame', 'quinoa', 'avena', 'trigo sarraceno',
  'nuez', 'almendra', 'avellana', 'pistacho', 'anacardo', 'semilla', 'sesamo', 'chia', 'lino', 'pipa',
  'manzana', 'pera', 'naranja', 'mandarina', 'fresa', 'frambuesa', 'arandano', 'mora', 'kiwi', 'melocoton',
  'ciruela', 'uva', 'higo', 'granada', 'limon', 'lima', 'platano', 'melon', 'sandia', 'mango', 'pina', 'cereza',
  'albaricoque', 'nectarina', 'papaya', 'aceituna', 'alcaparra', 'cardo', 'pomelo', 'chirivia', 'nispero',
  'ajo tierno', 'castana', 'caqui', 'membrillo', 'maiz', 'perejil', 'cilantro', 'albahaca', 'menta', 'romero', 'tomillo',
  'oregano', 'jengibre', 'curcuma',
]

/** Anti-inflammatory staples beyond plants. */
const GOOD = [
  'aceite de oliva', 'aove', 'salmon', 'sardina', 'caballa', 'boqueron', 'anchoa', 'atun', 'trucha', 'arenque',
  'huevo', 'yogur natural', 'kefir', 'chucrut', 'kimchi', 'miso', 'ghee', 'mantequilla', 'caldo de huesos',
]

/**
 * Strongly seasonal produce on the Spanish calendar (kb principle 7: eat in
 * season). Year-round staples (cebolla, ajo, zanahoria, patata, legumbres…)
 * are left out on purpose. The catalogue's season tags are unreliable: in
 * prod 26 of 56 system recipes were tagged all four seasons. So the
 * generator also reads seasonality from the ingredients.
 */
export const SEASONAL: Record<Season, readonly string[]> = {
  winter: ['alcachofa', 'brocoli', 'coliflor', 'col', 'repollo', 'lombarda', 'col rizada', 'kale', 'puerro', 'cardo', 'escarola', 'endibia', 'naranja', 'mandarina', 'pomelo', 'calabaza', 'boniato', 'nabo', 'chirivia'],
  spring: ['esparrago', 'guisante', 'haba', 'alcachofa', 'fresa', 'nispero', 'cereza', 'ajo tierno', 'judia verde', 'lechuga', 'rabano'],
  summer: ['tomate', 'pepino', 'calabacin', 'berenjena', 'pimiento', 'judia verde', 'melon', 'sandia', 'melocoton', 'nectarina', 'albaricoque', 'ciruela', 'cereza', 'higo', 'maiz'],
  autumn: ['calabaza', 'boniato', 'seta', 'champinon', 'castana', 'granada', 'uva', 'caqui', 'manzana', 'pera', 'membrillo', 'puerro', 'coliflor', 'brocoli', 'col', 'pimiento'],
}

const hits = (name: string, terms: readonly string[]) => terms.filter((t) => nameHasTerm(name, t))

/** −0.3 … +0.3: seasonal produce in season helps, out of season hurts. */
export function seasonalAdjustment(plants: readonly string[], season: Season): number {
  const inSeason = new Set(SEASONAL[season])
  const anySeason = new Set(Object.values(SEASONAL).flat())
  let adj = 0
  for (const p of plants) {
    if (!anySeason.has(p)) continue
    adj += inSeason.has(p) ? 0.1 : -0.15
  }
  return Math.max(-0.3, Math.min(0.3, adj))
}

export interface MetabolicProfile {
  /** −1 (refined, processed) … +1 (plants, fibre, good fats). */
  score: number
  /** Distinct plants in the recipe (normalised term), for weekly variety. */
  plants: string[]
}

export function recipeMetabolicProfile(ingredientNames: readonly string[], season?: Season): MetabolicProfile {
  let refined = 0
  let processed = 0
  let good = 0
  const plants = new Set<string>()
  for (const raw of ingredientNames) {
    const name = normalizeText(raw)
    if (!name) continue
    // "harina de garbanzo", "pasta de sésamo/tomate", "arroz integral" aren't refined carbs.
    const exempt = /\b(integral|de garbanzo|de almendra|de sesamo|de tomate|de curry|de miso|de avena)\b/.test(name)
    if (!exempt && hits(name, REFINED).length > 0) refined += 1
    if (hits(name, PROCESSED).length > 0) processed += 1
    if (hits(name, GOOD).length > 0) good += 1
    for (const p of hits(name, PLANTS)) plants.add(p)
  }
  // Six different plants and two good-fat/fermented staples ≈ +0.96; each
  // refined carb −0.5, each processed item −0.35.
  const raw =
    0.12 * Math.min(plants.size, 6) + 0.12 * Math.min(good, 2) - 0.5 * refined - 0.35 * processed +
    (season ? seasonalAdjustment([...plants], season) : 0)
  return { score: Math.max(-1, Math.min(1, raw)), plants: [...plants] }
}

/** Weekly variety target: ~30 different plants a week is the usual microbiome goal; we ask for 20. */
export const PLANT_VARIETY_TARGET = 20

/**
 * Menu-level quality for the generator's fitness: `quality01` is the mean
 * recipe score mapped to 0..1; `variety01` is distinct plants / target.
 */
export function menuMetabolicQuality(
  days: readonly DayMenu[],
  profiles: ReadonlyMap<string, MetabolicProfile>,
): { quality01: number; variety01: number } {
  let sum = 0
  let n = 0
  const plants = new Set<string>()
  for (const day of days) {
    for (const slot of Object.values(day ?? {})) {
      for (const dish of ((slot as any)?.dishes ?? []) as Array<{ kind?: string; recipeId?: string }>) {
        if (dish.kind !== 'recipe' || !dish.recipeId) continue
        const p = profiles.get(dish.recipeId)
        if (!p) continue
        sum += p.score
        n += 1
        for (const pl of p.plants) plants.add(pl)
      }
    }
  }
  const mean = n > 0 ? sum / n : 0
  return { quality01: (mean + 1) / 2, variety01: Math.min(1, plants.size / PLANT_VARIETY_TARGET) }
}
