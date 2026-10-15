"use client"

/**
 * «Añadir comida → Del congelador» (PRO-82): put a táper from the freezer in
 * one of the day's missing meals. Step 1 (only when the day lacks more than
 * one meal): which meal. Step 2: the recipe it is, from the same picker as
 * «Elegir otra receta». The dish is saved with `variant: 'freezer'`, shows
 * «Del congelador» and never adds to the shopping list.
 */
import { useEffect, useState } from "react"
import { Snowflake } from "lucide-react"
import { mealLabel } from "@/lib/labels"
import type { MealKey } from "@/lib/menuDay"
import { MenuSheet, SheetAction } from "./MenuSheet"
import { RecipePickerSheet } from "./RecipePickerSheet"

export function FreezerDishSheets({
  open,
  onClose,
  missing,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  missing: MealKey[]
  onAdd: (meal: MealKey, recipeId: string) => void
}) {
  const [meal, setMeal] = useState<MealKey | null>(null)
  useEffect(() => {
    if (open) setMeal(missing.length === 1 ? missing[0] : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <>
      <MenuSheet open={open && meal == null} onClose={onClose} eyebrow="Del congelador" title="¿Para qué comida?">
        <div className="flex flex-col gap-0.5">
          {missing.map((m) => (
            <SheetAction key={m} icon={Snowflake} label={mealLabel(m)} onClick={() => setMeal(m)} />
          ))}
        </div>
      </MenuSheet>
      <RecipePickerSheet
        open={open && meal != null}
        onClose={onClose}
        title="Del congelador"
        subtitle={meal ? `${mealLabel(meal)} · no suma a la compra` : undefined}
        onPick={(picked) => {
          if (meal) onAdd(meal, picked.id)
          onClose()
        }}
      />
    </>
  )
}
