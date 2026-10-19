"use client"

import { useEffect, useState } from "react"
import type { WeekPlan } from "@ona/shared"
import { buildWeekPlan } from "@/lib/weekPlanForm"

const DAY_SHORT = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"]
const MEAL_LABEL: Record<string, string> = { breakfast: "Desayuno", lunch: "Comida", snack: "Merienda", dinner: "Cena" }

/**
 * PRO-225 · «Antes de planificar»: two optional taps above «Generar mi menú»
 * («¿Alguna comida fuera de casa?», «¿Viene alguien?»). Closed by default:
 * skipping them is just generating. What's answered shapes only this week.
 */
export function WeekPlanQuestions({
  meals,
  defaultDiners,
  onChange,
}: {
  /** Meals of each day (0 = lunes), from the blank week. */
  meals: string[][]
  defaultDiners: number
  onChange: (plan: WeekPlan | undefined) => void
}) {
  const [open, setOpen] = useState<"out" | "guests" | null>(null)
  const [out, setOut] = useState<Set<string>>(new Set())
  const [guests, setGuests] = useState<Record<number, number>>({})

  useEffect(() => {
    onChange(buildWeekPlan(out, guests))
  }, [out, guests, onChange])

  const toggleOut = (key: string) =>
    setOut((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  const toggleGuestDay = (day: number) =>
    setGuests((prev) => {
      const next = { ...prev }
      if (day in next) delete next[day]
      else next[day] = defaultDiners + 2
      return next
    })
  const stepGuests = (day: number, delta: number) =>
    setGuests((prev) => ({ ...prev, [day]: Math.min(24, Math.max(1, (prev[day] ?? defaultDiners) + delta)) }))

  const pill = (active: boolean) =>
    `inline-flex min-h-[40px] items-center rounded-full border px-4 text-[13.5px] transition-colors ${
      active ? "border-ink bg-ink text-cream" : "border-border bg-paper text-ink-mid hover:border-ink hover:text-ink"
    }`
  const chip = (active: boolean) =>
    `min-h-[36px] rounded-full border px-3 text-[13px] transition-colors ${
      active ? "border-terracotta bg-terracotta/10 text-terracotta" : "border-border bg-cream text-ink-mid hover:border-ink"
    }`

  const outCount = out.size
  const guestCount = Object.keys(guests).length

  return (
    <div className="mx-auto mt-5 max-w-sm text-left" data-testid="week-plan-questions">
      <p className="text-center text-[12.5px] uppercase tracking-[0.08em] text-ink-soft">Antes de generar · opcional</p>
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          aria-expanded={open === "out"}
          onClick={() => setOpen(open === "out" ? null : "out")}
          className={pill(open === "out" || outCount > 0)}
        >
          ¿Alguna comida fuera de casa?{outCount > 0 ? ` · ${outCount}` : ""}
        </button>
        <button
          type="button"
          aria-expanded={open === "guests"}
          onClick={() => setOpen(open === "guests" ? null : "guests")}
          className={pill(open === "guests" || guestCount > 0)}
        >
          ¿Viene alguien?{guestCount > 0 ? ` · ${guestCount}` : ""}
        </button>
      </div>

      {open === "out" && (
        <div className="mt-3 rounded-[18px] border border-border bg-cream px-3 py-3" role="group" aria-label="Comidas fuera de casa">
          <p className="mb-2 text-[13px] text-ink-soft">Toca las comidas que hacéis fuera. Solo cambia esta semana.</p>
          <ul className="space-y-1.5">
            {meals.map((dayMeals, day) => (
              <li key={day} className="flex items-center gap-2">
                <span className="w-9 text-[13px] font-medium text-ink">{DAY_SHORT[day]}</span>
                <div className="flex flex-wrap gap-1.5">
                  {dayMeals.map((meal) => {
                    const key = `${day}:${meal}`
                    const active = out.has(key)
                    return (
                      <button
                        key={key}
                        type="button"
                        aria-pressed={active}
                        aria-label={`${DAY_SHORT[day]} · ${MEAL_LABEL[meal] ?? meal} fuera`}
                        onClick={() => toggleOut(key)}
                        className={chip(active)}
                      >
                        {MEAL_LABEL[meal] ?? meal}
                        {active ? " · fuera" : ""}
                      </button>
                    )
                  })}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {open === "guests" && (
        <div className="mt-3 rounded-[18px] border border-border bg-cream px-3 py-3" role="group" aria-label="Días con invitados">
          <p className="mb-2 text-[13px] text-ink-soft">¿Qué día? Luego dime cuántos coméis en total.</p>
          <div className="flex flex-wrap gap-1.5">
            {DAY_SHORT.map((label, day) => (
              <button
                key={label}
                type="button"
                aria-pressed={day in guests}
                onClick={() => toggleGuestDay(day)}
                className={chip(day in guests)}
              >
                {label}
              </button>
            ))}
          </div>
          {guestCount > 0 && (
            <ul className="mt-3 space-y-1.5">
              {Object.entries(guests).map(([d, n]) => {
                const day = Number(d)
                return (
                  <li key={d} className="flex items-center justify-between gap-2 text-[14px] text-ink">
                    <span>{DAY_SHORT[day]}: somos</span>
                    <span className="flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Uno menos el ${DAY_SHORT[day]}`}
                        onClick={() => stepGuests(day, -1)}
                        className="h-9 w-9 rounded-full border border-border bg-paper text-ink"
                      >
                        −
                      </button>
                      <span className="w-6 text-center font-medium" data-testid={`guests-${day}`}>
                        {n}
                      </span>
                      <button
                        type="button"
                        aria-label={`Uno más el ${DAY_SHORT[day]}`}
                        onClick={() => stepGuests(day, 1)}
                        className="h-9 w-9 rounded-full border border-border bg-paper text-ink"
                      >
                        +
                      </button>
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
