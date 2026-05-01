"use client"

import { motion } from "motion/react"
import { ChefHat, Clock, Flame } from "lucide-react"
import type { RecipeIngredient, RecipeStep } from "@ona/shared"
import { formatQuantity } from "@/lib/recipeView"

interface Props {
  steps: RecipeStep[]
  ingredients: RecipeIngredient[]
  /** Eyebrow chapter number, e.g. "02" */
  chapter: string
  isCooking: boolean
  onCookingToggle: () => void
}

export function StepsSection({
  steps,
  ingredients,
  chapter,
  isCooking,
  onCookingToggle,
}: Props) {
  // Index ingredients by id for quick lookup of step.ingredientRefs.
  const ingsById = new Map<string, RecipeIngredient>()
  for (const ing of ingredients) {
    if (ing.id) ingsById.set(ing.id, ing)
  }

  return (
    <section className="mt-12">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <div className="text-eyebrow text-[#7A7066]">Capítulo {chapter}</div>
          <h2 className="font-display text-[1.6rem] leading-tight text-[#1A1612]">
            <span className="font-italic italic">Preparación</span>
          </h2>
        </div>
        <button
          onClick={onCookingToggle}
          className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-medium transition-all active:scale-95 ${
            isCooking
              ? "bg-[#C65D38] text-[#FAF6EE]"
              : "bg-[#1A1612] text-[#FAF6EE] hover:bg-[#2D6A4F]"
          }`}
          aria-pressed={isCooking}
        >
          <ChefHat size={13} />
          {isCooking ? "Salir de cocina" : "Empezar a cocinar"}
        </button>
      </div>

      <ol className="space-y-7">
        {steps.map((step, i) => {
          const refIngredients = (step.ingredientRefs ?? [])
            .map((id) => ingsById.get(id))
            .filter((x): x is RecipeIngredient => !!x)
          return (
            <motion.li
              key={i}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + i * 0.05, duration: 0.5 }}
              className="flex gap-4"
            >
              <span className="font-display text-[2.5rem] leading-none text-[#C65D38]/30 -mt-1">
                {String((step.index ?? i) + 1).padStart(2, "0")}
              </span>
              <div className="flex-1 pt-1">
                {/* Chips row */}
                {(step.temperature != null ||
                  step.technique ||
                  (step.durationMin != null && step.durationMin > 0)) && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {step.temperature != null && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#FDEEE8] px-2 py-0.5 text-[10px] font-medium text-[#B5451B]">
                        <Flame size={10} />
                        {step.temperature} °C
                      </span>
                    )}
                    {step.technique && (
                      <span className="rounded-full bg-[#F2EDE0] px-2 py-0.5 text-[10px] uppercase tracking-[0.1em] text-[#4A4239]">
                        {step.technique}
                      </span>
                    )}
                    {step.durationMin != null && step.durationMin > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#F2EDE0] px-2 py-0.5 text-[10px] text-[#4A4239]">
                        <Clock size={10} />
                        {step.durationMin}'
                      </span>
                    )}
                  </div>
                )}

                <p className="text-[14px] leading-relaxed text-[#1A1612]">
                  {step.text}
                </p>

                {/* Referenced ingredients */}
                {refIngredients.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {refIngredients.map((ing) => (
                      <span
                        key={ing.id}
                        className="rounded-full border border-[#DDD6C5] bg-[#FAF6EE] px-2 py-0.5 text-[10px] text-[#4A4239]"
                      >
                        <span className="capitalize">
                          {ing.ingredientName ?? "Ingrediente"}
                        </span>{" "}
                        <span className="font-mono text-[#7A7066]">
                          · {formatQuantity(ing.quantity, ing.unit)}
                        </span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </motion.li>
          )
        })}
      </ol>
    </section>
  )
}
