/**
 * PRO-268 — steps that name meat, fish, shellfish or an allergen the recipe
 * doesn't list (safety of the diet filter).
 *
 * «Lentejas guisadas» said «añadir chorizo y morcilla» and «añadir huesos»
 * with none of them in the ingredients: the shopping list missed them and,
 * since the diet and allergen filters read the ingredients, the recipe still
 * looked fine for a home without pork or a vegetarian one. The reviewer's
 * STEP_INGREDIENT_NOT_LISTED only sees names that exist in the ingredient
 * catalogue (a fresh catalogue has no chorizo, and no catalogue has «huesos»),
 * so this check carries its own word list, independent of the catalogue.
 *
 * Pure: steps and the recipe's ingredient names in, findings out. Used by
 * the reviewer (`recipeLint`, code STEP_DIET_INGREDIENT_NOT_LISTED) and by
 * the catalogue audit `scripts/auditStepDietMentions.ts`.
 *
 * Reading (same spirit as PRO-289: whole words, singular/plural only):
 *   - a term is covered when every word of it is in the recipe's ingredient
 *     names («pollo» with «caldo de pollo», «vino» with «vinagre de vino»);
 *   - generic words and cuts («carne», «pescado», «marisco», «frutos secos»,
 *     «pechuga», «lomo», «huesos», «albóndigas») are covered by any listed
 *     member of their family — the diet doesn't change;
 *   - «clara», «yema» are covered by a listed egg;
 *   - never after «sin» («sin hueso», «sin gluten»);
 *   - a cut or «carne» followed by «de» lets the next word speak
 *     («lomos de merluza», «la carne del tomate», «huesos de aceituna»);
 *   - «nuez moscada» is a spice; «leche de coco / avena / arroz» isn't dairy;
 *   - a size isn't the food («del tamaño de una nuez», «como un huevo»,
 *     «una nuez de mantequilla»);
 *   - homographs that are also adjectives («dorada», «clara», «bonito»)
 *     count only after an article, a number or «de».
 */

export type DietCategory =
  | 'carne' | 'pescado' | 'marisco' | 'gluten' | 'lacteos' | 'huevo' | 'frutos_secos' | 'cacahuete'
  | 'soja' | 'sesamo' | 'mostaza' | 'apio' | 'sulfitos' | 'altramuz'

export const DIET_CATEGORY_LABEL: Record<DietCategory, string> = {
  carne: 'carne',
  pescado: 'pescado',
  marisco: 'marisco',
  gluten: 'gluten',
  lacteos: 'lácteos',
  huevo: 'huevo',
  frutos_secos: 'frutos secos',
  cacahuete: 'cacahuete',
  soja: 'soja',
  sesamo: 'sésamo',
  mostaza: 'mostaza',
  apio: 'apio',
  sulfitos: 'sulfitos',
  altramuz: 'altramuz',
}

export interface DietMention {
  /** 0-based step index. */
  step: number
  /** The term as it is listed here, normalized («chorizo», «huesos» → «hueso»). */
  term: string
  category: DietCategory
}

interface Term {
  words: string[]
  category: DietCategory
  /** Covered by any listed member of these categories (generic words, cuts). */
  family?: DietCategory[]
  /** Only after an article, a number or «de» (also an adjective). */
  cue?: boolean
  /** Covered by a listed «huevo». */
  egg?: boolean
}

const t = (text: string, category: DietCategory, extra: Omit<Term, 'words' | 'category'> = {}): Term => ({
  words: text.split(' '),
  category,
  ...extra,
})

const MEAT = [
  'ternera', 'vaca', 'cerdo', 'cochinillo', 'cordero', 'lechazo', 'cabrito', 'pollo', 'gallina', 'pavo', 'conejo',
  'pato', 'codorniz', 'perdiz', 'chorizo', 'morcilla', 'jamon', 'panceta', 'bacon', 'beicon', 'tocino', 'lacon',
  'salchicha', 'salchichon', 'sobrasada', 'fuet', 'butifarra', 'longaniza', 'cecina', 'mortadela', 'chistorra',
  'codillo', 'oreja', 'manitas', 'callos', 'higado', 'mollejas', 'foie', 'magret', 'lardo', 'pancetta', 'guanciale',
  'pepperoni', 'carrillera', 'carrillada', 'rabo de toro',
]
const MEAT_GENERIC = ['carne', 'albondiga', 'hamburguesa']
const CUTS = ['pechuga', 'muslo', 'contramuslo', 'alita', 'lomo', 'costilla', 'chuleta', 'solomillo', 'filete', 'entrecot', 'hueso', 'jarrete']
const FISH = [
  'merluza', 'bacalao', 'salmon', 'atun', 'sardina', 'boqueron', 'anchoa', 'caballa', 'lubina', 'rape', 'rodaballo',
  'lenguado', 'corvina', 'besugo', 'pescadilla', 'trucha', 'emperador', 'abadejo', 'panga', 'palometa', 'perca',
  'jurel', 'anguila', 'angula', 'gula', 'surimi', 'fumet', 'huevas', 'pez espada',
]
const FISH_CUE = ['dorada', 'bonito', 'mero', 'gallo']
const SHELLFISH = [
  'gamba', 'langostino', 'cigala', 'camaron', 'carabinero', 'bogavante', 'langosta', 'cangrejo', 'necora',
  'centollo', 'mejillon', 'almeja', 'berberecho', 'vieira', 'ostra', 'calamar', 'chipiron', 'sepia', 'pulpo',
  'percebe', 'puntillita',
]
const NUTS = ['almendra', 'nuez', 'avellana', 'anacardo', 'pistacho', 'pinon', 'macadamia', 'pecana']

const TERMS: Term[] = [
  ...MEAT.map((x) => t(x, 'carne')),
  ...MEAT_GENERIC.map((x) => t(x, 'carne', { family: ['carne'] })),
  ...CUTS.map((x) => t(x, 'carne', { family: ['carne', 'pescado'] })),
  ...FISH.map((x) => t(x, 'pescado')),
  ...FISH_CUE.map((x) => t(x, 'pescado', { cue: true })),
  t('pescado', 'pescado', { family: ['pescado'] }),
  ...SHELLFISH.map((x) => t(x, 'marisco')),
  t('choco', 'marisco', { cue: true }),
  t('marisco', 'marisco', { family: ['marisco'] }),
  ...['harina', 'pan', 'trigo', 'cebada', 'centeno', 'espelta', 'cuscus', 'bulgur', 'semola', 'cerveza', 'galleta', 'picatoste', 'seitan', 'naan'].map((x) => t(x, 'gluten')),
  ...['leche', 'nata', 'queso', 'mantequilla', 'yogur', 'requeson', 'mozzarella', 'parmesano', 'kefir', 'ghee', 'mascarpone'].map((x) => t(x, 'lacteos')),
  t('huevo', 'huevo'),
  t('yema', 'huevo', { egg: true }),
  t('clara', 'huevo', { egg: true, cue: true }),
  ...NUTS.map((x) => t(x, 'frutos_secos')),
  t('frutos secos', 'frutos_secos', { family: ['frutos_secos'] }),
  t('cacahuete', 'cacahuete'),
  ...['soja', 'tofu', 'miso', 'tempeh', 'edamame'].map((x) => t(x, 'soja')),
  ...['sesamo', 'tahini', 'tahin'].map((x) => t(x, 'sesamo')),
  t('mostaza', 'mostaza'),
  t('apio', 'apio'),
  t('vino', 'sulfitos'),
  t('altramuz', 'altramuz'),
]

const NOUN_CUES = new Set([
  'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'cada', 'ese', 'esa', 'esos', 'esas', 'su', 'sus', 'de',
  'del', 'con', 'al', 'y', 'e', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'ocho', 'media', 'medio',
])
const PLANT_MILK = new Set(['coco', 'avena', 'arroz', 'almendra', 'almendras', 'soja', 'avellana', 'avellanas', 'anacardo', 'anacardos'])
const WITHOUT_FILLER = new Set(['el', 'la', 'los', 'las', 'su', 'sus'])

/** Lowercase, no accents, ñ → n, [a-z0-9] runs. */
export function dietWords(text: string): string[] {
  const out = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
  return out ? out.split(' ') : []
}

/** Same word up to Spanish number: «hueso»/«huesos», «limón»/«limones», «pez»/«peces». */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  const [short, long] = a.length < b.length ? [a, b] : [b, a]
  if (long === short + 's' || long === short + 'es') return true
  return short.endsWith('z') && long === short.slice(0, -1) + 'ces'
}

function inWords(set: readonly string[], word: string): boolean {
  return set.some((x) => sameWord(x, word))
}

/** Categories present in the recipe's own ingredient names. */
function listedCategories(listedWords: readonly string[]): Set<DietCategory> {
  const out = new Set<DietCategory>()
  for (const term of TERMS) {
    if (term.egg) continue
    if (term.words.every((w) => inWords(listedWords, w))) out.add(term.category)
  }
  return out
}

/** Does the term at step words `w[i…]` read as the ingredient here? */
function readsAsFood(term: Term, w: readonly string[], i: number): boolean {
  const prev = w[i - 1] ?? ''
  const next = w[i + term.words.length] ?? ''
  const after = w[i + term.words.length + 1] ?? ''
  if (prev === 'sin' || (WITHOUT_FILLER.has(prev) && w[i - 2] === 'sin')) return false
  if (term.cue && !NOUN_CUES.has(prev) && !/^\d+$/.test(prev)) return false
  const head = term.words[0]
  if (head === 'nuez' && next === 'moscada') return false
  // A size, not the food: «bolas del tamaño de una nuez», «como un huevo»,
  // «una nuez de mantequilla».
  if (w.slice(Math.max(0, i - 4), i).includes('tamano')) return false
  if ((prev === 'un' || prev === 'una') && w[i - 2] === 'como') return false
  if (head === 'nuez' && next === 'de') return false
  if (head === 'leche' && next === 'de' && PLANT_MILK.has(after)) return false
  if (term.family && term.category === 'carne' && (next === 'de' || next === 'del')) return false
  return true
}

/**
 * Meat, fish, shellfish and allergens the steps name and the ingredient
 * names don't account for. One finding per step and term.
 */
export function unlistedDietMentions(steps: readonly string[], ingredientNames: readonly string[]): DietMention[] {
  const listedWords = ingredientNames.flatMap(dietWords)
  const listedCats = listedCategories(listedWords)
  const hasEgg = inWords(listedWords, 'huevo')
  const out: DietMention[] = []
  steps.forEach((text, step) => {
    const w = dietWords(text ?? '')
    const seen = new Set<string>()
    for (const term of TERMS) {
      const key = term.words.join(' ')
      if (seen.has(key)) continue
      if (term.words.every((x) => inWords(listedWords, x))) continue
      if (term.family && term.family.some((c) => listedCats.has(c))) continue
      if (term.egg && hasEgg) continue
      outer: for (let i = 0; i + term.words.length <= w.length; i++) {
        for (let k = 0; k < term.words.length; k++) {
          if (!sameWord(w[i + k], term.words[k])) continue outer
        }
        if (!readsAsFood(term, w, i)) continue
        seen.add(key)
        out.push({ step, term: key, category: term.category })
        break
      }
    }
  })
  return out
}

/** Is this term part of a name (e.g. a catalogue name the reviewer already flagged)? */
export function nameHasTerm(name: string, term: string): boolean {
  const nw = dietWords(name)
  const tw = dietWords(term)
  return tw.every((x) => inWords(nw, x))
}
