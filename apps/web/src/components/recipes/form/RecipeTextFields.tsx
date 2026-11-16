"use client"

/**
 * The two boxes of the recipe forms (PRO-1115): ingredients, one per line,
 * with how each line has been understood under it («200 g · lentejas ✓»,
 * «¿cuál?» with up to 3 buttons, «nuevo, se crea al guardar»), and the
 * steps, written or pasted whole and split into numbered steps.
 *
 * Presentation only: the page holds the text; `useIngredientLines` the
 * reading of the lines.
 */
import { splitSteps } from "@ona/shared"
import { cn } from "@/lib/utils"
import { amountLabel, type IngredientLineView, type LineChoice } from "@/lib/ingredientLines"
import { HINT, choicePillClass } from "@/components/recipes/form/RecipeFormUI"

const BOX =
  "block w-full resize-y rounded-xl border bg-paper px-3.5 py-2.5 text-[16px] leading-relaxed text-ink placeholder:text-ink-light focus:outline-none focus:ring-1 lg:text-[15px]"

function boxClass(hasError: boolean) {
  return cn(
    BOX,
    hasError
      ? "border-terracotta focus:border-terracotta focus:ring-terracotta"
      : "border-border-soft focus:border-ink focus:ring-ink",
  )
}

function rowsFor(text: string, min: number) {
  return Math.min(16, Math.max(min, text.split("\n").length + 1))
}

export function IngredientLinesField({
  text,
  onText,
  views,
  onChoose,
  errorAt,
  hasError,
  disabled,
}: {
  text: string
  onText: (text: string) => void
  views: IngredientLineView[]
  onChoose: (nameKey: string, choice: LineChoice) => void
  /** A server lint message for the row at this position, if any. */
  errorAt?: (idx: number) => string | null
  hasError?: boolean
  disabled?: boolean
}) {
  return (
    <div>
      <textarea
        id="recipe-ingredients"
        aria-label="Ingredientes, uno por línea"
        aria-required="true"
        value={text}
        onChange={(e) => onText(e.target.value)}
        rows={rowsFor(text, 5)}
        disabled={disabled}
        placeholder={"200 g de lentejas\n1 cebolla\n2 cucharadas de aceite\nsal"}
        className={boxClass(!!hasError)}
        autoCapitalize="none"
        spellCheck={false}
      />
      {views.length > 0 && (
        <ol data-testid="ingredient-lines" aria-label="Cómo se han entendido" className="mt-3 space-y-2">
          {views.map((view, idx) => (
            <IngredientLineItem
              key={`${idx}-${view.line}`}
              view={view}
              error={errorAt?.(idx) ?? null}
              onChoose={(choice) => onChoose(view.nameKey, choice)}
            />
          ))}
        </ol>
      )}
    </div>
  )
}

function IngredientLineItem({
  view,
  error,
  onChoose,
}: {
  view: IngredientLineView
  error: string | null
  onChoose: (choice: LineChoice) => void
}) {
  const { state, parsed, choice } = view
  const name = state.kind === "match" ? state.ingredient.name : parsed.name
  const status =
    state.kind === "loading"
      ? "comprobando…"
      : state.kind === "match"
        ? "✓"
        : state.kind === "doubt"
          ? "¿cuál?"
          : "nuevo, se crea al guardar"
  const candidates = view.doubt
  return (
    <li
      data-testid="ingredient-line"
      data-status={state.kind}
      className="rounded-xl border border-dashed border-border px-3 py-2 text-[14px] text-ink"
    >
      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="font-mono text-[13px] text-ink-mid">{amountLabel(parsed)}</span>
        <span aria-hidden className="text-ink-light">·</span>
        <span className="font-medium">{name}</span>
        {parsed.note && <span className="text-ink-muted">· {parsed.note}</span>}
        {parsed.optional && (
          <span className="rounded-full bg-cream-deep px-2 text-[11px] uppercase tracking-[0.1em] text-ink-muted">opcional</span>
        )}
        {view.section && <span className="text-[12px] text-ink-muted">({view.section})</span>}
        <span
          data-testid="ingredient-line-status"
          className={cn(
            "ml-auto text-[13px]",
            state.kind === "match" ? "text-ink" : state.kind === "loading" ? "text-ink-light" : "italic text-terracotta-deep",
          )}
        >
          {status}
        </span>
      </div>
      {candidates && (
        <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label={`¿Cuál es «${parsed.name}»?`}>
          {candidates.map((c) => {
            const active = choice !== "new" && choice?.id === c.id
            return (
              <button key={c.id} type="button" aria-pressed={active} onClick={() => onChoose(c)} className={choicePillClass(active)}>
                {c.name}
              </button>
            )
          })}
          <button type="button" aria-pressed={choice === "new"} onClick={() => onChoose("new")} className={choicePillClass(choice === "new")}>
            Otro: «{parsed.name}»
          </button>
        </div>
      )}
      {state.kind === "doubt" && (
        <p className={cn(HINT, "mt-1.5")}>
          {state.fallback === "first"
            ? `Si no eliges, se guarda como «${state.candidates[0].name}».`
            : "Si no eliges, se crea como nuevo al guardar."}
        </p>
      )}
      {error && <p className="mt-1.5 text-[13px] italic text-terracotta-deep">{error}</p>}
    </li>
  )
}

export function StepsTextField({
  text,
  onText,
  errorAt,
}: {
  text: string
  onText: (text: string) => void
  errorAt?: (idx: number) => string | null
}) {
  const steps = splitSteps(text)
  return (
    <div>
      <textarea
        id="recipe-steps"
        aria-label="Pasos"
        value={text}
        onChange={(e) => onText(e.target.value)}
        rows={rowsFor(text, 5)}
        placeholder={"1. Pon las lentejas en remojo la noche anterior.\n2. Sofríe la cebolla picada en el aceite.\n3. Añade las lentejas y cuece 40 minutos."}
        className={boxClass(false)}
      />
      {steps.length > 0 && (
        <ol data-testid="step-lines" aria-label="Pasos numerados" className="mt-3 space-y-2">
          {steps.map((step, idx) => {
            const error = errorAt?.(idx) ?? null
            return (
              <li key={idx} data-testid="step-line" className="flex gap-2.5 text-[14px] leading-relaxed text-ink">
                <span className="font-mono text-[13px] text-ink-muted">{idx + 1}.</span>
                <span className="min-w-0 flex-1">
                  {step}
                  {error && <span className="mt-1 block text-[13px] italic text-terracotta-deep">{error}</span>}
                </span>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}
