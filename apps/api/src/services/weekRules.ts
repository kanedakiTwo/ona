/**
 * PRO-254 (D-087, tarea 2 del «Menú inteligente») — las reglas de una semana
 * bien hecha, como comprobaciones. Incluye PRO-238 (platos repetidos).
 *
 * Una función pura, `scoreWeek(days, recipes, opts)`, que puntúa una semana
 * con cada regla y dice qué huecos la incumplen. La usará el planificador a
 * la sombra (PRO-255) y la comparación a ciegas (PRO-256); hoy no cambia
 * ningún menú.
 *
 * Las reglas (COC-14, propuesta 2026-10-19-producto-menu-inteligente):
 *   1. `legumbre`            legumbre de cuchara al menos 2 veces;
 *   2. `pescado`             pescado o marisco 2 o 3 veces;
 *   3. `proteina_mismo_dia`  nunca la misma proteína principal a mediodía y
 *                            en la cena del mismo día;
 *   4. `plato_repetido`      el mismo plato no se repite en la semana, salvo
 *                            como sobras o táper (PRO-238);
 *   5. `aprovechar`          al menos un ingrediente fresco aprovechado en
 *                            dos platos distintos;
 *   6. `cenas_ligeras`       si el hogar lo ha pedido, cenas ligeras;
 *   7. `temporada`           todo de temporada.
 * Las definiciones en palabras («qué cuenta como legumbre de cuchara», «qué
 * es ligera») son las de abajo hasta que Cocina las fije en
 * `departments/cocina/reglas-semana.md` (COC-14); los umbrales están en
 * `WEEK_RULES_CONFIG` para cambiarlos sin tocar la lógica.
 */
import type { DayMenu, Meal, Season } from '@ona/shared'
import { isInSeason } from '@ona/shared'
import { normalizeText } from './dietaryRestrictions.js'

export const WEEK_RULE_IDS = [
  'legumbre',
  'pescado',
  'proteina_mismo_dia',
  'plato_repetido',
  'aprovechar',
  'cenas_ligeras',
  'temporada',
] as const
export type WeekRuleId = (typeof WEEK_RULE_IDS)[number]

export const WEEK_RULES_CONFIG = {
  /** Legumbre de cuchara: al menos N veces por semana. */
  minLegumes: 2,
  /** Pescado o marisco: entre min y max veces. */
  minFish: 2,
  maxFish: 3,
  /** A partir de cuántos huecos de comida/cena se exigen legumbre y pescado. */
  minSlotsForCounts: 6,
  /** Una cena con más kcal por ración que esto no es ligera. */
  lightDinnerMaxKcal: 600,
  /** Ingredientes compartidos que se buscan (más da la nota completa). */
  sharedIngredientsTarget: 2,
} as const

export const WEEK_RULE_LABEL: Record<WeekRuleId, string> = {
  legumbre: 'Legumbre de cuchara al menos 2 veces',
  pescado: 'Pescado 2 o 3 veces',
  proteina_mismo_dia: 'Sin la misma proteína a mediodía y en la cena',
  plato_repetido: 'Sin platos repetidos (salvo sobras o táper)',
  aprovechar: 'Un ingrediente aprovechado en dos platos',
  cenas_ligeras: 'Cenas ligeras',
  temporada: 'De temporada',
}

/** What the rules need to know about a recipe (a `loadMatchableRecipes` row fits). */
export interface WeekRecipe {
  id: string
  name: string
  seasons?: string[]
  seasonFit?: Partial<Record<Season, unknown>> | null
  tags?: string[] | null
  /** `tipo:<slug>` and `proteina:<slug>` from the catalogue rewriter. */
  internalTags?: string[] | null
  ingredients: Array<{ ingredientName: string }>
  nutritionPerServing?: { kcal?: number | null } | null
}

export interface WeekRuleSlotRef {
  dayIndex: number
  meal: string
  recipeId?: string
}

export interface WeekRuleResult {
  id: WeekRuleId
  /** False when the rule doesn't apply this week (too few meals, not asked, no fish allowed). */
  applies: boolean
  ok: boolean
  /** 0 (fails completely) … 1 (passes). */
  score: number
  /** Short Spanish detail for logs and the report («1 de 2», «martes: pollo y pollo»). */
  detail: string
  /** The slots that break it. */
  slots: WeekRuleSlotRef[]
}

export interface WeekScore {
  /** Mean of the rules that apply, 0…1. */
  score: number
  /** Every rule that applies passes. */
  ok: boolean
  rules: WeekRuleResult[]
}

export interface ScoreWeekOptions {
  season: Season
  /** The household asked for light dinners (ficha / memory, see `asksLightDinners`). */
  lightDinners?: boolean
  /** False for a household that can't eat fish (vegetarian, allergy): the fish rule doesn't apply. */
  fishAllowed?: boolean
  /** False for a household that can't eat pulses: the legume rule doesn't apply. */
  legumesAllowed?: boolean
}

// ─── Classification (pure) ──────────────────────────────────────

const hasWord = (name: string, term: string) => {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^a-z0-9])${escaped}(e?s)?($|[^a-z0-9])`).test(name)
}
/** Names that contain a term but aren't the thing itself. */
const NOT_THE_THING = ['caldo', 'fondo', 'fumet', 'salsa', 'pastilla', 'concentrado', 'harina', 'vinagre', 'bebida de', 'leche de']

const LEGUME_TERMS = ['lenteja', 'garbanzo', 'alubia', 'judion', 'faba', 'frijol', 'azuki', 'soja texturizada', 'guisante seco', 'habas secas']
const NOT_A_LEGUME = ['judia verde', 'judias verdes', 'brote']
const FISH_TERMS = [
  'pescado', 'atun', 'bonito', 'salmon', 'bacalao', 'merluza', 'lubina', 'dorada', 'caballa', 'sardina',
  'boqueron', 'trucha', 'rape', 'rodaballo', 'lenguado', 'corvina', 'besugo', 'pescadilla', 'emperador',
  'pez espada', 'gamba', 'langostino', 'mejillon', 'almeja', 'pulpo', 'calamar', 'sepia', 'chipiron',
  'vieira', 'jurel', 'mero', 'abadejo', 'cazon', 'raya', 'perca', 'marisco', 'berberecho', 'navaja',
]
/** Main-protein families, in the order they are looked for in the ingredients. */
const PROTEIN_FAMILIES: Array<[string, string[]]> = [
  ['pescado', FISH_TERMS],
  ['pollo', ['pollo', 'pavo', 'pechuga', 'muslo', 'contramuslo', 'alitas', 'gallina']],
  ['ternera', ['ternera', 'vaca', 'buey', 'entrecot', 'chuleton', 'morcillo', 'rabo de toro', 'carrillera de ternera']],
  ['cerdo', ['cerdo', 'secreto', 'presa', 'pluma', 'lomo', 'solomillo de cerdo', 'costilla', 'panceta', 'cochinita', 'salchicha']],
  ['cordero', ['cordero', 'cabrito']],
  ['conejo', ['conejo']],
  ['huevo', ['huevo']],
  ['legumbre', LEGUME_TERMS],
  ['tofu', ['tofu', 'tempeh', 'seitan']],
]
/** `proteina:<slug>` of the catalogue → family. */
const PROTEIN_TAG_FAMILY: Record<string, string> = {
  pollo: 'pollo', pavo: 'pollo', ternera: 'ternera', vaca: 'ternera', cerdo: 'cerdo', cordero: 'cordero',
  'pescado-blanco': 'pescado', 'pescado-azul': 'pescado', pescado: 'pescado', marisco: 'pescado',
  huevo: 'huevo', legumbre: 'legumbre', tofu: 'tofu', queso: 'queso', ninguna: 'ninguna',
}
const HEAVY_DISH_TYPES = ['guiso', 'legumbre', 'arroz', 'pasta', 'frito', 'asado', 'estofado', 'cocido', 'fritura', 'lasana', 'pizza', 'potaje', 'fabada']
const LIGHT_DISH_TYPES = ['crema', 'sopa', 'ensalada', 'verdura', 'tortilla', 'revuelto', 'plancha', 'vapor', 'salteado', 'pure']
/** Pantry basics: sharing them is not «aprovechar un ingrediente». */
const STAPLES = [
  'aceite', 'sal', 'pimienta', 'ajo', 'cebolla', 'agua', 'azucar', 'harina', 'vinagre', 'perejil', 'laurel',
  'pimenton', 'comino', 'oregano', 'tomillo', 'romero', 'caldo', 'mantequilla', 'leche', 'huevo', 'limon',
  'pan rallado', 'especias', 'nuez moscada', 'canela', 'curry', 'mostaza', 'tomate frito', 'vino', 'cebolleta',
]

const tagValue = (r: WeekRecipe, prefix: string) => (r.internalTags ?? []).find((t) => t.startsWith(prefix))?.slice(prefix.length) ?? null
const ingNames = (r: WeekRecipe) => r.ingredients.map((i) => normalizeText(i.ingredientName))
const isLegumeName = (n: string) => !NOT_THE_THING.some((x) => n.includes(x)) && !NOT_A_LEGUME.some((x) => n.includes(x)) && LEGUME_TERMS.some((t) => hasWord(n, t))
const isFishName = (n: string) => !NOT_THE_THING.some((x) => n.includes(x)) && FISH_TERMS.some((t) => hasWord(n, t))

/** Pure: the recipe's dish type (`tipo:` tag, else its public tags). */
export function dishTypeOf(r: WeekRecipe): string | null {
  const t = tagValue(r, 'tipo:')
  if (t) return t
  const tags = (r.tags ?? []).map(normalizeText)
  return [...HEAVY_DISH_TYPES, ...LIGHT_DISH_TYPES].find((d) => tags.some((x) => x === d || x === `${d}s`)) ?? null
}

/** Pure: the main protein family (`proteina:` tag, else the first family found in the ingredients, else in the name). */
export function mainProteinOf(r: WeekRecipe): string | null {
  const tag = tagValue(r, 'proteina:')
  if (tag) return PROTEIN_TAG_FAMILY[tag] ?? tag
  const names = ingNames(r).filter((n) => !NOT_THE_THING.some((x) => n.includes(x)))
  for (const [family, terms] of PROTEIN_FAMILIES) {
    if (names.some((n) => terms.some((t) => hasWord(n, t)) && (family !== 'legumbre' || isLegumeName(n)))) return family
  }
  const name = normalizeText(r.name)
  for (const [family, terms] of PROTEIN_FAMILIES) if (terms.some((t) => hasWord(name, t))) return family
  return null
}

/** Pure: a spoon legume dish (lentejas, garbanzos, alubias… as the base, not a garnish of green beans). */
export function isSpoonLegume(r: WeekRecipe): boolean {
  if (tagValue(r, 'tipo:') === 'legumbre' || tagValue(r, 'proteina:') === 'legumbre') return true
  return ingNames(r).some(isLegumeName) || LEGUME_TERMS.some((t) => hasWord(normalizeText(r.name), t))
}

/** Pure: fish or seafood is the main of the dish. */
export function isFishDish(r: WeekRecipe): boolean {
  const tag = tagValue(r, 'proteina:')
  if (tag) return PROTEIN_TAG_FAMILY[tag] === 'pescado'
  return mainProteinOf(r) === 'pescado' || ingNames(r).some(isFishName)
}

/**
 * Pure: a light dinner. Heavy = a heavy dish type (guiso, arroz, pasta,
 * frito, asado, legumbre…), red meat or pulses as the main, or more than
 * `lightDinnerMaxKcal` per serving. Everything else is light (cremas,
 * verdura, pescado, huevo, ensaladas).
 */
export function isLightDish(r: WeekRecipe): boolean {
  const type = dishTypeOf(r)
  if (type && HEAVY_DISH_TYPES.includes(type)) return false
  const protein = mainProteinOf(r)
  if (protein && ['ternera', 'cerdo', 'cordero', 'legumbre'].includes(protein)) return false
  const kcal = r.nutritionPerServing?.kcal
  if (typeof kcal === 'number' && kcal > WEEK_RULES_CONFIG.lightDinnerMaxKcal) return false
  const name = normalizeText(r.name)
  if (/\b(arroz|paella|pasta|espaguetis?|macarrones|lasana|guiso|estofado|cocido|potaje|fabada|frito|rebozad[oa]s?|empanad[oa]s?)\b/.test(name)) return false
  return true
}

/** Pure: did the household ask for light dinners? (memory notes, ficha facts, «Cuéntanos tu caso»). */
export function asksLightDinners(texts: readonly string[]): boolean {
  return texts.some((t) => /\bcenas? (?:mas |muy )?(?:ligeras?|suaves?|livianas?)\b|\bcenar (?:ligero|poco|suave)\b|\bpor la noche (?:algo )?ligero\b/.test(normalizeText(t)))
}

const isStaple = (n: string) => STAPLES.some((s) => n === s || hasWord(n, s) && n.split(' ').length <= s.split(' ').length + 1)
const dishKey = (name: string) => normalizeText(name).replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

// ─── The week ───────────────────────────────────────────────────

interface PlannedDish {
  dayIndex: number
  meal: string
  recipe: WeekRecipe
  /** `leftover` / `freezer`: eaten again on purpose, not a repeat. */
  reuse: boolean
}

const MAIN_MEALS: readonly string[] = ['lunch', 'dinner'] satisfies Meal[]

function plannedDishes(days: readonly DayMenu[], recipes: ReadonlyMap<string, WeekRecipe>): PlannedDish[] {
  const out: PlannedDish[] = []
  days.forEach((day, dayIndex) => {
    for (const meal of Object.keys(day ?? {})) {
      for (const dish of day[meal]?.dishes ?? []) {
        if (dish.kind !== 'recipe') continue
        const recipe = recipes.get(dish.recipeId)
        if (!recipe) continue
        out.push({ dayIndex, meal, recipe, reuse: dish.variant === 'leftover' || dish.variant === 'freezer' })
      }
    }
  })
  return out
}

const DAY = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const ref = (d: PlannedDish): WeekRuleSlotRef => ({ dayIndex: d.dayIndex, meal: d.meal, recipeId: d.recipe.id })
const result = (id: WeekRuleId, applies: boolean, score: number, detail: string, slots: WeekRuleSlotRef[] = []): WeekRuleResult => ({
  id, applies, ok: !applies || score >= 1, score: applies ? Math.max(0, Math.min(1, score)) : 1, detail, slots,
})

/** Pure: score a week with every rule. */
export function scoreWeek(days: readonly DayMenu[], recipes: ReadonlyMap<string, WeekRecipe>, opts: ScoreWeekOptions): WeekScore {
  const cfg = WEEK_RULES_CONFIG
  const all = plannedDishes(days, recipes)
  const mains = all.filter((d) => MAIN_MEALS.includes(d.meal))
  const fresh = mains.filter((d) => !d.reuse)
  const mainSlots = new Set(mains.map((d) => `${d.dayIndex}|${d.meal}`)).size
  const enough = mainSlots >= cfg.minSlotsForCounts
  const rules: WeekRuleResult[] = []

  // 1. Legumbre de cuchara (sobras incluidas: se come otra vez).
  const legumes = mains.filter((d) => isSpoonLegume(d.recipe))
  const legumeDays = new Set(legumes.map((d) => `${d.dayIndex}|${d.meal}`)).size
  rules.push(result('legumbre', enough && opts.legumesAllowed !== false, legumeDays / cfg.minLegumes, `${legumeDays} de ${cfg.minLegumes}`))

  // 2. Pescado 2–3.
  const fish = new Set(mains.filter((d) => isFishDish(d.recipe)).map((d) => `${d.dayIndex}|${d.meal}`)).size
  const fishScore = fish < cfg.minFish ? fish / cfg.minFish : fish > cfg.maxFish ? Math.max(0, 1 - (fish - cfg.maxFish) / cfg.maxFish) : 1
  rules.push(result('pescado', enough && opts.fishAllowed !== false, fishScore, `${fish} (entre ${cfg.minFish} y ${cfg.maxFish})`))

  // 3. Misma proteína principal a mediodía y en la cena.
  const sameDay: PlannedDish[] = []
  const sameDayText: string[] = []
  let daysWithBoth = 0
  for (let d = 0; d < days.length; d++) {
    const lunch = mains.filter((x) => x.dayIndex === d && x.meal === 'lunch')
    const dinner = mains.filter((x) => x.dayIndex === d && x.meal === 'dinner')
    if (!lunch.length || !dinner.length) continue
    daysWithBoth++
    const lp = new Set(lunch.map((x) => mainProteinOf(x.recipe)).filter((p): p is string => !!p && p !== 'ninguna'))
    const clash = dinner.filter((x) => { const p = mainProteinOf(x.recipe); return !!p && lp.has(p) })
    if (clash.length) {
      sameDay.push(...lunch.filter((x) => clash.some((c) => mainProteinOf(c.recipe) === mainProteinOf(x.recipe))), ...clash)
      sameDayText.push(`${DAY[d] ?? d}: ${mainProteinOf(clash[0].recipe)}`)
    }
  }
  rules.push(result('proteina_mismo_dia', daysWithBoth > 0, 1 - sameDayText.length / Math.max(1, daysWithBoth), sameDayText.join('; ') || 'ninguno', sameDay.map(ref)))

  // 4. Platos repetidos (PRO-238): misma receta o mismo nombre, salvo sobras o táper.
  const seen = new Map<string, PlannedDish>()
  const repeats: PlannedDish[] = []
  for (const d of all.filter((x) => !x.reuse)) {
    for (const key of [`id:${d.recipe.id}`, `n:${dishKey(d.recipe.name)}`]) {
      if (seen.has(key)) { repeats.push(d); break }
    }
    seen.set(`id:${d.recipe.id}`, d)
    seen.set(`n:${dishKey(d.recipe.name)}`, d)
  }
  rules.push(result('plato_repetido', all.length > 0, repeats.length ? 0 : 1, repeats.map((d) => `${d.recipe.name} (${DAY[d.dayIndex]})`).join('; ') || 'ninguno', repeats.map(ref)))

  // 5. Aprovechar un ingrediente fresco en dos platos distintos.
  const byIngredient = new Map<string, Set<string>>()
  for (const d of fresh) {
    for (const n of new Set(ingNames(d.recipe))) {
      if (!n || isStaple(n)) continue
      const set = byIngredient.get(n) ?? new Set<string>()
      set.add(d.recipe.id)
      byIngredient.set(n, set)
    }
  }
  const shared = [...byIngredient].filter(([, ids]) => ids.size >= 2).map(([n]) => n)
  rules.push(result('aprovechar', new Set(fresh.map((d) => d.recipe.id)).size >= 2, shared.length / cfg.sharedIngredientsTarget, shared.slice(0, 5).join(', ') || 'ninguno'))

  // 6. Cenas ligeras, si el hogar lo pidió.
  const dinners = mains.filter((d) => d.meal === 'dinner')
  const heavy = dinners.filter((d) => !isLightDish(d.recipe))
  rules.push(result('cenas_ligeras', !!opts.lightDinners && dinners.length > 0, dinners.length ? 1 - heavy.length / dinners.length : 1, heavy.map((d) => `${d.recipe.name} (${DAY[d.dayIndex]})`).join('; ') || 'todas ligeras', heavy.map(ref)))

  // 7. Temporada.
  const outOfSeason = all.filter((d) => {
    const fit = d.recipe.seasonFit
    if (fit && Object.keys(fit).length) return !fit[opts.season]
    return !isInSeason((d.recipe.seasons ?? []) as Season[], opts.season)
  })
  rules.push(result('temporada', all.length > 0, all.length ? 1 - outOfSeason.length / all.length : 1, outOfSeason.map((d) => d.recipe.name).join('; ') || 'todo de temporada', outOfSeason.map(ref)))

  const applying = rules.filter((r) => r.applies)
  return {
    score: applying.length ? applying.reduce((s, r) => s + r.score, 0) / applying.length : 1,
    ok: applying.every((r) => r.ok),
    rules,
  }
}
