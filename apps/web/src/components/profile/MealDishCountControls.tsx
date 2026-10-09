"use client"

import { MEAL_LABELS } from '@/lib/labels'
import type { Meal } from '@ona/shared'

const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack']

interface Props {
  value: Partial<Record<Meal, 1 | 2 | 3>>
  onChange: (next: Partial<Record<Meal, 1 | 2 | 3>>) => void
}

/** "Platos por comida" inside the Plantilla semanal card of /profile (D · Luz y foto). */
export function MealDishCountControls({ value, onChange }: Props) {
  return (
    <section className="space-y-2">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Platos por comida</h4>
      <p className="text-[13px] leading-snug text-ink-muted">
        Cuántos platos rinde cada slot al generar la semana. 1 = un solo plato; 2 = entrante + principal; 3 = entrante + principal + postre.
      </p>
      <div className="overflow-hidden rounded-2xl border border-border-soft bg-paper">
        {MEALS.map((meal, i) => {
          const current = value[meal] ?? 1
          return (
            <div
              key={meal}
              className={`flex items-center justify-between gap-3 px-4 py-2 ${i > 0 ? 'border-t border-border-soft' : ''}`}
            >
              <span className="text-[14px] text-ink">{MEAL_LABELS[meal]}</span>
              <div role="group" aria-label={`Platos en ${MEAL_LABELS[meal]}`} className="inline-flex gap-0.5 rounded-full border border-border bg-cream p-0.5">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onChange({ ...value, [meal]: n as 1 | 2 | 3 })}
                    aria-pressed={current === n}
                    className={`h-10 w-10 rounded-full text-[13px] font-medium tabular-nums transition-colors ${
                      current === n
                        ? 'bg-ink text-cream'
                        : 'text-ink-muted hover:text-ink'
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
