/**
 * The one-line statuses of the /profile rows (PRO-1202): «Cómo cocináis»
 * (tiempo, aparatos, nivel) and «Lo que os gusta» (cocinas, «No os gusta»).
 * Pure, so they're tested without a browser.
 */
import { dayTimeBudget, formatDayTimeBudget, type DayTimeBudget } from "@ona/shared"

const SKILL: Record<string, string> = { easy: "Nivel fácil", medium: "Nivel medio", advanced: "Nivel avanzado" }

function minutes(b: DayTimeBudget): string {
  return b.mode === "activo" ? formatDayTimeBudget(b) : `${b.minutes} min`
}

/** «30 min entre semana · 90 min el finde», from `time_available` (Monday and Saturday stand for each half). */
export function timeLine(timeAvailable: unknown): string | null {
  const weekday = dayTimeBudget(timeAvailable, 0)
  const weekend = dayTimeBudget(timeAvailable, 5)
  const parts = [weekday && `${minutes(weekday)} entre semana`, weekend && `${minutes(weekend)} el finde`].filter(Boolean)
  return parts.length > 0 ? parts.join(" · ") : null
}

/** «Horno, freidora de aire, Thermomix». */
export function listLine(values: unknown, max = 4): string | null {
  if (!Array.isArray(values)) return null
  const items = values.filter((v): v is string => typeof v === "string" && v.trim() !== "")
  if (items.length === 0) return null
  const shown = items.slice(0, max).join(", ")
  const first = shown.charAt(0).toUpperCase() + shown.slice(1)
  return items.length > max ? `${first} y ${items.length - max} más` : first
}

export function skillLine(skill: unknown): string | null {
  return typeof skill === "string" ? (SKILL[skill] ?? null) : null
}

/** «Española ♥, Italiana, Asiática»: `cuisine_bias` from most to least liked; ♥ from 70 up. */
export function cuisinesLine(bias: unknown, max = 3): string | null {
  if (!bias || typeof bias !== "object" || Array.isArray(bias)) return null
  const entries = Object.entries(bias as Record<string, unknown>)
    .filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 0)
    .sort((a, b) => b[1] - a[1])
  if (entries.length === 0) return null
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
  return entries
    .slice(0, max)
    .map(([k, v]) => (v >= 70 ? `${cap(k)} ♥` : cap(k)))
    .join(", ")
}

/** What nobody in the house likes, once each (the people of «Quién come» and the viewer's memory). */
export function dislikesOfHouse(lists: Array<string[] | null | undefined>): string[] {
  const seen = new Map<string, string>()
  for (const list of lists) for (const d of list ?? []) {
    const key = d.trim().toLocaleLowerCase("es")
    if (key && !seen.has(key)) seen.set(key, d.trim())
  }
  return [...seen.values()]
}
