/**
 * What the read-only metrics token (`x-metrics-token`) sees of the routes that hold user text:
 * counts, categories and severity — never text written by or about a user, never user ids
 * (specs/metrics.md, constraints). The admin JWT keeps the full view. Pure, unit-tested in
 * tests/agentView.test.ts.
 */
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
const SAFE_PATH = /^(?:(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) )?\/[A-Za-z0-9/_:.-]*$/
const ERROR_CLASS = /^(?:Uncaught\s+)?(?:\w+\.)?((?:[A-Z][A-Za-z]*)?(?:Error|Exception))\b/
const ALLERGY = /al[eé]rg|cel[ií]a(?:c|qu)|intoleran|anafil|gluten|lactosa/i
/**
 * The web's own report of a failed or slow API call (`buildApiProblemMessage` in @ona/shared, numbers
 * stored as `<n>`): a fixed format over a route pattern that only keeps lowercase route words.
 */
const API_PROBLEM =
  /^API (?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/[a-z_.:/-]{0,200}(?: → HTTP (?:<n>|\d{3})|: sin respuesta \(red\)|: más de (?:<n>|\d+) s sin respuesta)$/

/** A route or page without the query string and with ids as `:id`; anything odd becomes 'otra'. */
export function normalisePath(raw: unknown): string | null {
  if (typeof raw !== 'string' || !raw) return null
  const path = raw.split(/[?#]/)[0].replace(UUID, ':id').replace(/\/\d+(?=\/|$)/g, '/:id')
  return SAFE_PATH.test(path) ? path.slice(0, 120) : 'otra'
}

/**
 * The error class at the start of a message ('TypeError', 'ZodError'…), or the web's report of a
 * failed API call as is ('API GET /menu/:id/:id → HTTP <n>'); never anything else of the message.
 */
export function errorType(message: unknown): string {
  const text = String(message ?? '').trim()
  if (API_PROBLEM.test(text)) return text
  const m = ERROR_CLASS.exec(text)
  return m ? m[1] : 'other'
}

const pick = (o: object, keys: readonly string[]) =>
  Object.fromEntries(keys.map((k) => [k, (o as Record<string, unknown>)[k] ?? null]))

export interface FeedbackLike {
  channel: string
  page: string | null
  text: string
  createdAt: Date
}

export function feedbackForAgents(days: number, rows: ReadonlyArray<FeedbackLike>) {
  const byChannel: Record<string, number> = {}
  const byPage: Record<string, number> = {}
  const possibleAllergies: Array<{ date: string; channel: string }> = []
  for (const r of rows) {
    byChannel[r.channel] = (byChannel[r.channel] ?? 0) + 1
    const page = normalisePath(r.page) ?? 'none'
    byPage[page] = (byPage[page] ?? 0) + 1
    if (ALLERGY.test(r.text)) possibleAllergies.push({ date: r.createdAt.toISOString().slice(0, 10), channel: r.channel })
  }
  return { days, count: rows.length, byChannel, byPage, possibleAllergies }
}

const ERROR_FIELDS = ['id', 'kind', 'release', 'userAgentFamily', 'count', 'firstSeen', 'lastSeen', 'resolvedAt'] as const

export function errorsForAgents<T extends { groups: ReadonlyArray<object> }>(report: T) {
  return {
    ...report,
    groups: report.groups.map((g) => ({
      ...pick(g, ERROR_FIELDS),
      type: errorType((g as Record<string, unknown>).message),
      path: normalisePath((g as Record<string, unknown>).path),
    })),
  }
}

const FLAG_FIELDS = ['date', 'channel', 'category', 'source', 'reviewerCategory', 'severity'] as const

export function flagsForAgents<T extends { items: ReadonlyArray<object> }>(report: T) {
  return { ...report, items: report.items.map((i) => pick(i, FLAG_FIELDS)) }
}
