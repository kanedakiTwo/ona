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
            className="fixed inset-0 z-[110] bg-ink/40"
            onClick={onClose}
            aria-hidden="true"
          />
          {/* Bottom sheet below lg, centred dialog at lg+ (same shape as MenuSheet). */}
          <motion.div key="sheet-wrap" className="pointer-events-none fixed inset-0 z-[120] flex items-end justify-center lg:items-center lg:p-6">
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
              className="pointer-events-auto max-h-[85vh] w-full max-w-[480px] overflow-y-auto rounded-t-[28px] bg-paper pb-[max(env(safe-area-inset-bottom),16px)] shadow-[0_-12px_40px_-12px_rgba(26,22,18,0.3)] lg:max-w-[560px] lg:rounded-[28px] lg:pb-4"
              role="dialog"
              aria-modal="true"
              aria-label="Lista de ingredientes"
            >
              {/* Drag handle + header */}
              <div className="sticky top-0 z-10 bg-paper px-5 pt-3 pb-3">
                <div className="mx-auto h-1 w-10 rounded-full bg-border lg:hidden" aria-hidden="true" />
                <div className="mt-3 flex items-center justify-between gap-3">
                  <h2 className="font-serif-text text-[1.4rem] font-[650] leading-tight text-ink">
                    Ingredientes
                  </h2>
                  <button
                    type="button"
                    onClick={onClose}
                    aria-label="Cerrar lista"
                    className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-cream-deep hover:text-ink"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>

              {/* Grouped ingredients */}
              <div className="space-y-5 px-5 pb-6">
                {groups.map((group, gi) => (
                  <section key={`${group.section ?? "_"}-${gi}`}>
                    {group.section && (
                      <div className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                        {group.section}
                      </div>
                    )}
                    <ul>
                      {group.ingredients.map((ing) => {
                        const checked = checkedIngredientIds.has(ing.id)
                        return (
                          <li key={ing.id} className="border-b border-dashed border-border last:border-b-0">
                            <button
                              type="button"
                              onClick={() => onToggle(ing.id)}
                              className={`flex min-h-11 w-full items-center gap-3 rounded-xl px-1 py-2.5 text-left transition-colors hover:bg-cream active:bg-cream-deep ${
                                checked ? "opacity-60" : ""
                              }`}
                              aria-pressed={checked}
                            >
                              <span
                                className={`flex h-6 w-6 flex-none items-center justify-center rounded-md border-2 transition-colors ${
                                  checked
                                    ? "border-ink bg-ink text-paper"
                                    : "border-border bg-paper"
                                }`}
                              >
                                {checked && <Check size={14} strokeWidth={3} />}
                              </span>
                              <span
                                className={`flex-1 text-[16px] leading-snug text-ink ${
                                  checked ? "line-through decoration-ink-muted/60" : ""
                                }`}
                              >
                                <span className="font-mono text-[13px] tabular-nums text-ink-muted">
                                  {formatQuantity(ing.quantity, ing.unit)}
                                </span>{" "}
                                {ing.ingredientName}
                                {ing.optional && (
                                  <span className="ml-1.5 rounded-full bg-cream-deep px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] text-ink-muted">
                                    opcional
                                  </span>
                                )}
                                {ing.note && (
                                  <span className="block text-[13px] italic text-ink-muted">
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
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
