"use client"

/**
 * PRO-1186 (semana tipo, design §6): while a week is generated, «La semana»
 * shows at once the household's semana tipo for that week — one icon per
 * slot, what its turn takes — and «Buscando…»; the menu replaces it whole
 * when it arrives (the generator is one call, not slot by slot).
 */
import { useWeekType } from "@/hooks/useWeekType"
import { WeekTypeGrid, weekTypeMeals } from "@/components/weekType/WeekTypeGrid"

export function WeekTypeSkeleton({ weekStart, className = "" }: { weekStart: string; className?: string }) {
  const { data: days } = useWeekType()
  return (
    <section data-testid="week-type-skeleton" className={className}>
      <p role="status" className="mb-3 flex items-center gap-2 text-[14px] font-medium text-ink">
        <span className="h-2 w-2 rounded-full bg-terracotta motion-safe:animate-pulse" aria-hidden="true" />
        Buscando… las recetas de tu semana tipo
      </p>
      {/* A picture: the status line says it; the menu replaces it whole. */}
      {days && (
        <div aria-hidden="true">
          <WeekTypeGrid days={days} meals={weekTypeMeals(days)} weekStart={weekStart} />
        </div>
      )}
    </section>
  )
}
