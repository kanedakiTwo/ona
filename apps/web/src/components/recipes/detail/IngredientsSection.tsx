"use client"

import { motion } from "motion/react"
import type { RecipeIngredient } from "@ona/shared"
import {
  formatQuantity,
  groupIngredientsBySection,
} from "@/lib/recipeView"

/**
 * Ingredient may carry rounding metadata when it came from the scaler
 * (`?servings=N`). The detail page passes the raw `recipe.ingredients`
 * array; we accept either shape.
 */
type DisplayIngredient = RecipeIngredient & {
  rounded?: boolean
  roundingNote?: string
}

interface Props {
  ingredients: DisplayIngredient[]
  /** Number to display next to the heading ("Para 4") */
  targetServings: number
  /** Eyebrow chapter number, e.g. "01" */
  chapter: string
}

export function IngredientsSection({ ingredients, targetServings, chapter }: Props) {
  const groups = groupIngredientsBySection(ingredients)
  let runningIdx = 0

  return (
    <section className="mt-10">
      <div className="mb-5 flex items-end justify-between">
        <div>
          <div className="text-eyebrow text-[#7A7066]">Capítulo {chapter}</div>
          <h2 className="font-display text-[1.6rem] leading-tight text-[#1A1612]">
            <span className="font-italic italic">Ingredientes</span>
          </h2>
        </div>
        <span className="text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">
          Para {targetServings}
        </span>
      </div>

      <div className="space-y-6">
        {groups.map((group, gi) => (
          <div key={gi}>
            {group.section && (
              <h3 className="mb-2 font-italic italic text-[14px] text-[#4A4239]">
                {group.section}
              </h3>
            )}
            <ul className="divide-y divide-dashed divide-[#DDD6C5] border-y border-dashed border-[#DDD6C5]">
              {group.ingredients.map((ing) => {
                const i = runningIdx++
                return (
                  <motion.li
                    key={ing.id ?? i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.03, duration: 0.4 }}
                    className="flex items-baseline justify-between gap-3 py-3"
                  >
                    <div className="flex flex-1 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                      <span className="text-[15px] capitalize text-[#1A1612]">
                        {ing.ingredientName ?? "Ingrediente"}
                      </span>
                      {ing.optional && (
                        <span className="rounded-full bg-[#F2EDE0] px-1.5 py-0.5 text-[9px] uppercase tracking-[0.1em] text-[#7A7066]">
                          opcional
                        </span>
                      )}
                      {ing.note && (
                        <span className="text-[12px] italic text-[#A39A8E]">
                          {ing.note}
                        </span>
                      )}
                      {ing.roundingNote && (
                        <span className="text-[10px] text-[#A39A8E]">
                          ({ing.roundingNote})
                        </span>
                      )}
                    </div>
                    <span className="font-mono whitespace-nowrap text-[11px] tracking-tight text-[#7A7066]">
                      {formatQuantity(ing.quantity, ing.unit)}
                    </span>
                  </motion.li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
