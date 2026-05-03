"use client"

import { useState } from "react"
import { useLockMeal, useRegenerateMeal } from "@/hooks/useMenu"
import { Pin, RefreshCw, Replace } from "lucide-react"
import { cn } from "@/lib/utils"
import Link from "next/link"
import { RecipePickerSheet } from "./RecipePickerSheet"

interface MealSlotProps {
  recipeId?: string
  recipeName?: string
  meal: string
  dayIndex: number
  menuId: string
  isLocked: boolean
}

export function MealSlot({
  recipeId,
  recipeName,
  meal,
  dayIndex,
  menuId,
  isLocked,
}: MealSlotProps) {
  const lockMeal = useLockMeal()
  const regenerateMeal = useRegenerateMeal()
  const [pickerOpen, setPickerOpen] = useState(false)

  function handleLock() {
    lockMeal.mutate({
      menuId,
      day: dayIndex,
      meal,
      locked: !isLocked,
    })
  }

  function handleRegenerate() {
    regenerateMeal.mutate({
      menuId,
      day: dayIndex,
      meal,
    })
  }

  function handlePickRecipe(picked: { id: string; name: string }) {
    regenerateMeal.mutate(
      { menuId, day: dayIndex, meal, recipeId: picked.id },
      { onSuccess: () => setPickerOpen(false) },
    )
  }

  const dayNames = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"]
  const mealLabels: Record<string, string> = {
    breakfast: "desayuno",
    lunch: "comida",
    dinner: "cena",
    snack: "snack",
  }

  return (
    <div
      className={cn(
        "group relative flex items-center justify-between rounded-lg p-2 transition-colors",
        isLocked ? "bg-amber-50" : "hover:bg-gray-50"
      )}
    >
      <div className="min-w-0 flex-1">
        {recipeId ? (
          <Link
            href={`/recipes/${recipeId}`}
            className="block truncate text-sm font-medium text-gray-900 hover:text-black hover:underline"
            title={recipeName}
          >
            {recipeName ?? "Receta"}
          </Link>
        ) : (
          <span className="text-sm text-gray-400">Sin plato</span>
        )}
      </div>

      <div className="ml-2 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
        <button
          onClick={handleLock}
          disabled={lockMeal.isPending}
          className={cn(
            "rounded p-1 transition-colors",
            isLocked
              ? "text-amber-600 opacity-100 hover:text-amber-700"
              : "text-gray-400 hover:text-gray-600"
          )}
          title={isLocked ? "Desbloquear" : "Bloquear"}
        >
          <Pin size={14} className={isLocked ? "fill-current" : ""} />
        </button>
        <button
          onClick={() => setPickerOpen(true)}
          disabled={regenerateMeal.isPending || isLocked}
          className="rounded p-1 text-gray-400 transition-colors hover:text-gray-600 disabled:opacity-30"
          title="Elegir otro plato"
        >
          <Replace size={14} />
        </button>
        <button
          onClick={handleRegenerate}
          disabled={regenerateMeal.isPending || isLocked}
          className="rounded p-1 text-gray-400 transition-colors hover:text-gray-600 disabled:opacity-30"
          title="Regenerar plato (aleatorio)"
        >
          <RefreshCw size={14} className={regenerateMeal.isPending ? "animate-spin" : ""} />
        </button>
      </div>

      <RecipePickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={`${mealLabels[meal] ?? meal} del ${dayNames[dayIndex] ?? "día"}`}
        subtitle={recipeName ? `Ahora: ${recipeName}` : "Sin plato"}
        onPick={handlePickRecipe}
      />

      {/* Persistent lock indicator */}
      {isLocked && (
        <Pin
          size={12}
          className="absolute -right-1 -top-1 fill-amber-500 text-amber-500 group-hover:hidden"
        />
      )}
    </div>
  )
}
