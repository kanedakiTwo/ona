"use client"

/**
 * PRO-1204 · «Vuestra semana»: the head of the profile. The semana tipo
 * drawn small — 7 days × the meals the household uses, each slot in one or
 * two words with a colour per kind (`summarizeWeekType`), today marked —, a
 * line with what doesn't change, «Editar» (/profile/semana-tipo) and
 * «Ajustar con Mimo» (Mimo opens with the week as the subject). A household
 * that never touched it sees the default and an invitation to tell its own.
 */
import Link from "next/link"
import { summarizeWeekType, schoolWeekdays, type Meal, type WeekTypeCellKind } from "@ona/shared"
import { useWeekType } from "@/hooks/useWeekType"
import { useSchoolMenu } from "@/hooks/useSchoolMenu"
import { useUserMemory } from "@/hooks/useUserMemory"
import { useMimo } from "@/components/mimo/MimoProvider"
import { currentWeekStart } from "@/lib/utils"
import { DAY_NAMES, MEAL_NAMES } from "./WeekTypeGrid"

const DAY_SHORT = ["L", "M", "X", "J", "V", "S", "D"]
const MEAL_SHORT: Record<Meal, string> = { breakfast: "Des.", lunch: "Com.", snack: "Mer.", dinner: "Cena" }

/** One colour per kind (maqueta 2026-11-12-perfil, «Vuestra semana»). */
export const CELL_TONE: Record<WeekTypeCellKind, string> = {
  legumbre: "bg-[#DCEBE2] text-[#24533E]",
  pescado: "bg-[#DCE7F0] text-[#1E3A52]",
  taper: "bg-bone text-ink",
  fuera: "border border-dashed border-border bg-transparent text-ink-muted",
  cole: "bg-[#EFE6C8] text-[#4F4219]",
  fijo: "bg-warn-bg text-terracotta-deep",
  plato: "bg-cream-deep text-ink",
  libre: "border border-border-soft bg-transparent text-ink-light",
}

export function WeekTypeHead() {
  const { data: days, isLoading } = useWeekType()
  const school = useSchoolMenu()
  const memory = useUserMemory()
  const mimo = useMimo()
  const weekStart = currentWeekStart()
  const today = (new Date().getDay() + 6) % 7

  const summary = days
    ? summarizeWeekType(days, weekStart, {
        school: school.data?.visible ? schoolWeekdays(school.data.days) : [],
        timeAvailable: memory.data?.time_available?.value,
      })
    : null

  return (
    <section aria-labelledby="week-type-head-title" data-testid="week-type-head" className="px-5 lg:px-0">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="week-type-head-title" className="font-serif-text text-[22px] font-[650] leading-tight text-ink lg:text-[26px]">
          Vuestra semana
        </h2>
        <Link href="/profile/semana-tipo" className="min-h-[44px] content-center px-1 text-[13px] font-semibold text-terracotta-deep hover:underline">
          Editar
        </Link>
      </div>
      <p className="mb-2.5 text-[13px] leading-snug text-ink-muted">El menú sale de aquí: qué coméis cada día, quién está y lo que no cambia.</p>

      <div className="rounded-[20px] border border-border-soft bg-paper p-3 lg:p-4">
        {isLoading && <p className="py-6 text-center text-[13px] text-ink-muted">Cargando tu semana…</p>}
        {summary && (
          <>
            <Link href="/profile/semana-tipo" aria-label="Editar tu semana tipo" className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink">
              <div
                role="table"
                aria-label="Tu semana tipo"
                data-testid="week-type-head-grid"
                className="grid gap-[3px] text-[10px] lg:gap-1 lg:text-[12px]"
                style={{ gridTemplateColumns: "34px repeat(7, minmax(0, 1fr))" }}
              >
                <div role="row" className="contents">
                  <div />
                  {DAY_SHORT.map((l, d) => (
                    <div
                      key={l}
                      role="columnheader"
                      title={DAY_NAMES[d]}
                      aria-current={d === today ? "date" : undefined}
                      className={`pb-0.5 text-center font-semibold ${d === today ? "text-terracotta-deep" : "text-ink-muted"}`}
                    >
                      {l}
                      {d === today && <span className="sr-only"> (hoy)</span>}
                    </div>
                  ))}
                </div>
                {summary.meals.map((m) => (
                  <div key={m} role="row" className="contents">
                    <div role="rowheader" className="self-center text-[9.5px] font-semibold uppercase tracking-[0.06em] text-ink-muted lg:text-[10.5px]">
                      {MEAL_SHORT[m]}
                    </div>
                    {summary.cells[m].map((c, d) => (
                      <div
                        key={d}
                        role="cell"
                        data-kind={c.kind}
                        data-testid={`wt-head-${d}-${m}`}
                        aria-label={`${DAY_NAMES[d]}, ${MEAL_NAMES[m]}: ${c.label}`}
                        title={c.short}
                        className={`grid min-h-[32px] min-w-0 place-items-center rounded-md px-px py-1 text-center leading-[1.1] lg:min-h-[40px] ${CELL_TONE[c.kind]} ${d === today ? "ring-1 ring-terracotta/60" : ""}`}
                      >
                        <span className="block w-full truncate tracking-[-0.01em]">{c.short}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </Link>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-0.5">
              <p className="min-w-0 flex-1 text-[12.5px] leading-snug text-ink-muted" data-testid="week-type-head-note">
                {summary.isDefault ? "Así come Mimoia por defecto: cuéntale la tuya." : summary.notes.join(" · ") || "Toca la semana para cambiar un día."}
              </p>
              <button
                type="button"
                onClick={() =>
                  mimo.open({ draft: summary.isDefault ? "Te cuento cómo es nuestra semana: " : "Quiero ajustar nuestra semana tipo: " })
                }
                className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-4 text-[13px] font-semibold text-cream hover:bg-ink-mid"
              >
                Ajustar con Mimo
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}
