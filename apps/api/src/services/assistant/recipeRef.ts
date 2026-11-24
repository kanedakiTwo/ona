import { normalizeText } from '../dietaryRestrictions.js'

/**
 * PRO-1299 · which recipe a tool means. Mimo used to pass a name and the
 * tools took the first recipe with one of its words: a favourite marked
 * another recipe, the cooking mode opened another one and a cream the
 * household already had made went on the menu as a catalogue recipe (Mimo's
 * history, 2026-11-23). Now the tools take the `recipeId` Mimo has just read
 * (menu, get_recipe_details) or put; with only a name, they take the one
 * recipe it names, and when it names more than one they ask which.
 */

const NAME_FILLER = new Set(['con', 'sin', 'del', 'las', 'los', 'una', 'unos', 'unas', 'para', 'por', 'receta', 'plato'])

/**
 * True when every meaningful word the user said appears in a recipe name
 * (singular/plural tolerant): "hamburguesa gipsy chef" ⊂ "Hamburguesa
 * perfecta de Gipsy Chef", but "filete de vaca" ⊄ "Entrecot a la plancha".
 */
export function namesAllWords(recipeName: string, query: string): boolean {
  const name = normalizeText(recipeName).split(/\s+/)
  const words = normalizeText(query).split(/\s+/).filter((w) => w.length > 2 && !NAME_FILLER.has(w))
  const same = (a: string, b: string) => a === b || `${a}s` === b || `${b}s` === a || `${a}es` === b || `${b}es` === a
  return words.length > 0 && words.every((w) => name.some((t) => same(t, w)))
}

/** The words of a name worth searching by, singular ("lentejas" → "lenteja"), so an ILIKE finds both forms. */
export function nameSearchWords(name: string): string[] {
  return normalizeText(name)
    .split(/\s+/)
    .filter((w) => w.length > 2 && !NAME_FILLER.has(w))
    .map((w) => (w.length > 4 ? w.replace(/e?s$/, '') : w))
}

export type RecipeNameMatch<T> = { kind: 'one'; recipe: T } | { kind: 'many'; recipes: T[] } | { kind: 'none' }

/**
 * The recipe a name means among `items`: the one called exactly that; else
 * the one whose name has every word said («las lentejas» → «Lentejas
 * estofadas»). Several → `many` (up to 5), unless exactly one of them is the
 * household's own (`own`), which wins as it always has. Nothing → `none`:
 * never a recipe that only shares a word.
 */
export function matchRecipeName<T extends { id: string; name: string; own?: boolean }>(items: readonly T[], said: string): RecipeNameMatch<T> {
  const unique = [...new Map(items.filter((r) => r?.id && r.name).map((r) => [r.id, r])).values()]
  const pick = (found: T[]): RecipeNameMatch<T> | null => {
    if (found.length === 0) return null
    if (found.length === 1) return { kind: 'one', recipe: found[0] }
    const own = found.filter((r) => r.own)
    if (own.length === 1) return { kind: 'one', recipe: own[0] }
    return { kind: 'many', recipes: found.slice(0, 5) }
  }
  const q = normalizeText(said).trim()
  if (!q) return { kind: 'none' }
  return (
    pick(unique.filter((r) => normalizeText(r.name).trim() === q)) ??
    pick(unique.filter((r) => namesAllWords(r.name, said))) ?? { kind: 'none' }
  )
}

/** «"Crema de calabaza" (recipeId r-1); "Crema de calabaza asada" (recipeId r-2)». */
export function recipeChoices(recipes: ReadonlyArray<{ id: string; name: string }>): string {
  return recipes.map((r) => `"${r.name}" (recipeId ${r.id})`).join('; ')
}

/** What a tool says when the name fits several recipes: nothing done, ask which. */
export function askWhichRecipe(said: string, recipes: ReadonlyArray<{ id: string; name: string }>): string {
  return `No he hecho nada: "${said}" encaja con ${recipes.length} recetas: ${recipeChoices(recipes)}. Preguntale cual (con [[opciones: …]] y sus nombres) y vuelve a llamar con su recipeId.`
}
