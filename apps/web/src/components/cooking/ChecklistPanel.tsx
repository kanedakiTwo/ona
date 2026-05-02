"use client"

import { AnimatePresence, motion } from "motion/react"
import { Check, X } from "lucide-react"
import type { RecipeIngredient } from "@ona/shared"
import { formatQuantity, groupIngredientsBySection } from "@/lib/recipeView"

interface ChecklistPanelProps {
  open: boolean
  onClose: () => void
  ingredients: RecipeIngredient[]
  /** Set of `RecipeIngredient.id` that the user has checked off. */
  checkedIngredientIds: Set<string>
  onToggle: (ingredientId: string) => void
}

/**
 * Slide-up sheet that lists every ingredient (post-scaling) with a
 * checkbox. Checks survive step navigation, scaler changes, and panel
 * open/close — they live on the cooking shell's state.
 */
export function ChecklistPanel({
  open,
  onClose,
  ingredients,
  checkedIngredientIds,
  onToggle,
}: ChecklistPanelProps) {
  const groups = groupIngredientsBySection(ingredients)

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-[#1A1612]/40 backdrop-blur-sm"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.aside
            key="sheet"
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 30, stiffness: 320 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={0.2}
            onDragEnd={(_, info) => {
              if (info.offset.y > 100) onClose()
            }}
            className="fixed inset-x-0 bottom-0 z-[120] mx-auto max-h-[85vh] max-w-[480px] overflow-y-auto rounded-t-[28px] bg-[#FAF6EE] pb-[max(env(safe-area-inset-bottom),16px)] shadow-[0_-12px_40px_-8px_rgba(26,22,18,0.25)]"
            role="dialog"
            aria-modal="true"
            aria-label="Lista de ingredientes"
          >
            {/* Drag handle + header */}
            <div className="sticky top-0 z-10 bg-[#FAF6EE] px-5 pt-3 pb-4">
              <div className="mx-auto h-1 w-10 rounded-full bg-[#DDD6C5]" />
              <div className="mt-3 flex items-center justify-between">
                <h2 className="font-display text-[1.4rem] text-[#1A1612]">
                  <span className="font-italic italic">Ingredientes</span>
                </h2>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Cerrar lista"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-[#DDD6C5] bg-[#FAF6EE] text-[#1A1612] transition-transform active:scale-95"
                >
                  <X size={16} />
                </button>
              </div>
            </div>

            {/* Grouped ingredients */}
            <div className="px-5 pb-6 space-y-6">
              {groups.map((group, gi) => (
                <section key={`${group.section ?? "_"}-${gi}`}>
                  {group.section && (
                    <div className="text-eyebrow mb-2 text-[#7A7066]">
                      {group.section}
                    </div>
                  )}
                  <ul className="space-y-1">
                    {group.ingredients.map((ing) => {
                      const checked = checkedIngredientIds.has(ing.id)
                      return (
                        <li key={ing.id}>
                          <button
                            type="button"
                            onClick={() => onToggle(ing.id)}
                            className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors active:bg-[#F2EDE0] ${
                              checked ? "opacity-60" : ""
                            }`}
                            aria-pressed={checked}
                          >
                            <span
                              className={`flex h-6 w-6 flex-none items-center justify-center rounded-md border-2 transition-colors ${
                                checked
                                  ? "border-[#52B788] bg-[#52B788] text-[#FAF6EE]"
                                  : "border-[#DDD6C5] bg-[#FAF6EE]"
                              }`}
                            >
                              {checked && <Check size={14} strokeWidth={3} />}
                            </span>
                            <span
                              className={`flex-1 text-[14px] leading-snug text-[#1A1612] ${
                                checked ? "line-through" : ""
                              }`}
                            >
                              <span className="font-mono tabular-nums text-[12px] text-[#7A7066]">
                                {formatQuantity(ing.quantity, ing.unit)}
                              </span>{" "}
                              {ing.ingredientName}
                              {ing.optional && (
                                <span className="ml-1.5 text-[11px] uppercase tracking-[0.1em] text-[#7A7066]">
                                  opcional
                                </span>
                              )}
                              {ing.note && (
                                <span className="block text-[12px] italic text-[#7A7066]">
                                  {ing.note}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
