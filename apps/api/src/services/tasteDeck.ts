/**
 * «Afina tu menú» (PRO-146, specs/taste.md) — pure part: how a catalogue
 * recipe becomes a card (meta line, main ingredients, protein group) and
 * which cards come next (starter deck, then the variety order that also
 * backs up Claude's pick). No DB, no network: unit-tested.
 */
import { TASTE_BATCH_SIZE, TASTE_STARTER_DECK, type TasteCard, type TasteProteinGroup } from '@ona/shared'
import { normalizeText } from './dietaryRestrictions.js'

export interface TasteRecipe {
  id: string
  name: string
  imageUrl: string | null
  prepTime: number | null
  totalTime: number | null
  tags: string[]
  equipment: string[]
  course: string | null
  ingredients: Array<{ ingredientName: string; quantity: number; unit: string }>
}

/** Basics never offered in «¿Qué es lo que no?» (nobody dislikes salt; everything has onion). */
const BASICS = new Set([
  'sal', 'sal gorda', 'sal fina', 'sal en escamas', 'pimienta', 'pimienta negra', 'pimienta blanca', 'ajo', 'ajos',
  'cebolla', 'cebollas', 'agua', 'azucar', 'harina', 'harina de trigo', 'laurel', 'hoja de laurel', 'levadura',
  'caldo', 'hielo',
])
const BASIC_PREFIXES = ['aceite', 'vinagre', 'sal ', 'agua ']

export function isBasicIngredient(name: string): boolean {
  const n = normalizeText(name)
  return BASICS.has(n) || BASIC_PREFIXES.some((p) => n.startsWith(p))
}

/** Feminine nouns that don't end in -a (and masculine ones that do). */
const FEMININE = new Set(['coliflor', 'leche', 'carne', 'nuez', 'miel', 'col', 'sal', 'nata', 'piel', 'clara', 'yema', 'crema', 'salsa', 'bechamel'])
const MASCULINE_A = new Set(['dia', 'mapa', 'tofu', 'brocoli'])

/** «cilantro» → «el cilantro», «espinacas» → «las espinacas», «coliflor» → «la coliflor». */
export function withArticle(name: string): string {
  const clean = name.trim().toLowerCase()
  const first = normalizeText(clean).split(' ')[0] ?? ''
  const plural = /s$/.test(first) && first.length > 3 && !/(is|us)$/.test(first)
  const singular = plural ? first.replace(/es$/, '').replace(/s$/, '') : first
  const feminine = FEMININE.has(singular) || FEMININE.has(first) || (!MASCULINE_A.has(singular) && /a$/.test(singular)) || /(cion|dad)$/.test(singular)
  if (plural) return `${feminine || /as$/.test(first) ? 'las' : 'los'} ${clean}`
  return `${feminine ? 'la' : 'el'} ${clean}`
}

/** Rough grams so «2 u huevo» and «400 g garbanzos» compare. */
function roughGrams(q: number, unit: string): number {
  const u = unit.toLowerCase()
  if (u === 'g' || u === 'ml') return q
  if (u === 'kg' || u === 'l') return q * 1000
  if (u === 'u') return q * 80
  return q
}

/** The 3 main ingredients by weight, basics left out, each once. */
export function mainIngredients(recipe: Pick<TasteRecipe, 'ingredients'>, max = 3): TasteCard['mainIngredients'] {
  const seen = new Set<string>()
  return [...recipe.ingredients]
    .filter((i) => !isBasicIngredient(i.ingredientName))
    .sort((a, b) => roughGrams(b.quantity, b.unit) - roughGrams(a.quantity, a.unit))
    .filter((i) => {
      const k = normalizeText(i.ingredientName)
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
    .slice(0, max)
    .map((i) => ({ name: i.ingredientName.trim().toLowerCase(), label: withArticle(i.ingredientName) }))
}

const MEAT = ['ternera', 'vacuno', 'buey', 'cerdo', 'pollo', 'pavo', 'cordero', 'conejo', 'chorizo', 'jamon', 'bacon', 'panceta', 'tocino', 'lomo', 'costilla', 'costillas', 'carne', 'pato', 'magret', 'sobrasada', 'salchicha', 'salchichas', 'morcilla', 'carrillera', 'carrilleras', 'osobuco', 'solomillo', 'albondigas', 'muslo', 'muslos', 'contramuslo', 'contramuslos', 'pechuga', 'alitas', 'hamburguesa', 'cochinita', 'secreto', 'presa']
const FISH = ['bacalao', 'salmon', 'merluza', 'atun', 'dorada', 'lubina', 'sepia', 'gamba', 'gambas', 'langostino', 'langostinos', 'mejillon', 'mejillones', 'calamar', 'calamares', 'pescado', 'rape', 'sardina', 'sardinas', 'boqueron', 'boquerones', 'pulpo', 'almeja', 'almejas', 'bonito', 'caballa', 'trucha', 'pescadilla', 'emperador', 'marisco', 'anchoa', 'anchoas']
const LEGUME = ['lenteja', 'lentejas', 'garbanzo', 'garbanzos', 'alubia', 'alubias', 'judion', 'judiones', 'fabes', 'habas', 'guisantes', 'soja', 'tofu', 'tempeh']
const EGG = ['huevo', 'huevos']

function words(s: string): string[] {
  return normalizeText(s).split(/[^a-z0-9]+/).filter(Boolean)
}

function has(list: readonly string[], ws: readonly string[]): boolean {
  return ws.some((w) => list.includes(w))
}

/** Meat or fish in the name or the ingredients (the session adapts on these two). */
export function proteinGroup(recipe: Pick<TasteRecipe, 'name' | 'ingredients'>): TasteProteinGroup | null {
  const ws = [...words(recipe.name), ...recipe.ingredients.flatMap((i) => words(i.ingredientName))]
  if (has(MEAT, ws)) return 'carne'
  if (has(FISH, ws)) return 'pescado'
  return null
}

/** Finer protein for the variety order: carne, pescado, legumbre, huevo, verdura. */
export function proteinKind(recipe: Pick<TasteRecipe, 'name' | 'ingredients'>): string {
  const g = proteinGroup(recipe)
  if (g) return g
  const ws = [...words(recipe.name), ...recipe.ingredients.flatMap((i) => words(i.ingredientName))]
  if (has(LEGUME, ws)) return 'legumbre'
  if (has(EGG, ws)) return 'huevo'
  return 'verdura'
}

/** Kind of dish shown on the card («Cuchara», «Horno»…) — also the variety order's first axis. */
export function dishType(recipe: Pick<TasteRecipe, 'name' | 'tags' | 'equipment' | 'course'>): string {
  const n = normalizeText(recipe.name)
  const tags = (recipe.tags ?? []).map(normalizeText)
  if (recipe.course === 'dessert' || tags.includes('postre')) return 'Postre'
  if (/\b(lenteja|garbanzo|alubia|cocido|sopa|potaje|fabada|caldo|crema|escudella|puchero|vichy|vichisoisse|ramen|guiso|estofad|guisad|menestra)/.test(n)) return 'Cuchara'
  if (/\b(arroz|paella|risotto)/.test(n)) return 'Arroz'
  if (/\b(espagu|macarr|lasa|fideu|pasta|tallar|noodle|canelon|gnocchi|ñoqui)/.test(n)) return 'Pasta'
  if (/\b(ensalada|tabule|ceviche|aguachile|tiradito|tartar|carpaccio|gazpacho|salmorejo|tzatziki|poke|sushi|onigir)/.test(n)) return 'Frío'
  if (/\b(frit|rebozad|croquet|tempura|alitas|migas|empanad|buñuel)/.test(n)) return 'Frito'
  if (/(al horno|gratinad|asad|horneado|pastel|pastela|tian|lasana|pizza|rellen)/.test(n) || (recipe.equipment ?? []).some((e) => normalizeText(e) === 'horno')) return 'Horno'
  if (/\b(plancha|salteado|wok|revuelto|tortilla|fajita|taco|quesadilla|wrap|sandwich|bocadillo)/.test(n)) return 'Sartén'
  if (/\b(curry|mole|pibil|tajin|chili|guisad)/.test(n)) return 'Guiso'
  return 'Plato'
}

/** 28 → «28 min», 200 → «3 h 20 min», 60 → «1 h». */
export function formatMinutes(min: number): string {
  const m = Math.round(min)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const r = m % 60
  return r ? `${h} h ${r} min` : `${h} h`
}

export function cardMeta(recipe: TasteRecipe): string {
  const t = recipe.totalTime && recipe.totalTime > 0 ? recipe.totalTime : recipe.prepTime && recipe.prepTime > 0 ? recipe.prepTime : null
  const label = dishType(recipe)
  return t ? `${label} · ${formatMinutes(t)}` : label
}

export function toCard(recipe: TasteRecipe): TasteCard {
  return {
    recipeId: recipe.id,
    name: recipe.name,
    imageUrl: recipe.imageUrl,
    meta: cardMeta(recipe),
    mainIngredients: mainIngredients(recipe),
    protein: proteinGroup(recipe),
  }
}

/** Speed bucket, the variety order's last axis. */
function speed(recipe: TasteRecipe): string {
  const t = recipe.totalTime ?? recipe.prepTime ?? 0
  if (!t) return '?'
  return t <= 30 ? 'rapido' : t >= 90 ? 'largo' : 'medio'
}

function axes(recipe: TasteRecipe): [string, string, string] {
  return [dishType(recipe), proteinKind(recipe), speed(recipe)]
}

/**
 * Variety order (also Claude's fallback): one recipe at a time, the one most
 * different from the previous card and from what the user has already seen —
 * alternating dish type, protein and speed. Deterministic (ties keep the
 * input order), so the same catalogue gives the same deck.
 */
export function varietyOrder(pool: readonly TasteRecipe[], seen: readonly TasteRecipe[] = [], limit = pool.length): TasteRecipe[] {
  const counts = [new Map<string, number>(), new Map<string, number>(), new Map<string, number>()]
  const bump = (r: TasteRecipe) => axes(r).forEach((v, i) => counts[i].set(v, (counts[i].get(v) ?? 0) + 1))
  seen.forEach(bump)
  let last: [string, string, string] | null = seen.length ? axes(seen[seen.length - 1]) : null
  const left = [...pool]
  const out: TasteRecipe[] = []
  while (out.length < limit && left.length > 0) {
    let best = 0
    let bestScore = -Infinity
    for (let i = 0; i < left.length; i++) {
      const a = axes(left[i])
      let score = 0
      for (let k = 0; k < 3; k++) {
        const weight = 3 - k // dish type > protein > speed
        if (!last || a[k] !== last[k]) score += 10 * weight
        score -= (counts[k].get(a[k]) ?? 0) * weight
      }
      if (score > bestScore) {
        bestScore = score
        best = i
      }
    }
    const [pick] = left.splice(best, 1)
    out.push(pick)
    bump(pick)
    last = axes(pick)
  }
  return out
}

/** The starter deck rows that exist in `pool`, in deck order (first matching name per row). */
export function starterDeck(pool: readonly TasteRecipe[]): TasteRecipe[] {
  const byName = new Map<string, TasteRecipe>()
  for (const r of pool) if (!byName.has(normalizeText(r.name))) byName.set(normalizeText(r.name), r)
  const out: TasteRecipe[] = []
  for (const row of TASTE_STARTER_DECK) {
    for (const n of row.names) {
      const r = byName.get(normalizeText(n))
      if (r && !out.includes(r)) {
        out.push(r)
        break
      }
    }
  }
  return out
}

/** All starter-deck recipe ids in the catalogue (every alias), to know whether the deck is done. */
export function starterDeckIds(catalog: readonly TasteRecipe[]): Set<string> {
  return new Set(starterDeck(catalog).map((r) => r.id))
}

export interface NextInput {
  catalog: readonly TasteRecipe[]
  /** Recipe ids with any verdict (skips too: a card never comes back). */
  ratedIds: ReadonlySet<string>
  /** Cards already in the user's hands this session (not answered yet). */
  excludeIds?: ReadonlySet<string>
  /** Protein groups the session stopped showing (3 «No para mí» in a row). */
  avoid?: ReadonlySet<TasteProteinGroup>
  /** Recipes already answered, oldest first (feeds the variety counts). */
  history?: readonly TasteRecipe[]
  limit: number
}

/** Unrated, not excluded, not of an avoided protein group. */
export function candidatePool(input: Omit<NextInput, 'limit' | 'history'>): TasteRecipe[] {
  return input.catalog.filter(
    (r) =>
      !input.ratedIds.has(r.id) &&
      !input.excludeIds?.has(r.id) &&
      !(input.avoid?.size && proteinGroup(r) && input.avoid.has(proteinGroup(r)!)),
  )
}

/**
 * The deck to start with while the user has answered fewer than 10
 * cards and some starter row is still unanswered: those rows first, then
 * the variety order to fill the batch. Null when the starter deck is done.
 */
export function starterBatch(input: NextInput): TasteRecipe[] | null {
  if (input.ratedIds.size >= TASTE_BATCH_SIZE) return null
  const pool = candidatePool(input)
  const deck = starterDeck(input.catalog).filter((r) => pool.includes(r))
  if (deck.length === 0) return null
  const rest = varietyOrder(pool.filter((r) => !deck.includes(r)), [...(input.history ?? []), ...deck], input.limit - deck.length)
  return [...deck, ...rest].slice(0, input.limit)
}

/** The variety fallback batch. */
export function varietyBatch(input: NextInput): TasteRecipe[] {
  return varietyOrder(candidatePool(input), input.history ?? [], input.limit)
}
