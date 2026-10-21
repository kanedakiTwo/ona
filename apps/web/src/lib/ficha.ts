/**
 * «Tu ficha» (PRO-318): pure helpers for the screen — dates in the reader's
 * words («Anoche», «Hace 3 días»), the portrait's opening for the Perfil
 * card, which facts each chip shows, when the household is still new, and
 * the titles that depend on the fact's sentence. No React, no fetch: the
 * e2e spec (`e2e/profile-ficha.spec.ts`) runs them directly.
 */
import { FICHA_TOPICS, isAllowedMinorAlias, type FichaChangeView, type FichaFactView, type FichaPersonView, type FichaTopic, type FichaView } from "@ona/shared"

const TZ = "Europe/Madrid"

/** `YYYY-MM-DD` of a moment, in Madrid. */
export function madridDay(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d)
}

function madridHour(d: Date): number {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", hourCycle: "h23" }).format(d))
}

function madridTime(d: Date): string {
  return new Intl.DateTimeFormat("es-ES", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d)
}

/** Whole days between two `YYYY-MM-DD` (b − a). */
function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
}

/** «16 de octubre» (with the year when it isn't this one). `day` is `YYYY-MM-DD`. */
export function longDate(day: string, now: Date = new Date()): string {
  const d = new Date(`${day}T12:00:00Z`)
  const sameYear = day.slice(0, 4) === madridDay(now).slice(0, 4)
  return new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "long", ...(sameYear ? {} : { year: "numeric" }) }).format(d)
}

/** «16 oct» for the evidence list (with the year when it isn't this one). */
export function shortDate(day: string, now: Date = new Date()): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return day
  const d = new Date(`${day}T12:00:00Z`)
  const sameYear = day.slice(0, 4) === madridDay(now).slice(0, 4)
  return new Intl.DateTimeFormat("es-ES", { timeZone: "UTC", day: "numeric", month: "short", ...(sameYear ? {} : { year: "numeric" }) })
    .format(d)
    .replace(".", "")
}

/**
 * When something happened, as a heading: «Anoche» (the nightly refiner runs
 * at 03:00), «Hoy», «Ayer», «Hace 3 días», «Hace una semana»… then the date.
 */
export function dayLabel(at: string | Date, now: Date = new Date()): string {
  const d = typeof at === "string" ? new Date(at) : at
  const diff = daysBetween(madridDay(d), madridDay(now))
  const hour = madridHour(d)
  if (diff <= 0) return hour < 6 ? "Anoche" : "Hoy"
  if (diff === 1) return hour >= 21 ? "Anoche" : "Ayer"
  if (diff < 7) return `Hace ${diff} días`
  if (diff < 14) return "Hace una semana"
  if (diff < 21) return "Hace dos semanas"
  if (diff < 28) return "Hace tres semanas"
  return `El ${longDate(madridDay(d), now)}`
}

/** «hoy a las 03:10» · «ayer a las 03:10» · «el 16 de octubre», for «Actualizado …». */
export function portraitUpdated(at: string, now: Date = new Date()): string {
  const d = new Date(at)
  const diff = daysBetween(madridDay(d), madridDay(now))
  if (diff <= 0) return `hoy a las ${madridTime(d)}`
  if (diff === 1) return `ayer a las ${madridTime(d)}`
  return `el ${longDate(madridDay(d), now)}`
}

/** The ficha's last change (portrait, history or a fact), or null when it has nothing. */
export function lastUpdate(view: Pick<FichaView, "portrait" | "recent" | "facts">): string | null {
  const times = [view.portrait?.updatedAt, view.recent[0]?.at, ...view.facts.map((f) => f.updatedAt)].filter((x): x is string => !!x)
  if (!times.length) return null
  return times.reduce((a, b) => (Date.parse(a) >= Date.parse(b) ? a : b))
}

/** «Actualizada anoche» · «Actualizada hace 3 días» · «Actualizada el 2 de octubre». */
export function updatedLabel(at: string, now: Date = new Date()): string {
  const label = dayLabel(at, now)
  return `Actualizada ${label[0].toLowerCase()}${label.slice(1)}`
}

/** The portrait's first sentence for the Perfil card, cut at a word with «…» (≤ `max` characters). */
export function portraitOpening(text: string, max = 110): string {
  const clean = text.replace(/\s+/g, " ").trim()
  const first = clean.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? clean
  const base = first.replace(/[.!?]$/, "")
  if (base.length <= max) return `${base}…`
  const cut = base.slice(0, max)
  return `${cut.slice(0, cut.lastIndexOf(" ") > 40 ? cut.lastIndexOf(" ") : max).replace(/[,;:]$/, "")}…`
}

/** «23 cosas que sé». */
export function factsCountLabel(n: number): string {
  return n === 1 ? "1 cosa que sé" : `${n} cosas que sé`
}

/**
 * The pending question this reader may answer: the API answers 403 to a
 * question about another member, so that one isn't shown here.
 */
export function visibleQuestion(view: Pick<FichaView, "question" | "people">) {
  const q = view.question
  if (!q) return null
  if (q.subjectKey.startsWith("u:")) {
    const viewer = view.people.find((p) => p.isViewer)
    if (q.subjectKey !== viewer?.key) return null
  }
  return q
}

/** A household that is just starting: no portrait yet and almost nothing known (the «Hogar nuevo» screen). */
export const FEW_FACTS = 6
export function isNewHousehold(view: Pick<FichaView, "portrait" | "facts">): boolean {
  return !view.portrait && view.facts.length <= FEW_FACTS
}

/** The facts a chip shows. */
export function factsOf(view: Pick<FichaView, "facts">, key: string): FichaFactView[] {
  return view.facts.filter((f) => f.subjectKey === key)
}

/** Body measurements live in Perfil («Datos físicos»): the ficha links there instead of listing them. */
export function isPhysicalFact(f: Pick<FichaFactView, "type">): boolean {
  return f.type.startsWith("physical.")
}

/** Facts grouped by topic in screen order; empty topics left out. */
export function byTopic(facts: FichaFactView[]): Array<{ topic: FichaTopic; facts: FichaFactView[] }> {
  return FICHA_TOPICS.map((topic) => ({ topic, facts: facts.filter((f) => f.topic === topic) })).filter((g) => g.facts.length > 0)
}

/** «Lo último que he aprendido»: what was added or changed lately (at most `max`). */
export function recentlyLearnt(recent: FichaChangeView[], max = 3): FichaChangeView[] {
  return recent.filter((c) => c.action === "added" || c.action === "updated").slice(0, max)
}

/** History grouped under its day heading, newest first. */
export function groupChangesByDay(changes: FichaChangeView[], now: Date = new Date()): Array<{ label: string; changes: FichaChangeView[] }> {
  const groups: Array<{ label: string; changes: FichaChangeView[] }> = []
  for (const c of changes) {
    const label = dayLabel(c.at, now)
    const last = groups[groups.length - 1]
    if (last && last.label === label) last.changes.push(c)
    else groups.push({ label, changes: [c] })
  }
  return groups
}

function lowerFirst(s: string): string {
  if (!s) return s
  // Keep acronyms and names that start with two capitals.
  if (s.length > 1 && s[1] === s[1].toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(s[1])) return s
  return s[0].toLowerCase() + s.slice(1)
}

/** Sentences that open with a verb or a pronoun are clauses («No os gusta el cilantro», «Tenéis horno»). */
const VERB_START = /^(no|te|os|le|tenéis|tienes|tiene|cocinas|cocináis|cocina|compras|compráis|compra|prefieres|preferís|prefiere|vives|vivís|vive)\b/i
/** With an article they are clauses only without a comma («Los viernes cenamos pizza», not «Los jueves, la cena con…»). */
const ARTICLE_START = /^(el|la|los|las)\b/i

/** «¿Olvido que los jueves cenáis algo rápido?», or «¿Olvido «Presupuesto: 80 € a la semana»?» when the sentence isn't a clause. */
export function forgetTitle(sentence: string): string {
  const s = sentence.trim().replace(/\.$/, "")
  const clause = !s.includes(":") && (VERB_START.test(s) || (ARTICLE_START.test(s) && !s.includes(",")))
  return clause ? `¿Olvido que ${lowerFirst(s)}?` : `¿Olvido «${s}»?`
}

/** A chip's name inside a sentence: «el pequeño», «ti», «Marta», «la casa». */
export function personInSentence(p: Pick<FichaPersonView, "kind" | "label" | "isViewer">): string {
  if (p.kind === "household") return "la casa"
  if (p.isViewer) return "ti"
  // «El pequeño», «Hija 2»: generic words, lower-case inside a sentence; a name keeps its capital.
  return /^(El|La|Los|Las) /.test(p.label) || isAllowedMinorAlias(p.label) ? p.label[0].toLowerCase() + p.label.slice(1) : p.label
}

/** «Quitar al pequeño de la casa» / «a la abuela». */
export function toPerson(label: string): string {
  const name = personInSentence({ kind: "person", label, isViewer: false })
  return /^el /i.test(name) ? `al ${name.slice(3)}` : `a ${name}`
}

export const AGE_BANDS = ["0-2", "3-5", "6-12", "13-17", "adulto"] as const

/** «De 6 a 12 años» · «Adulto». */
export function ageBandLabel(band: string | null): string {
  if (!band) return ""
  if (band === "adulto") return "Adulto"
  const [a, b] = band.split("-")
  return `De ${a} a ${b} años`
}

/** Short label for the age pills: «6–12 años». */
export function ageBandPill(band: string): string {
  if (band === "adulto") return "Adulto"
  return `${band.replace("-", "–")} años`
}

export function isMinorBand(band: string | null): boolean {
  return !!band && band !== "adulto"
}

/** Mimo's opening words for «Añadir algo que deba saber» on a chip. */
export function addDraftFor(p: Pick<FichaPersonView, "kind" | "label" | "isViewer"> | undefined): string {
  if (!p || p.kind === "household") return "Recuerda que en casa "
  if (p.isViewer) return "Recuerda que yo "
  return `Recuerda que ${personInSentence(p)} `
}

/** End of a picked day (local time) as the API's `validUntil`. */
export function endOfDayIso(day: string): string {
  const [y, m, d] = day.split("-").map(Number)
  return new Date(y, m - 1, d, 23, 59, 59).toISOString()
}

/** Today's `YYYY-MM-DD` in local time, for the date field's minimum. */
export function todayLocal(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0")
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** The `YYYY-MM-DD` (local) of an ISO moment, to prefill the date field. */
export function localDay(iso: string): string {
  return todayLocal(new Date(iso))
}
