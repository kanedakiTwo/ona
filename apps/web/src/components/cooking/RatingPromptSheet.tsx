"use client"

/**
 * «¿Qué tal?» after cooking (PRO-110, specs/cook-log.md): one tap after
 * «Marcar como cocinada» on the menu or «Terminar» in cook mode. The answer
 * goes into the household's existing rating (Repetir a menudo 5 · Bien 3 ·
 * Mejor no 1), which the recipe detail shows as stars. The API decides
 * whether to ask (`askRating` in the POST /cook-logs answer: not again for a
 * recipe rated in the last 30 days).
 */
import { useQueryClient } from "@tanstack/react-query"
import { RATING_PROMPT_CHOICES } from "@ona/shared"
import { api } from "@/lib/api"
import { MenuSheet } from "@/components/menu/MenuSheet"

export function RatingPromptSheet({
  recipeId,
  recipeName,
  onDone,
  layerClassName,
}: {
  /** null = closed. */
  recipeId: string | null
  recipeName?: string | null
  /** Called after an answer or when closed without one. */
  onDone: () => void
  layerClassName?: string
}) {
  const qc = useQueryClient()

  async function answer(rating: number) {
    if (!recipeId) return
    try {
      await api.put(`/recipes/${recipeId}/notes`, { rating })
      qc.invalidateQueries({ queryKey: ["recipe-notes", recipeId] })
    } catch {
      // A lost answer is not worth an error: it will be asked again.
    }
    onDone()
  }

  return (
    <MenuSheet
      open={recipeId != null}
      onClose={onDone}
      eyebrow={recipeName ?? undefined}
      title="¿Qué tal?"
      layerClassName={layerClassName}
    >
      <div className="flex flex-col gap-2" data-testid="rating-prompt">
        {RATING_PROMPT_CHOICES.map((c) => (
          <button
            key={c.rating}
            type="button"
            onClick={() => answer(c.rating)}
            className="flex min-h-[48px] items-center justify-center rounded-full border border-border bg-paper px-4 text-[15px] font-semibold text-ink transition-colors hover:border-ink"
          >
            {c.label}
          </button>
        ))}
      </div>
    </MenuSheet>
  )
}
