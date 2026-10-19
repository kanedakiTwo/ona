import type { WeekPlan } from "@ona/shared"

/**
 * PRO-225 · «Antes de planificar» on /menu: what the two optional questions
 * collected → the `weekPlan` body of `POST /menu/generate`. `out` holds
 * "<day>:<meal>" keys of meals eaten out; `guests` maps a day (0 = lunes) to
 * how many eat at home that day. Undefined when nothing was answered, so
 * skipping the questions sends exactly what «Generar mi menú» always sent.
 */
export function buildWeekPlan(out: Iterable<string>, guests: Record<number, number>): WeekPlan | undefined {
  const mealsOut = [...out]
    .map((key) => {
      const [d, meal] = key.split(":")
      return { day: Number(d), meal: meal as NonNullable<WeekPlan["mealsOut"]>[number]["meal"] }
    })
    .filter((o) => Number.isInteger(o.day) && o.day >= 0 && o.day <= 6 && o.meal)
    .sort((a, b) => a.day - b.day)
  const guestList = Object.entries(guests)
    .map(([d, n]) => ({ day: Number(d), diners: Math.round(n) }))
    .filter((g) => Number.isInteger(g.day) && g.day >= 0 && g.day <= 6 && g.diners >= 1 && g.diners <= 24)
    .sort((a, b) => a.day - b.day)
  if (mealsOut.length === 0 && guestList.length === 0) return undefined
  return {
    ...(mealsOut.length ? { mealsOut } : {}),
    ...(guestList.length ? { guests: guestList } : {}),
  }
}

/** The meals each day of the week has (from the blank week's slots), lunch + dinner when unknown. */
export function mealsByDay(days: Array<Record<string, unknown> | null | undefined> | undefined): string[][] {
  const order = ["breakfast", "lunch", "snack", "dinner"]
  return Array.from({ length: 7 }, (_, i) => {
    const keys = Object.keys(days?.[i] ?? {}).filter((k) => order.includes(k))
    return (keys.length ? keys : ["lunch", "dinner"]).sort((a, b) => order.indexOf(a) - order.indexOf(b))
  })
}
