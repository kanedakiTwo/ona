"use client"

import { Check, Flame, Wand2 } from "lucide-react"
import type { Recipe, RecipeIngredient, RecipeStep } from "@ona/shared"
import { ingredientDisplayName } from "@ona/shared"
import { formatQuantity } from "@/lib/recipeView"
import { renderInlineMarkdown } from "@/lib/inlineMarkdown"
import { StepTimer } from "./StepTimer"
import type { StepTimer as StepTimerState } from "@/hooks/useStepTimers"

interface StepCardProps {
  step: RecipeStep
  stepNumber: number // 1-based, for display
  totalSteps: number
  ingredients: Recipe["ingredients"]
  /**
   * Pre-computed `ingredientId` → count-of-step-references map for the
   * whole recipe. Built once by the shell so the per-step quantity gets
   * divided correctly when the same ingredient appears in multiple steps.
   */
  refCounts: Map<string, number>
  /** Set of ingredient ids that have been ticked off in the checklist. */
  checkedIngredientIds: Set<string>
  onToggleIngredient: (ingredientId: string) => void
  timerState: StepTimerState | undefined
  onStartTimer: () => void
  onPauseTimer: () => void
  onResumeTimer: () => void
  onResetTimer: () => void
  /** The next step's text — rendered as a faded preview underneath. */
  nextStepText?: string
}

/**
 * Resolve the ingredient rows referenced by a step, dividing each
 * ingredient's total quantity by how many step-references it has across
 * the whole recipe (per-spec: "split equally across step references").
 *
 * Returns the array in the order of `step.ingredientRefs`.
 */
function resolveStepIngredients(
  step: RecipeStep,
  allIngredients: RecipeIngredient[],
  refCounts: Map<string, number>,
): Array<{ id: string; name: string; quantity: string }> {
  const byId = new Map(allIngredients.map((i) => [i.id, i]))
  const out: Array<{ id: string; name: string; quantity: string }> = []
  for (const refId of step.ingredientRefs ?? []) {
    const ing = byId.get(refId)
    if (!ing) continue
    const count = Math.max(1, refCounts.get(refId) ?? 1)
    const scaledQty = ing.quantity / count
    out.push({
      id: ing.id,
      name: ing.ingredientName ? ingredientDisplayName(ing.ingredientName) : "Ingrediente",
      quantity: formatQuantity(scaledQty, ing.unit),
    })
  }
  return out
}

/**
 * Per-recipe map: `ingredientId` → number of steps that reference it.
 * Computed once and passed in (cooking shell does this, not the card).
 */
export function buildIngredientRefCounts(steps: RecipeStep[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of steps) {
    for (const ref of s.ingredientRefs ?? []) {
      m.set(ref, (m.get(ref) ?? 0) + 1)
    }
  }
  return m
}

export function StepCard({
  step,
  stepNumber,
  totalSteps,
  ingredients,
  refCounts,
  checkedIngredientIds,
  onToggleIngredient,
  timerState,
  onStartTimer,
  onPauseTimer,
  onResumeTimer,
  onResetTimer,
  nextStepText,
}: StepCardProps) {
  const stepIngredients = resolveStepIngredients(step, ingredients, refCounts)
  const hasTimer = step.durationMin != null && step.durationMin > 0

  return (
    <article className="mx-auto flex min-h-full w-full max-w-[1180px] flex-col gap-6 px-5 pt-5 pb-6 lg:grid lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:items-start lg:gap-12 lg:px-10 lg:pt-10">
      <div className="flex flex-col gap-5">
        {/* Step number (solid terracotta) + meta pills */}
        <header className="flex flex-col gap-4">
          <div className="flex items-end gap-3">
            <span
              className="font-display text-[64px] leading-[0.8] text-terracotta lg:text-[88px]"
              aria-hidden="true"
            >
              {String(stepNumber).padStart(2, "0")}
            </span>
            <span
              className="pb-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted"
              aria-label={`Paso ${stepNumber} de ${totalSteps}`}
            >
              Paso {stepNumber} / {totalSteps}
            </span>
          </div>

          {(step.technique || step.temperature != null || hasTimer) && (
            <div className="flex flex-wrap items-center gap-2">
              {step.technique && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-cream-deep px-3 py-1.5 text-[13px] font-medium text-ink-mid">
                  <Wand2 size={13} aria-hidden />
                  {step.technique}
                </span>
              )}

              {step.temperature != null && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-warn-bg px-3 py-1.5 text-[13px] font-medium text-terracotta-deep">
                  <Flame size={13} aria-hidden />
                  {step.temperature} °C
                </span>
              )}

              {hasTimer && (
                <StepTimer
                  durationMin={step.durationMin as number}
                  state={timerState}
                  onStart={onStartTimer}
                  onPause={onPauseTimer}
                  onResume={onResumeTimer}
                  onReset={onResetTimer}
                />
              )}
            </div>
          )}
        </header>

        {/* Step text — large, readable at arm's length */}
        <p className="font-serif-text text-[clamp(1.5rem,4.8vw,2.25rem)] leading-[1.3] text-ink">
          {renderInlineMarkdown(step.text)}
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-6 lg:flex-none lg:rounded-[22px] lg:border lg:border-border-soft lg:bg-paper lg:p-6">
        {/* Inline ingredient chips (same pills as the recipe detail) */}
        {stepIngredients.length > 0 && (
          <div>
            <p
              className="mb-3 hidden text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted lg:block"
              aria-hidden="true"
            >
              Ingredientes del paso
            </p>
            <ul className="flex flex-wrap gap-2" aria-label="Ingredientes del paso">
              {stepIngredients.map((ing) => {
                const checked = checkedIngredientIds.has(ing.id)
                return (
                  <li key={ing.id}>
                    <button
                      type="button"
                      onClick={() => onToggleIngredient(ing.id)}
                      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-4 py-2 text-[15px] transition-colors active:scale-95 ${
                        checked
                          ? "border-border-soft bg-cream-deep text-ink-muted line-through decoration-ink-muted/60"
                          : "border-border bg-paper text-ink hover:border-ink"
                      }`}
                      aria-pressed={checked}
                    >
                      {checked && <Check size={14} className="text-ink" aria-hidden />}
                      <span>{ing.name}</span>
                      <span className="font-mono text-[13px] text-ink-muted">· {ing.quantity}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}

        {/* Faded next-step preview */}
        {nextStepText && (
          <div className="mt-auto border-t border-border-soft pt-4 lg:mt-0">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
              A continuación
            </div>
            <p className="line-clamp-2 text-[14px] leading-relaxed text-ink-muted lg:line-clamp-3">
              {nextStepText}
            </p>
          </div>
        )}
      </div>
    </article>
  )
}
