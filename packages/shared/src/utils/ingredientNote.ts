/**
 * PRO-184 — a countable amount at the start of an ingredient's note scales
 * with the servings, like the quantity does.
 *
 * Laura (hogares de prueba, 2026-10-16) opened «Espaguetis con ajo y aceite»
 * «Para 1 ración»: «Ajo · 6 dientes, laminados · 6 g» — the grams were
 * scaled, the note wasn't. The note is free text; when it starts with a
 * number and a unit you count («6 dientes», «2 hojas», «1 rama»), that number
 * is scaled and rounded to halves («1½ dientes»). Anything else («laminados»,
 * «picada fina», «200 g de…») is left as it is.
 *
 * The recipe linter warns about such notes (`NOTE_STARTS_WITH_NUMBER`), so new
 * recipes put the amount in quantity + unit instead.
 */

/** Countable units that can head a note: singular → plural. */
const COUNTABLE: Record<string, string> = {
  diente: 'dientes',
  hoja: 'hojas',
  rama: 'ramas',
  ramita: 'ramitas',
  hebra: 'hebras',
  rodaja: 'rodajas',
  loncha: 'lonchas',
  lonchita: 'lonchitas',
  trozo: 'trozos',
  tira: 'tiras',
  cabeza: 'cabezas',
  vaina: 'vainas',
  guindilla: 'guindillas',
  cayena: 'cayenas',
  pieza: 'piezas',
  unidad: 'unidades',
  bola: 'bolas',
  gajo: 'gajos',
  tallo: 'tallos',
  manojo: 'manojos',
}

const PLURAL_TO_SINGULAR: Record<string, string> = Object.fromEntries(
  Object.entries(COUNTABLE).map(([s, p]) => [p, s]),
)

const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75 }

// «6 dientes…», «1,5 hojas…», «1½ dientes…», «½ rama…»
const LEADING_COUNT = /^(\s*)(\d+(?:[.,]\d+)?)?\s*([½¼¾])?\s+([a-záéíóúñü]+)/i

function parseCount(whole: string | undefined, frac: string | undefined): number | null {
  if (!whole && !frac) return null
  const n = whole ? Number(whole.replace(',', '.')) : 0
  if (!Number.isFinite(n)) return null
  return n + (frac ? FRACTIONS[frac] : 0)
}

/** 1.5 → «1½», 0.5 → «½», 2 → «2». Rounded to halves, never below ½. */
export function formatHalves(value: number): string {
  const halves = Math.max(1, Math.round(value * 2))
  const whole = Math.floor(halves / 2)
  const half = halves % 2 === 1
  if (whole === 0) return '½'
  return half ? `${whole}½` : String(whole)
}

/** The countable unit (singular, plural) a note starts with, or null. */
function countableUnit(word: string): { singular: string; plural: string } | null {
  const w = word.toLowerCase()
  if (COUNTABLE[w]) return { singular: w, plural: COUNTABLE[w] }
  if (PLURAL_TO_SINGULAR[w]) return { singular: PLURAL_TO_SINGULAR[w], plural: w }
  return null
}

/** True when a note starts with a number followed by a countable unit («6 dientes, laminados»). */
export function noteStartsWithCount(note: string | null | undefined): boolean {
  if (!note) return false
  const m = LEADING_COUNT.exec(note)
  return !!m && parseCount(m[2], m[3]) != null && !!countableUnit(m[4])
}

/** True when a note starts with any number («6 dientes», «200 g de…», «2 latas»). For the linter. */
export function noteStartsWithNumber(note: string | null | undefined): boolean {
  return !!note && /^\s*(\d|[½¼¾])/.test(note)
}

/**
 * Scale the countable amount a note starts with by `factor`
 * («6 dientes, laminados» × ¼ → «1½ dientes, laminados»). Notes that don't
 * start with a number and a countable unit come back unchanged.
 */
export function scaleIngredientNote(note: string | null | undefined, factor: number): string | null | undefined {
  if (!note || !Number.isFinite(factor) || factor <= 0 || factor === 1) return note
  const m = LEADING_COUNT.exec(note)
  if (!m) return note
  const count = parseCount(m[2], m[3])
  const unit = countableUnit(m[4])
  if (count == null || !unit) return note
  const scaled = count * factor
  const label = formatHalves(scaled)
  const word = label === '1' || label === '½' ? unit.singular : unit.plural
  // Keep the word's case («Dientes» → «Dientes»).
  const cased = m[4][0] === m[4][0].toUpperCase() ? word[0].toUpperCase() + word.slice(1) : word
  return `${m[1]}${label} ${cased}${note.slice(m[0].length)}`
}
