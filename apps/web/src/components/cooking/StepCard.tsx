"use client"

import { Check, Flame, Wand2 } from "lucide-react"
import type { Recipe, RecipeIngredient, RecipeStep } from "@ona/shared"
import { formatQuantity } from "@/lib/recipeView"
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
): Array<{ id: string; name: string; label: string }> {
  const byId = new Map(allIngredients.map((i) => [i.id, i]))
  const out: Array<{ id: string; name: string; label: string }> = []
  for (const refId of step.ingredientRefs ?? []) {
    const ing = byId.get(refId)
    if (!ing) continue
    const count = Math.max(1, refCounts.get(refId) ?? 1)
    const scaledQty = ing.quantity / count
    const label = `${formatQuantity(scaledQty, ing.unit)} ${ing.ingredientName ?? ""}`.trim()
    out.push({ id: ing.id, name: ing.ingredientName ?? "", label })
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
    <article className="flex h-full flex-col gap-6 px-5 pt-2 pb-6">
      {/* Step index + meta pills */}
      <header className="flex flex-wrap items-center gap-2">
        <span
          className="inline-flex items-center rounded-full bg-[#F2EDE0] px-3 py-1 text-[11px] uppercase tracking-[0.18em] text-[#4A4239]"
          aria-label={`Paso ${stepNumber} de ${totalSteps}`}
        >
          Paso {stepNumber} / {totalSteps}
        </span>

        {step.technique && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#E9F4EE] px-3 py-1 text-[12px] text-[#2D6A4F]">
            <Wand2 size={11} className="text-[#52B788]" />
            {step.technique}
          </span>
        )}

        {step.temperature != null && (
          <span className="inline-flex items-center gap-1 rounded-full bg-[#FBE9E1] px-3 py-1 text-[12px] text-[#9C3D1F]">
            <Flame size={11} className="text-[#C65D38]" />
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
      </header>

      {/* Step text — large editorial body */}
      <p className="font-display text-[clamp(1.4rem,4.5vw,1.9rem)] leading-[1.25] text-[#1A1612]">
        {step.text}
      </p>

      {/* Inline ingredient chips */}
      {stepIngredients.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Ingredientes del paso">
          {stepIngredients.map((ing) => {
            const checked = checkedIngredientIds.has(ing.id)
            return (
              <li key={ing.id}>
                <button
                  type="button"
                  onClick={() => onToggleIngredient(ing.id)}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] transition-all active:scale-95 ${
                    checked
                      ? "border-[#52B788] bg-[#E9F4EE] text-[#2D6A4F] line-through decoration-[#52B788]/60"
                      : "border-[#DDD6C5] bg-[#FAF6EE] text-[#1A1612]"
                  }`}
                  aria-pressed={checked}
                >
                  {checked && <Check size={12} className="text-[#52B788]" />}
                  {ing.label}
                </button>
              </li>
            )
          })}
        </ul>
      )}

      {/* Faded next-step preview */}
      {nextStepText && (
        <div className="mt-auto border-t border-[#DDD6C5] pt-4">
          <div className="text-eyebrow mb-2 text-[#7A7066]">A continuación</div>
          <p className="text-[13px] leading-relaxed text-[#7A7066]/80 line-clamp-2">
            {nextStepText}
          </p>
        </div>
      )}
    </article>
  )
}
