/**
 * Mimo's recipe search with several conditions at once (2026-11-19):
 * «calabacín rápida menos de 30 minutos», «cena ligera sin arroz sin
 * garbanzos». Before, `suggest_recipes` looked for the whole sentence inside
 * a recipe's name or a tag, so 10 of 17 searches in three weeks said «No he
 * encontrado recetas con esos criterios».
 *
 * Pure: `parseRecipeCriteria` reads the sentence (time, «sin X», light,
 * meal, course and the words left); `matchesCriteria` checks a recipe: every
 * word left must be in its name, tags, dish types or ingredients, and no
 * excluded food (a category counts whole: «sin legumbres»).
 *
 * Spec: specs/advisor.md (suggest_recipes / search_recipes).
 */
import type { Course, Meal } from '@ona/shared'
import { compileRestrictions, nameHasTerm, normalizeText, violatesRestrictions, type CompiledRestrictions, type RestrictableRecipe } from './dietaryRestrictions.js'
import { isLightDish, isSweetDish } from './menuRules.js'

export interface RecipeCriteria {
  /** Words every result must have (name, tags, dish types or ingredients). */
  words: string[]
  /** Total minutes at most (total time, else prep + cook). */
  maxMinutes: number | null
  /** Foods, categories, diets or allergens to leave out («arroz», «legumbres», «gluten», «vegetariano»). */
  exclude: string[]
  light: boolean
  meal: Meal | null
  course: Course | null
}

const STOP = new Set([
  'de', 'del', 'la', 'el', 'los', 'las', 'un', 'una', 'unos', 'unas', 'con', 'para', 'y', 'o', 'que', 'a', 'al', 'en',
  'receta', 'recetas', 'plato', 'platos', 'algo', 'alguna', 'algun', 'alguno', 'rico', 'rica', 'ricos', 'ricas', 'hoy',
  'manana', 'noche', 'mediodia', 'menos', 'minutos', 'minuto', 'min', 'mins', 'quiero', 'me', 'apetece', 'busco', 'busca',
  'ideas', 'idea', 'tipo', 'estilo', 'por', 'favor', 'hacer', 'cocinar', 'facil', 'faciles', 'sencillo', 'sencilla',
  'casero', 'casera', 'sano', 'sana', 'saludable', 'saludables', 'bueno', 'buena', 'nuevo', 'nueva', 'otra', 'otro',
  'mas', 'muy', 'poco', 'poca', 'tiempo', 'hora', 'horas', 'media', 'maximo', 'max', 'como', 'mucho', 'hasta', 'tarde',
  'semana', 'dia', 'cosa', 'cosas', 'opciones', 'opcion', 'sugerencias', 'sugiere', 'dame', 'tienes', 'hay',
])
const QUICK = /\b(rapid[oa]s?|express|expres|en un momento|en nada)\b/
const LIGHT = /\b(liger[oa]s?|suaves?|light)\b/
const MEALS: Array<[RegExp, Meal]> = [
  [/\b(cenas?|cenar)\b/, 'dinner'],
  [/\b(comidas?|almuerzos?|almorzar|comer)\b/, 'lunch'],
  [/\b(desayunos?|desayunar)\b/, 'breakfast'],
  [/\b(meriendas?|merendar)\b/, 'snack'],
]
const DIET_WORDS: Record<string, string> = {
  vegetariano: 'vegetariano', vegetariana: 'vegetariano', vegetarianos: 'vegetariano', vegetarianas: 'vegetariano',
  vegano: 'vegano', vegana: 'vegano', veganos: 'vegano', veganas: 'vegano',
}
/** Words that end a «sin …» run. */
const RUN_END = new Set(['sin', 'ni', 'con', 'y', 'para', 'que', 'en', 'de', 'menos', 'rapida', 'rapido', 'rapidas', 'rapidos', 'ligera', 'ligero', 'ligeras', 'ligeros', 'cena', 'cenas', 'comida', 'comidas', 'o'])

/** Pure: the conditions in a free-text search. */
export function parseRecipeCriteria(text: string | null | undefined): RecipeCriteria {
  const out: RecipeCriteria = { words: [], maxMinutes: null, exclude: [], light: false, meal: null, course: null }
  let t = normalizeText(text ?? '').replace(/[¿?¡!.,;:()"«»]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!t) return out
  // Time: «menos de 30 minutos», «<30 min», «en 20'», «media hora», «una hora».
  const minutes = t.match(/(?:menos de|en menos de|maximo|max|como mucho|hasta|<|en|de)?\s*(\d{1,3})\s*(?:min\b|mins\b|minutos\b|')/)
  if (minutes) {
    out.maxMinutes = Number(minutes[1])
    t = t.replace(minutes[0], ' ')
  } else if (/\bmedia hora\b/.test(t)) out.maxMinutes = 30
  else if (/\b(una|1) hora\b/.test(t)) out.maxMinutes = 60
  if (out.maxMinutes == null && QUICK.test(t)) out.maxMinutes = 30
  t = t.replace(QUICK, ' ')
  if (LIGHT.test(t)) out.light = true
  t = t.replace(LIGHT, ' ')
  for (const [re, meal] of MEALS) {
    if (re.test(t)) {
      out.meal ??= meal
      t = t.replace(re, ' ')
    }
  }
  if (/\bpostres?\b/.test(t)) { out.course = 'dessert'; t = t.replace(/\bpostres?\b/, ' ') }
  else if (/\b(entrantes?|primer plato|primeros)\b/.test(t)) { out.course = 'starter'; t = t.replace(/\b(entrantes?|primer plato|primeros)\b/, ' ') }
  // «sin arroz sin garbanzos», «sin legumbres ni arroz», «sin carne roja».
  const tokens = t.split(' ').filter(Boolean)
  const kept: string[] = []
  for (let i = 0; i < tokens.length; i++) {
    const w = tokens[i]
    if (w === 'sin' || (w === 'ni' && out.exclude.length)) {
      const run: string[] = []
      let j = i + 1
      while (j < tokens.length && !RUN_END.has(tokens[j]) && run.length < 3) run.push(tokens[j++])
      if (run.length) out.exclude.push(run.join(' '))
      i = j - 1
      continue
    }
    if (DIET_WORDS[w]) { if (!out.exclude.includes(DIET_WORDS[w])) out.exclude.push(DIET_WORDS[w]); continue }
    if (w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w)) kept.push(w)
  }
  out.words = [...new Set(kept)]
  return out
}

/** True when the search says more than a name (time, «sin», light, a meal or a course). */
export function hasConditions(c: RecipeCriteria): boolean {
  return c.maxMinutes != null || c.exclude.length > 0 || c.light || c.meal != null || c.course != null
}

export interface CriteriaRecipe extends RestrictableRecipe {
  name: string
  tags?: string[] | null
  dishTypes?: string[] | null
  meals?: string[] | null
  mealFit?: Partial<Record<string, unknown>> | null
  course?: Course | null
  totalTime?: number | null
  prepTime?: number | null
  cookTime?: number | null
  nutritionPerServing?: { kcal?: number | null } | null
}

function singular(w: string): string {
  return w.endsWith('es') && w.length > 5 ? w.slice(0, -2) : w.endsWith('s') && w.length > 4 ? w.slice(0, -1) : w
}

/** Pure: how many of the words the recipe has (name, tags, dish types, ingredients). */
export function wordsMatched(recipe: CriteriaRecipe, words: readonly string[]): number {
  const fields = [recipe.name, ...(recipe.tags ?? []), ...(recipe.dishTypes ?? []), ...recipe.ingredients.map((i) => i.ingredientName)].map(normalizeText)
  return words.filter((w) => {
    const s = singular(w)
    return fields.some((f) => nameHasTerm(f, w) || nameHasTerm(f, s))
  }).length
}

/** Pure: the excluded foods compiled once (`compileRestrictions`: categories, diets, allergens, free text). */
export function compileExclusions(exclude: readonly string[]): CompiledRestrictions {
  return compileRestrictions(exclude)
}

/** Pure: a recipe meets every condition but the words (time, exclusions, light, meal, course, no sweet for lunch/dinner). */
export function meetsConditions(recipe: CriteriaRecipe, c: RecipeCriteria, excluded: CompiledRestrictions): boolean {
  if (c.maxMinutes != null) {
    const total = recipe.totalTime && recipe.totalTime > 0 ? recipe.totalTime : (recipe.prepTime ?? 0) + (recipe.cookTime ?? 0)
    if (!total || total > c.maxMinutes) return false
  }
  if (c.exclude.length && violatesRestrictions(recipe, excluded)) return false
  if (c.light && !isLightDish(recipe)) return false
  if (c.meal) {
    const fit = recipe.mealFit?.[c.meal]
    if (recipe.mealFit ? !fit : !(recipe.meals ?? []).includes(c.meal)) return false
  }
  if (c.course === 'dessert') return recipe.course === 'dessert' || isSweetDish(recipe)
  if (c.course && recipe.course !== c.course) return false
  if ((c.meal === 'lunch' || c.meal === 'dinner') && isSweetDish(recipe)) return false
  return true
}

/**
 * Pure: the recipes that meet the conditions and have every word, best
 * first (more words in the name, then quicker). With none, `partial` holds
 * the ones that have the most words (at least one), so Mimo can say so.
 */
export function searchByCriteria<T extends CriteriaRecipe>(recipes: readonly T[], c: RecipeCriteria): { exact: T[]; partial: T[] } {
  const excluded = compileExclusions(c.exclude)
  const ok = recipes.filter((r) => meetsConditions(r, c, excluded))
  const scored = ok.map((r) => ({ r, n: wordsMatched(r, c.words), inName: wordsMatched({ ...r, tags: [], dishTypes: [], ingredients: [] }, c.words), t: r.totalTime ?? 999 }))
  const order = (a: typeof scored[number], b: typeof scored[number]) => b.inName - a.inName || a.t - b.t
  const exact = scored.filter((x) => x.n === c.words.length).sort(order).map((x) => x.r)
  if (exact.length || c.words.length === 0) return { exact, partial: [] }
  const best = Math.max(0, ...scored.map((x) => x.n))
  return { exact: [], partial: best > 0 ? scored.filter((x) => x.n === best).sort(order).map((x) => x.r) : [] }
}
