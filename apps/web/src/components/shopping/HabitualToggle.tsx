"use client"

/**
 * «Habitual» on a line of /shopping (PRO-293): a star on the line and a
 * switch in its sheet. On = the product is one of the household's staples
 * («Mis básicos») and comes back by itself on every new list; off pauses it.
 */
import { useState } from "react"
import { Star } from "lucide-react"
import { ingredientDisplayName } from "@ona/shared"
import { useHabitualLine, type ShoppingItem } from "@/hooks/useShopping"
import { haptic } from "@/lib/pwa/haptics"

export const isHabitual = (item: ShoppingItem) => item.kind === "staple" || !!item.habitual

/** The star beside a line's name. */
export function HabitualStar({ item, listId, busy }: { item: ShoppingItem; listId: string; busy?: boolean }) {
  const habitual = useHabitualLine()
  const on = isHabitual(item)
  const name = ingredientDisplayName(item.name)
  return (
    <button
      type="button"
      onClick={() => {
        haptic.light()
        habitual.mutate({ listId, itemId: item.id, on: !on })
      }}
      disabled={busy || habitual.isPending}
      aria-pressed={on}
      aria-label={`Habitual: ${name}`}
      title={on ? "Habitual: sale solo en cada compra. Toca para pausarlo." : "Marcar como habitual: saldrá solo en cada compra"}
      className="flex h-11 w-9 shrink-0 items-center justify-center rounded-full text-ink-muted transition-colors hover:text-terracotta-deep disabled:cursor-wait"
    >
      <Star size={17} strokeWidth={2} aria-hidden="true" className={on ? "fill-terracotta-deep text-terracotta-deep" : ""} />
    </button>
  )
}

/** The «Habitual» tag under the name of a line that is a staple. */
export function HabitualTag() {
  return (
    <span className="ml-2 font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-mid" data-testid="shopping-habitual">
      Habitual
    </span>
  )
}

/** The switch in the line's sheet. */
export function HabitualSwitch({ item, listId }: { item: ShoppingItem; listId: string }) {
  const habitual = useHabitualLine()
  const [error, setError] = useState<string | null>(null)
  // The sheet keeps the line it opened with: follow the switch locally.
  const [on, setOn] = useState(isHabitual(item))
  return (
    <div className="rounded-xl bg-cream-deep/60 p-3">
      <label className="flex cursor-pointer items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="block text-[15px] font-medium text-ink">Habitual</span>
          <span className="block text-[13px] text-ink-muted">
            {on ? "Sale solo en cada compra. Apágalo para pausarlo." : "Que salga solo en cada compra, con esta cantidad."}
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          checked={on}
          disabled={habitual.isPending}
          onChange={(e) => {
            haptic.light()
            const next = e.target.checked
            habitual.mutate(
              { listId, itemId: item.id, on: next },
              {
                onError: () => setError("No se ha podido guardar. Prueba otra vez."),
                onSuccess: () => {
                  setError(null)
                  setOn(next)
                },
              },
            )
          }}
          aria-label="Habitual"
          className="h-6 w-11 shrink-0 cursor-pointer appearance-none rounded-full bg-border transition-colors before:block before:h-5 before:w-5 before:translate-x-0.5 before:translate-y-0.5 before:rounded-full before:bg-paper before:transition-transform checked:bg-ink checked:before:translate-x-[22px]"
        />
      </label>
      {error && (
        <p className="mt-1 text-[13px] text-terracotta-deep" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
