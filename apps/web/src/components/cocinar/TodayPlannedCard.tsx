"use client"

/**
 * /cocinar: what the menu had for the meal of now (specs/cook-now.md), with
 * «Empezar a cocinar» straight into cook mode for that slot, and always the
 * way into the four questions («¿Otra cosa? Cocinar ahora»).
 */
import Link from "next/link"
import { ChefHat } from "lucide-react"
import type { CookNowToday } from "@/hooks/useCookNow"
import { cookHref } from "@/lib/cookHref"
import { PILL_INK, PILL_OUTLINE, SUB_CARD } from "@/components/profile/SubPage"

function listEs(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`
}

export function TodayPlannedCard({
  today,
  defaultDiners,
  onStart,
}: {
  today: CookNowToday | undefined
  defaultDiners: number
  onStart: () => void
}) {
  const planned = today && today.meal && !today.locked ? today.planned : []
  const first = planned[0]
  const minutes = planned.reduce<number | null>((max, d) => (d.totalTime == null ? max : Math.max(max ?? 0, d.totalTime)), null)

  return (
    <section aria-label="Lo que toca ahora" className="mt-6 space-y-3">
      {first && today?.meal && today.menuId && (
        <div className={`${SUB_CARD} overflow-hidden lg:flex lg:max-w-[760px]`} data-testid="cook-now-today">
          {first.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={first.imageUrl} alt="" className="aspect-[16/9] w-full object-cover lg:aspect-auto lg:w-[280px]" />
          )}
          <div className="p-4 lg:flex lg:flex-1 lg:flex-col lg:justify-center lg:p-6">
            <p className="font-serif-text text-[20px] font-[650] leading-snug text-ink">
              {planned.length > 1 ? "Hoy tocaban" : "Hoy toca"}{" "}
              <span className="italic text-terracotta-deep">{listEs(planned.map((d) => d.recipeName))}</span>
            </p>
            {minutes != null && <p className="mt-1 text-[14px] text-ink-soft">{minutes} min</p>}
            <Link
              href={cookHref(first.recipeId, defaultDiners, { menuId: today.menuId, day: today.day, meal: today.meal })}
              className={`${PILL_INK} mt-4 w-full lg:w-auto lg:self-start`}
            >
              <ChefHat size={16} aria-hidden="true" /> Empezar a cocinar
            </Link>
          </div>
        </div>
      )}
      <button type="button" onClick={onStart} className={`${first ? PILL_OUTLINE : PILL_INK} w-full lg:w-auto`}>
        {first ? "¿Otra cosa? Cocinar ahora" : "Cocinar ahora"}
      </button>
    </section>
  )
}
