/**
 * PRO-1115: the name of an ingredient line («lentejas», «pimentón») against
 * the library, without AI. Three answers, the ones the form shows under
 * each line:
 *
 *   - `match` («✓»): the same name once folded (case, accents, plural), or
 *     the token matcher of the imports finds it («cebolla picada» →
 *     «cebolla»);
 *   - `doubt` («¿cuál?», up to 3 buttons): the name is more generic than
 *     several entries («pimentón» → «pimentón dulce», «pimentón picante»;
 *     unanswered, it takes the first one, as the imports do), or it isn't
 *     there but shares words with some («pechuga de pollo» → «pollo»;
 *     unanswered, it's created new);
 *   - `new` («nuevo, se crea al guardar»).
 */
import { foldIngredientName } from '@ona/shared'
import { STOPWORDS, tokenSetMatch, usualVariantFirst, type CatalogEntry } from './ingredientTokenMatch.js'

export type LineMatch =
  | { status: 'match'; ingredient: CatalogEntry }
  | { status: 'doubt'; candidates: CatalogEntry[]; fallback: 'first' | 'new' }
  | { status: 'new' }

const MAX_CANDIDATES = 3

/** «cebollas moradas» → «cebolla morada»: each word without its plural ending. */
export function singularName(folded: string): string {
  return folded
    .split(' ')
    .map((w) => {
      if (w.length <= 3 || STOPWORDS.has(w)) return w
      if (/(?:ones|ores|ales|eles|iles|anes|enes)$/.test(w)) return w.slice(0, -2)
      if (w.endsWith('ces')) return `${w.slice(0, -3)}z`
      if (w.endsWith('s')) return w.slice(0, -1)
      return w
    })
    .join(' ')
}

function key(name: string): string {
  return singularName(foldIngredientName(name).replace(/[.,()]+/g, ' ').replace(/\s+/g, ' ').trim())
}

function words(k: string): string[] {
  return k.split(' ').filter((w) => w.length > 1 && !STOPWORDS.has(w))
}

export function matchIngredientName(name: string, catalog: readonly CatalogEntry[]): LineMatch {
  const k = key(name)
  if (!k) return { status: 'new' }
  const keyed = catalog.map((entry) => ({ entry, k: key(entry.name) }))

  const same = keyed.find((c) => c.k === k)
  if (same) return { status: 'match', ingredient: same.entry }

  // The imports' token matcher, on folded singular names.
  const byKey = new Map<string, CatalogEntry>()
  for (const c of keyed) if (!byKey.has(c.k)) byKey.set(c.k, c.entry)
  const verdict = tokenSetMatch(
    k,
    [...byKey.keys()].map((id) => ({ id, name: id })),
  )
  if (verdict.kind === 'exact' || verdict.kind === 'noise-stripped') {
    return { status: 'match', ingredient: byKey.get(verdict.catalog.id)! }
  }

  const mine = words(k)
  if (verdict.kind === 'user-generic') {
    // Every entry that holds all the typed words, shortest first; the usual
    // variant of the name, if it has one, before them («pimienta» → the black
    // one: it is also what goes in when the question is left unanswered).
    const generic = usualVariantFirst(
      k,
      keyed
        .filter((c) => {
          const theirs = words(c.k)
          return theirs.length > mine.length && mine.every((w) => theirs.includes(w))
        })
        .sort((a, b) => a.entry.name.length - b.entry.name.length || a.entry.name.localeCompare(b.entry.name, 'es'))
        .map((c) => c.entry),
    ).slice(0, MAX_CANDIDATES)
    if (generic.length > 0) return { status: 'doubt', candidates: generic, fallback: 'first' }
  }

  // Not there: the entries that share most words, as a question.
  const scored = keyed
    .map((c) => ({ entry: c.entry, score: words(c.k).filter((w) => mine.includes(w)).length }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.name.length - b.entry.name.length || a.entry.name.localeCompare(b.entry.name, 'es'))
    .slice(0, MAX_CANDIDATES)
    .map((c) => c.entry)
  if (scored.length > 0) return { status: 'doubt', candidates: scored, fallback: 'new' }
  return { status: 'new' }
}
