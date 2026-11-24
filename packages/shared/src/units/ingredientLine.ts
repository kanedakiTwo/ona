/**
 * One ingredient line, as people write it on paper (PRO-1115):
 * «200 g de lentejas», «1 cebolla», «2 cucharadas de aceite», «una pizca
 * de sal», «sal», «200 g de bacalao, desalado (opcional)».
 *
 * `parseIngredientLine` reads the amount, the unit (the vocabulary in
 * `vocabulary.ts` plus the metric ones), the name, the note (after the
 * comma or between brackets) and «(opcional)», without AI.
 * `ingredientLineToRow` turns that into the units a recipe row stores, and
 * `formatIngredientLine` writes a saved row back as a line (the editor
 * shows the saved rows as text).
 */
import type { Unit } from '../constants/enums.js'
import { normalizeTerm } from './normalize.js'
import { resolveFromTable } from './resolve.js'
import { getTermBySynonym } from './vocabulary.js'

export interface ParsedIngredientLine {
  /** The line, trimmed and without the leading bullet. */
  raw: string
  /** Amount as written (1.5 for «1,5», 0.5 for «media»); null when there is none. */
  quantity: number | null
  /** The unit word as written, lowercased («g», «cucharadas», «puñado»); null when none. */
  unitText: string | null
  /**
   * The unit: a metric one ('g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l'), a
   * vocabulary canonical ('cda', 'pizca', 'puñado', 'diente', 'al gusto'…)
   * or a container ('lata', 'bote'…). null = pieces («1 cebolla»).
   */
  unit: string | null
  /** What the ingredient is, as written («lentejas», «aceite de oliva»). */
  name: string
  /** «desalado», «en lomos»: after the first comma and between brackets. */
  note: string | null
  optional: boolean
}

const METRIC: Record<string, string> = {
  g: 'g', gr: 'g', grs: 'g', gramo: 'g', gramos: 'g',
  kg: 'kg', kgs: 'kg', kilo: 'kg', kilos: 'kg', kilogramo: 'kg', kilogramos: 'kg',
  mg: 'mg', miligramo: 'mg', miligramos: 'mg',
  ml: 'ml', mililitro: 'ml', mililitros: 'ml', cc: 'ml',
  cl: 'cl', centilitro: 'cl', centilitros: 'cl',
  dl: 'dl', decilitro: 'dl', decilitros: 'dl',
  l: 'l', lt: 'l', lts: 'l', litro: 'l', litros: 'l',
}

/** Bought as one piece: «1 lata de atún» is one unit of atún. */
const CONTAINERS: Record<string, string> = {
  lata: 'lata', latas: 'lata', bote: 'bote', botes: 'bote', sobre: 'sobre', sobres: 'sobre',
  paquete: 'paquete', paquetes: 'paquete', tarro: 'tarro', tarros: 'tarro',
  brik: 'brik', briks: 'brik', brick: 'brik', bricks: 'brik', bolsa: 'bolsa', bolsas: 'bolsa',
  tableta: 'tableta', tabletas: 'tableta', vasito: 'vasito', vasitos: 'vasito',
}

const NUMBER_WORDS: Record<string, number> = {
  un: 1, una: 1, uno: 1, medio: 0.5, media: 0.5, dos: 2, tres: 3, cuatro: 4, cinco: 5,
  seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12,
}

const UNICODE_FRACTIONS: Record<string, number> = {
  '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125,
}

const AL_GUSTO = /\s*\b(?:al gusto|a gusto|al paladar|cantidad suficiente|cantidad necesaria)\b|\s*(?:^|\s)c\/s\b|\s*(?:^|\s)c\.s\./gi
const OPTIONAL = /\s*\(\s*opcional(?:es)?\s*\)|\s*,?\s*\bopcional(?:es)?\b/gi
const BULLET = /^\s*(?:[-–—•*·]+\s*)+/

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}

/** «1,5» / «1.5» / «1/2» / «1 1/2» / «1½» → number. */
function toNumber(text: string): number | null {
  const t = text.trim().replace(',', '.')
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t)
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  const frac = /^(\d+)\/(\d+)$/.exec(t)
  if (frac) return Number(frac[2]) === 0 ? null : Number(frac[1]) / Number(frac[2])
  const uni = /^(\d*)\s*([½¼¾⅓⅔⅛])$/.exec(t)
  if (uni) return Number(uni[1] || 0) + UNICODE_FRACTIONS[uni[2]]
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const NUMBER_RE = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d*\s*[½¼¾⅓⅔⅛]|\d+(?:[.,]\d+)?)/

/** Reads the amount at the start of `s`; returns it and the rest. */
function readQuantity(s: string): { quantity: number | null; rest: string } {
  let rest = s
  const lower = rest.toLowerCase()
  // Fixed phrases first: «un par de», «media docena de», «un cuarto de».
  const phrases: Array<[RegExp, number]> = [
    [/^un par de\s+/, 2],
    [/^media docena de\s+/, 6],
    [/^una docena de\s+/, 12],
    [/^(?:un\s+)?cuarto de\s+/, 0.25],
    [/^tres cuartos de\s+/, 0.75],
  ]
  for (const [re, value] of phrases) {
    const m = re.exec(lower)
    if (m) return { quantity: value, rest: rest.slice(m[0].length) }
  }
  const num = NUMBER_RE.exec(rest)
  let quantity: number | null = null
  if (num && num[0].trim()) {
    quantity = toNumber(num[0])
    rest = rest.slice(num[0].length)
  } else {
    const word = /^([a-záéíóúñ]+)\b\s*/i.exec(rest)
    const key = word?.[1].toLowerCase()
    if (key && key in NUMBER_WORDS) {
      quantity = NUMBER_WORDS[key]
      rest = rest.slice(word![0].length)
    } else if (key && /^(?:unos|unas|algunos|algunas|varios|varias)$/.test(key)) {
      rest = rest.slice(word![0].length)
      return { quantity: null, rest }
    }
  }
  if (quantity == null) return { quantity: null, rest: s }
  // «1 y medio», «2 y 1/2».
  const half = /^\s+y\s+(?:medio|media|1\/2|½)\b/i.exec(rest)
  if (half) {
    quantity += 0.5
    rest = rest.slice(half[0].length)
  }
  // Ranges keep the first amount: «2-3 tomates», «2 o 3 tomates».
  const range = /^\s*(?:-|–|o|a)\s*\d+(?:[.,]\d+)?/i.exec(rest)
  if (range) rest = rest.slice(range[0].length)
  return { quantity: round(quantity), rest: rest.trimStart() }
}

/** Singular of one Spanish word, only for unit lookups («cucharadas» → «cucharada»). */
function singularWord(w: string): string[] {
  const out = [w]
  if (w.endsWith('es') && w.length > 3) out.push(w.slice(0, -2))
  if (w.endsWith('s') && w.length > 2) out.push(w.slice(0, -1))
  return out
}

interface UnitHit {
  unit: string
  /** Metric and abbreviations can go without «de»: «200 g lentejas», «2 cdas aceite». */
  bare: boolean
}

/** Short forms that go without «de» («2 cdas aceite»). Metric ones always can. */
const ABBREVIATIONS = new Set(['cda', 'cdas', 'cdta', 'cdtas', 'cdita', 'cditas', 'cdt', 'cuchs', 'tsp', 'tbsp', 'u', 'ud', 'uds', 'pza', 'pzas'])

function lookupUnit(phrase: string): UnitHit | null {
  const words = normalizeTerm(phrase).split(' ')
  const head = words[0].replace(/\.$/, '')
  for (const first of singularWord(head)) {
    const candidate = [first, ...words.slice(1)].join(' ')
    if (words.length === 1 && METRIC[candidate]) return { unit: METRIC[candidate], bare: true }
    if (words.length === 1 && CONTAINERS[candidate]) return { unit: CONTAINERS[candidate], bare: false }
    const term = getTermBySynonym(candidate) ?? getTermBySynonym(`${candidate}.`)
    if (term) return { unit: term.canonical, bare: words.length === 1 && ABBREVIATIONS.has(head) }
  }
  return null
}

/** Reads a unit at the start of `s` (up to 3 words), only if a name follows it. */
function readUnit(s: string): { unit: string; unitText: string; rest: string } | null {
  const words = s.split(/\s+/).filter(Boolean)
  for (let k = Math.min(3, words.length - 1); k >= 1; k--) {
    const phrase = words.slice(0, k).join(' ')
    const hit = lookupUnit(phrase)
    if (!hit) continue
    const after = words.slice(k)
    const hasDe = /^(?:de|del|d')$/i.test(after[0] ?? '')
    const name = hasDe ? after.slice(1) : after
    if (name.length === 0) continue
    if (!hasDe && !hit.bare) continue
    return { unit: hit.unit, unitText: phrase.toLowerCase(), rest: after.join(' ') }
  }
  // «200g», «1kg»: the number already went; a glued unit is the whole first word.
  return null
}

/**
 * Reads one line of the ingredients box. Null for a blank line. Never
 * throws: what it can't read stays in `name`.
 */
export function parseIngredientLine(line: string): ParsedIngredientLine | null {
  let s = line.replace(BULLET, '').replace(/\s+/g, ' ').trim().replace(/[.;]+$/, '').trim()
  if (!s) return null
  const raw = s

  let optional = false
  s = s.replace(OPTIONAL, () => {
    optional = true
    return ''
  })

  let alGusto = false
  s = s.replace(AL_GUSTO, () => {
    alGusto = true
    return ''
  })

  const notes: string[] = []
  s = s.replace(/\(([^)]*)\)/g, (_, inner: string) => {
    if (inner.trim()) notes.unshift(inner.trim())
    return ' '
  })

  // The first comma that isn't a decimal one («1,5 kg») starts the note.
  const comma = /(?<!\d),|,(?!\d)/.exec(s)
  if (comma) {
    const after = s.slice(comma.index + 1).trim()
    if (after) notes.unshift(after)
    s = s.slice(0, comma.index)
  }
  s = s.replace(/\s+/g, ' ').trim()

  const { quantity, rest: afterQty } = readQuantity(s)
  let rest = afterQty
  let unit: string | null = null
  let unitText: string | null = null

  // «200g», «1,5kg»: the unit glued to the number.
  const glued = quantity != null ? /^([a-z]{1,3}\.?)(?=\s|$)/i.exec(rest) : null
  const gluedUnit = glued && s.length > rest.length && !/\s$/.test(s.slice(0, s.length - rest.length)) ? METRIC[glued[1].toLowerCase().replace(/\.$/, '')] : undefined
  if (glued && gluedUnit) {
    unit = gluedUnit
    unitText = glued[1].toLowerCase()
    rest = rest.slice(glued[0].length).trim()
  } else {
    const hit = readUnit(rest)
    if (hit) {
      unit = hit.unit
      unitText = hit.unitText
      rest = hit.rest
    }
  }

  const name = rest
    .replace(/^(?:de|del|d')\s+/i, '')
    .replace(/[\s:;.\-–]+$/, '')
    .trim()

  if (alGusto && quantity == null && unit == null) {
    unit = 'al gusto'
  }

  return {
    raw,
    quantity,
    unitText,
    unit,
    name,
    note: notes.length > 0 ? notes.join(', ') : null,
    optional,
  }
}

/** What a recipe row stores for a parsed line (schema units: g / ml / u / cda / cdita / pizca / al_gusto). */
export interface IngredientLineAmount {
  quantity: number
  unit: Unit
  /** The amount and unit as written, when the row stores another unit («1 puñado» → 30 g). */
  displayQuantity?: number
  displayUnit?: string
}

const METRIC_FACTOR: Record<string, { unit: Unit; factor: number }> = {
  g: { unit: 'g', factor: 1 },
  kg: { unit: 'g', factor: 1000 },
  mg: { unit: 'g', factor: 0.001 },
  ml: { unit: 'ml', factor: 1 },
  cl: { unit: 'ml', factor: 10 },
  dl: { unit: 'ml', factor: 100 },
  l: { unit: 'ml', factor: 1000 },
}

/** The units the schema stores as they are. */
const DIRECT: Record<string, Unit> = { cda: 'cda', cdita: 'cdita', pizca: 'pizca', unidad: 'u' }

export function ingredientLineToRow(parsed: ParsedIngredientLine): IngredientLineAmount {
  const { unit, unitText } = parsed
  if (unit === 'al gusto' || unit === 'cantidad suficiente') return { quantity: 0, unit: 'al_gusto' }
  if (parsed.quantity == null && unit == null) return { quantity: 0, unit: 'al_gusto' }
  const q = parsed.quantity ?? 1
  if (unit == null) return { quantity: q, unit: 'u' }
  const metric = METRIC_FACTOR[unit]
  if (metric) {
    const quantity = round(q * metric.factor)
    if (metric.factor === 1) return { quantity, unit: metric.unit }
    return { quantity, unit: metric.unit, displayQuantity: q, displayUnit: unitText ?? unit }
  }
  if (DIRECT[unit]) return { quantity: q, unit: DIRECT[unit] }
  if (Object.values(CONTAINERS).includes(unit)) {
    return { quantity: q, unit: 'u', displayQuantity: q, displayUnit: unitText ?? unit }
  }
  const resolved = resolveFromTable({ displayQuantity: q, displayUnit: unit })
  if (!resolved) return { quantity: q, unit: 'u', displayQuantity: q, displayUnit: unitText ?? unit }
  return {
    quantity: resolved.canonicalQuantity,
    unit: resolved.canonicalUnit,
    displayQuantity: q,
    displayUnit: unitText ?? unit,
  }
}

/** «1,5», «1/2», «1 1/2»: how an amount reads in a line. Halves and quarters only off the metric units. */
export function formatLineQuantity(q: number, fractions = true): string {
  const whole = Math.floor(q)
  const rest = round(q - whole)
  const halves: Record<string, string> = { '0.25': '1/4', '0.5': '1/2', '0.75': '3/4' }
  const frac = halves[String(rest)]
  if (fractions && frac && q < 10) return whole === 0 ? frac : `${whole} ${frac}`
  return String(round(q)).replace('.', ',')
}

/** A saved row, with what the line needs to write it back. */
export interface IngredientLineRow {
  ingredientName: string
  quantity: number | ''
  unit: string
  displayQuantity?: number | null
  displayUnit?: string | null
  note?: string | null
  optional?: boolean
}

const UNIT_WORDS: Partial<Record<string, [string, string]>> = {
  cda: ['cucharada', 'cucharadas'],
  cdita: ['cucharadita', 'cucharaditas'],
  pizca: ['pizca', 'pizcas'],
}

const PLAIN_VOWEL: Record<string, string> = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' }

/** «patata» → «patatas», «limón» → «limones», «nuez» → «nueces»; one already in plural stays. */
function pluralWord(w: string): string {
  if (/s$/i.test(w)) return w
  if (/[aeiouáéó]$/i.test(w)) return `${w}s`
  if (/z$/i.test(w)) return `${w.slice(0, -1)}ces`
  const m = /([áéíóú])([nl])$/.exec(w)
  if (m) return `${w.slice(0, -2)}${PLAIN_VOWEL[m[1]]}${m[2]}es`
  return `${w}es`
}

/**
 * The name of something counted in more than one (24-nov: a photo import wrote
 * «2 patata»): «2 patatas», «3 dientes de ajo». Only a lone noun, or the noun
 * before «de»; «2 pimiento rojo» stays as it is (its adjective would need the
 * plural too, and a wrong guess reads worse).
 */
export function countedIngredientName(name: string): string {
  const words = name.split(' ')
  if (words.length > 1 && words[1] !== 'de') return name
  return [pluralWord(words[0]), ...words.slice(1)].join(' ')
}

/**
 * A saved row back as a line: «200 g de lentejas», «2 cucharadas de aceite»,
 * «1 cebolla», «2 patatas», «sal al gusto», «200 g de bacalao, desalado
 * (opcional)». Reading the line again gives the same row (a counted name comes
 * back in plural: the library folds it to the same ingredient).
 */
export function formatIngredientLine(row: IngredientLineRow): string {
  const name = row.ingredientName.trim()
  const q = typeof row.quantity === 'number' ? row.quantity : 0
  let line: string
  if (row.displayQuantity != null && row.displayQuantity > 0 && row.displayUnit) {
    const metric = METRIC[normalizeTerm(row.displayUnit).replace(/\.$/, '')] != null
    line = `${formatLineQuantity(row.displayQuantity, !metric)} ${row.displayUnit} de ${name}`
  } else if (row.unit === 'al_gusto' || q <= 0) {
    line = `${name} al gusto`
  } else if (row.unit === 'u') {
    line = `${formatLineQuantity(q)} ${q > 1 ? countedIngredientName(name) : name}`
  } else if (row.unit === 'pizca' && q === 1) {
    line = `una pizca de ${name}`
  } else {
    const words = UNIT_WORDS[row.unit]
    const unit = words ? words[q === 1 ? 0 : 1] : row.unit
    line = `${formatLineQuantity(q, row.unit !== 'g' && row.unit !== 'ml')} ${unit} de ${name}`
  }
  const note = row.note?.trim()
  if (note) line += `, ${note}`
  if (row.optional) line += ' (opcional)'
  return line
}

/** One line of the ingredients box once read: the ingredient and the section it falls under. */
export interface IngredientTextLine {
  /** The line as written (trimmed). */
  line: string
  /** «Para la masa»: the last heading above the line, if any. */
  section: string | null
  parsed: ParsedIngredientLine
}

/** «Para la masa:», «Relleno:»: a heading that groups the lines below it. */
function sectionHeading(line: string): string | null {
  const s = line.replace(BULLET, '').trim()
  if (!s.endsWith(':') || /\d/.test(s) || s.length > 60) return null
  const title = s.slice(0, -1).trim()
  return title || null
}

/** The whole ingredients box: one ingredient per line, headings ending in «:» start a section. */
export function parseIngredientText(text: string): IngredientTextLine[] {
  const out: IngredientTextLine[] = []
  let section: string | null = null
  for (const rawLine of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const heading = sectionHeading(line)
    if (heading) {
      section = heading
      continue
    }
    const parsed = parseIngredientLine(line)
    if (parsed && parsed.name) out.push({ line, section, parsed })
  }
  return out
}

/** Saved rows back as the box's text, with a heading wherever the section changes. */
export function formatIngredientText(rows: ReadonlyArray<IngredientLineRow & { section?: string | null }>): string {
  const lines: string[] = []
  let section: string | null = null
  for (const row of rows) {
    const next = row.section?.trim() || null
    if (next !== section && next) lines.push(`${next}:`)
    section = next
    lines.push(formatIngredientLine(row))
  }
  return lines.join('\n')
}
