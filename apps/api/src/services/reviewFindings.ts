/**
 * The structured part of a reviewer finding (D-189, specs/whatsapp.md
 * "Conversation reviewer agent"): a stable key, the pattern, where to fix it,
 * ONE fix and the test that would catch it again — written without user data,
 * so the Mimoia HQ agents can turn it into a task. Pure: no db, no model.
 *
 * - `annotateFindings` gives each finding of the day its `dias` (days it showed
 *   up in the MEMORY_DAYS before, plus today) and `regresion` (the key had
 *   been away REGRESSION_GAP_DAYS days or more and is back).
 * - `formatMemory` is the reviewer's memory: the keys and patterns of the last
 *   MEMORY_DAYS, so the same problem keeps its key.
 * - `hallazgoForAgents` is what leaves for the agents: closed shapes, and the
 *   three sentences without quotes, names, phones, emails or links.
 */
import { anonymise } from './anonymise.js'

export const REVIEW_CHANNELS = ['whatsapp', 'app'] as const
export type ReviewChannel = (typeof REVIEW_CHANNELS)[number]
export const FINDING_TYPES = ['arreglo', 'decision'] as const
export type FindingType = (typeof FINDING_TYPES)[number]
/** `donde` is one of these, or `guia_aviso:<tipo>` / `herramienta:<nombre>`. */
export const FINDING_WHERE = ['prompt', 'generador', 'webhook', 'plantilla', 'tope', 'otro'] as const
export const FINDING_SEVERITIES = ['alta', 'media', 'baja'] as const
export const MEMORY_DAYS = 14
/** A key absent this many days in a row (or more) that comes back is a regression. */
export const REGRESSION_GAP_DAYS = 3
/** Longest `patron` / `arreglo` / `prueba` that leaves for the agents. */
export const HALLAZGO_TEXT_MAX = 300

const CLAVE_RE = /^[a-z][a-z0-9_]{0,39}(?:\.[a-z0-9_]{1,40}){0,3}$/
const WHERE_PARAM_RE = /^(?:guia_aviso|herramienta):[a-z][a-z0-9_]{1,48}$/
const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const QUOTE_RE = /«[^»]*»?|“[^”]*”?|"[^"]*"?|‘[^’]*’?|'[^']{2,}'/g

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | null => (list.includes(v as T) ? (v as T) : null)

/** `Checkin. Varias-Preguntas` → `checkin.varias_preguntas`; null if it isn't a key. */
export function normaliseClave(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const s = fold(v.trim()).replace(/\s*\.\s*/g, '.').replace(/[\s-]+/g, '_')
  return CLAVE_RE.test(s) ? s : null
}

/** One of FINDING_WHERE, `guia_aviso:<tipo>` or `herramienta:<nombre>`; anything else → `otro`. */
export function normaliseDonde(v: unknown): string {
  if (typeof v !== 'string') return 'otro'
  const s = fold(v).replace(/\s+/g, '')
  return oneOf(s, FINDING_WHERE) ?? (WHERE_PARAM_RE.test(s) ? s : 'otro')
}

/** A reviewer sentence for the agents: quotes → [cita], then anonymise(), one line, capped. */
export function scrubFindingText(v: unknown, knownNames: ReadonlyArray<string> = [], max = HALLAZGO_TEXT_MAX): string {
  if (typeof v !== 'string') return ''
  const s = anonymise(v.replace(QUOTE_RE, '[cita]'), knownNames).replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

/** A key with a known name inside (`cena.lucia`) loses that word. */
function keyWithoutNames(clave: string, knownNames: ReadonlyArray<string>): string {
  const names = new Set(knownNames.filter((n) => n.length >= 3).map(fold))
  if (!names.size) return clave
  return clave
    .split('.')
    .map((seg) => seg.split('_').map((w) => (names.has(w) ? 'x' : w)).join('_'))
    .join('.')
}

const dayNumber = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000)

export interface PriorFinding {
  day: string
  clave: string
  patron: string
  gravedad: string | null
}

/** Pure: the keyed findings stored in earlier reviews (`assistant_reviews` rows). */
export function priorFindings(reviews: ReadonlyArray<{ day: string; findings: unknown }>): PriorFinding[] {
  const out: PriorFinding[] = []
  for (const r of reviews) {
    for (const f of Array.isArray(r.findings) ? (r.findings as Record<string, unknown>[]) : []) {
      const clave = normaliseClave(f?.clave)
      if (!clave || !ISO_DAY_RE.test(r.day)) continue
      out.push({ day: r.day, clave, patron: typeof f.patron === 'string' ? f.patron : '', gravedad: oneOf(f.severity, FINDING_SEVERITIES) })
    }
  }
  return out
}

/** Pure: the reviewer's memory as text for the model (newest key first). */
export function formatMemory(prior: ReadonlyArray<PriorFinding>, day: string): string {
  const from = dayNumber(day) - MEMORY_DAYS
  const byKey = new Map<string, PriorFinding[]>()
  for (const p of prior) {
    const n = dayNumber(p.day)
    if (n < from || n >= dayNumber(day)) continue
    byKey.set(p.clave, [...(byKey.get(p.clave) ?? []), p])
  }
  if (!byKey.size) return `Tu memoria (hallazgos de los ${MEMORY_DAYS} días anteriores): ninguno.`
  const lines = [...byKey.entries()]
    .map(([clave, ps]) => {
      const sorted = [...ps].sort((a, b) => b.day.localeCompare(a.day))
      const days = new Set(ps.map((p) => p.day)).size
      return { last: sorted[0].day, text: `- ${clave} · ${days} día(s), el último ${sorted[0].day}${sorted[0].gravedad ? ` · ${sorted[0].gravedad}` : ''} · ${sorted[0].patron}` }
    })
    .sort((a, b) => b.last.localeCompare(a.last))
    .map((l) => l.text)
  return [
    `Tu memoria (hallazgos de los ${MEMORY_DAYS} días anteriores). Si hoy ves el mismo problema, usa SU clave tal cual; una clave nueva solo para un problema nuevo:`,
    ...lines,
  ].join('\n')
}

export interface StructuredFields {
  canal: ReviewChannel
  clave: string
  patron: string
  donde: string
  arreglo: string
  prueba: string
  tipo: FindingType
  /** Days the key showed up in the MEMORY_DAYS before, plus today. */
  dias: number
  /** The key had been away REGRESSION_GAP_DAYS days or more and is back. */
  regresion: boolean
}

/**
 * Pure: normalise the model's structured fields and add `dias` / `regresion`
 * from the earlier reviews. A finding without a usable key gets
 * `<categoria>.sin_clave`.
 */
export function annotateFindings<T extends Record<string, unknown>>(
  findings: ReadonlyArray<T>,
  prior: ReadonlyArray<PriorFinding>,
  day: string,
): Array<T & StructuredFields> {
  const today = dayNumber(day)
  return findings.map((f) => {
    const clave = normaliseClave(f.clave) ?? `${normaliseClave(f.category) ?? 'otro'}.sin_clave`
    const before = prior.filter((p) => p.clave === clave && dayNumber(p.day) < today && dayNumber(p.day) >= today - MEMORY_DAYS)
    const last = before.reduce((m, p) => Math.max(m, dayNumber(p.day)), -Infinity)
    return {
      ...f,
      canal: oneOf(f.canal, REVIEW_CHANNELS) ?? 'whatsapp',
      clave,
      patron: typeof f.patron === 'string' ? f.patron.trim() : '',
      donde: normaliseDonde(f.donde),
      arreglo: typeof f.arreglo === 'string' ? f.arreglo.trim() : '',
      prueba: typeof f.prueba === 'string' ? f.prueba.trim() : '',
      tipo: oneOf(f.tipo, FINDING_TYPES) ?? 'arreglo',
      dias: new Set(before.map((p) => p.day)).size + 1,
      regresion: Number.isFinite(last) && today - last - 1 >= REGRESSION_GAP_DAYS,
    }
  })
}

export interface AgentHallazgo {
  date: string | null
  canal: ReviewChannel | null
  clave: string
  patron: string
  donde: string
  arreglo: string
  prueba: string
  tipo: FindingType | null
  gravedad: (typeof FINDING_SEVERITIES)[number] | null
  /** The reviewer's category (the caller checks it against its closed list). */
  categoria: string | null
  dias: number | null
  regresion: boolean
}

/**
 * Pure: one stored finding (or an already-built hallazgo) → what the agents
 * read. Null when it has no key (findings from before D-189). Every value is
 * re-checked here, so it can run twice (the loader with the known names, the
 * token view without them).
 */
export function hallazgoForAgents(raw: unknown, date: unknown, knownNames: ReadonlyArray<string> = []): AgentHallazgo | null {
  const f = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const clave = normaliseClave(f.clave)
  if (!clave) return null
  const dias = typeof f.dias === 'number' && Number.isFinite(f.dias) ? Math.min(Math.max(Math.round(f.dias), 1), MEMORY_DAYS + 1) : null
  return {
    date: typeof date === 'string' && ISO_DAY_RE.test(date) ? date : null,
    canal: oneOf(f.canal, REVIEW_CHANNELS),
    clave: keyWithoutNames(clave, knownNames),
    patron: scrubFindingText(f.patron, knownNames),
    donde: normaliseDonde(f.donde),
    arreglo: scrubFindingText(f.arreglo, knownNames),
    prueba: scrubFindingText(f.prueba, knownNames),
    tipo: oneOf(f.tipo, FINDING_TYPES),
    gravedad: oneOf(f.gravedad ?? f.severity, FINDING_SEVERITIES),
    categoria: typeof (f.categoria ?? f.category) === 'string' ? String(f.categoria ?? f.category) : null,
    dias,
    regresion: f.regresion === true,
  }
}
