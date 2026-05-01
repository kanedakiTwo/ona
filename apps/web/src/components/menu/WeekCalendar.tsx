"use client"

import type { DayMenu, LockedSlots } from "@ona/shared"
import { MealSlot } from "@/components/menu/MealSlot"
import { mealLabel } from "@/lib/labels"

const DAY_LABELS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"]

interface WeekCalendarProps {
  days: DayMenu[]
  locked: LockedSlots
  menuId: string
  onRegenerate: () => void
}

export function WeekCalendar({
  days,
  locked,
  menuId,
  onRegenerate,
}: WeekCalendarProps) {
  // Collect all meal types present across the week
  const mealTypes = Array.from(
    new Set(days.flatMap((day) => Object.keys(day)))
  )

  // Sort meal types in a logical order
  const mealOrder = ["breakfast", "lunch", "dinner", "snack"]
  mealTypes.sort(
    (a, b) => (mealOrder.indexOf(a) ?? 99) - (mealOrder.indexOf(b) ?? 99)
  )

  return (
    <div className="overflow-x-auto">
      {/* Desktop: grid layout */}
      <div className="hidden md:block">
        <div
          className="grid gap-px rounded-xl border border-gray-200 bg-gray-200"
          style={{
            gridTemplateColumns: `100px repeat(7, 1fr)`,
          }}
        >
          {/* Header row */}
          <div className="bg-gray-50 p-3" />
          {DAY_LABELS.map((label) => (
            <div
              key={label}
              className="bg-gray-50 p-3 text-center text-sm font-semibold text-gray-700"
            >
              {label}
            </div>
          ))}

          {/* Meal rows */}
          {mealTypes.map((meal) => (
            <>
              <div
                key={`label-${meal}`}
                className="flex items-center bg-white p-3 text-sm font-medium text-gray-600"
              >
                {mealLabel(meal)}
              </div>
              {days.map((day, dayIndex) => {
                const slot = day[meal]
                const isLocked = !!locked?.[String(dayIndex)]?.[meal]
                return (
                  <div
                    key={`${meal}-${dayIndex}`}
                    className="bg-white p-2"
                  >
                    <MealSlot
                      recipeId={slot?.recipeId}
                      recipeName={slot?.recipeName}
                      meal={meal}
                      dayIndex={dayIndex}
                      menuId={menuId}
                      isLocked={isLocked}
                    />
                  </div>
                )
              })}
            </>
          ))}
        </div>
      </div>

      {/* Mobile: stacked columns */}
      <div className="space-y-4 md:hidden">
        {days.map((day, dayIndex) => (
          <div
            key={dayIndex}
            className="rounded-xl border border-gray-200 p-4"
          >
            <h3 className="mb-3 text-sm font-semibold text-gray-700">
              {DAY_LABELS[dayIndex]}
            </h3>
            <div className="space-y-2">
              {mealTypes.map((meal) => {
                const slot = day[meal]
                const isLocked = !!locked?.[String(dayIndex)]?.[meal]
                return (
                  <div key={meal}>
                    <span className="text-xs font-medium text-gray-400">
                      {mealLabel(meal)}
                    </span>
                    <MealSlot
                      recipeId={slot?.recipeId}
                      recipeName={slot?.recipeName}
                      meal={meal}
                      dayIndex={dayIndex}
                      menuId={menuId}
                      isLocked={isLocked}
                    />
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
