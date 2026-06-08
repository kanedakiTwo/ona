"use client"

import { MEAL_LABELS } from '@/lib/labels'
import type { Meal } from '@ona/shared'

const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack']

interface Props {
  value: Partial<Record<Meal, 1 | 2 | 3>>
  onChange: (next: Partial<Record<Meal, 1 | 2 | 3>>) => void
}

export function MealDishCountControls({ value, onChange }: Props) {
  return (
    <section className="space-y-2">
      <h3 className="text-eyebrow text-[#7A7066]">Platos por comida</h3>
      <p className="text-[12px] text-[#7A7066]">
        Cuántos platos rinde cada slot al generar la semana. 1 = un solo plato; 2 = entrante + principal; 3 = entrante + principal + postre.
      </p>
      <div className="space-y-2">
        {MEALS.map((meal) => {
          const current = value[meal] ?? 1
          return (
            <div
              key={meal}
              className="flex items-center justify-between rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] px-4 py-3"
            >
              <span className="text-[14px] text-[#1A1612]">{MEAL_LABELS[meal]}</span>
              <div className="inline-flex gap-1 rounded-full border border-[#DDD6C5] bg-[#FAF6EE] p-0.5">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => onChange({ ...value, [meal]: n as 1 | 2 | 3 })}
                    className={`rounded-full px-3 py-1 text-[12px] ${
                      current === n
                        ? 'bg-[#1A1612] text-[#FAF6EE]'
                        : 'text-[#7A7066]'
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
