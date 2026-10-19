"use client"

/**
 * «Añadir comida → Del congelador» (PRO-82): put a táper from the freezer in
 * one of the day's missing meals. Step 1 (only when the day lacks more than
 * one meal): which meal. Step 2: the recipe it is, from the same picker as
 * «Elegir otra receta». The dish is saved with `variant: 'freezer'`, shows
 * «Del congelador» and never adds to the shopping list. PRO-240: the same
 * for «Táper de la nevera» (`variant: 'fridge'`).
 */
import { useEffect, useState } from "react"
import { Refrigerator, Snowflake } from "lucide-react"
import { mealLabel } from "@/lib/labels"
import type { MealKey } from "@/lib/menuDay"
import { MenuSheet, SheetAction } from "./MenuSheet"
import { RecipePickerSheet } from "./RecipePickerSheet"

export type TaperVariant = "freezer" | "fridge"

export const TAPER_TITLE: Record<TaperVariant, string> = {
  freezer: "Del congelador",
  fridge: "Táper de la nevera",
}

export function FreezerDishSheets({
  open,
  onClose,
  missing,
  onAdd,
  variant = "freezer",
}: {
  open: boolean
  onClose: () => void
  missing: MealKey[]
  onAdd: (meal: MealKey, recipeId: string) => void
  /** `fridge` = «Táper de la nevera» (PRO-240). */
  variant?: TaperVariant
}) {
  const title = TAPER_TITLE[variant]
  const Icon = variant === "fridge" ? Refrigerator : Snowflake
  const [meal, setMeal] = useState<MealKey | null>(null)
  useEffect(() => {
    if (open) setMeal(missing.length === 1 ? missing[0] : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return (
    <>
      <MenuSheet open={open && meal == null} onClose={onClose} eyebrow={title} title="¿Para qué comida?">
        <div className="flex flex-col gap-0.5">
          {missing.map((m) => (
            <SheetAction key={m} icon={Icon} label={mealLabel(m)} onClick={() => setMeal(m)} />
          ))}
        </div>
      </MenuSheet>
      <RecipePickerSheet
        open={open && meal != null}
        onClose={onClose}
        title={title}
        subtitle={meal ? `${mealLabel(meal)} · no suma a la compra` : undefined}
        onPick={(picked) => {
          if (meal) onAdd(meal, picked.id)
          onClose()
        }}
      />
    </>
  )
}
