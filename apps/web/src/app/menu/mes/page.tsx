"use client"

/**
 * /menu/mes?week=YYYY-MM-DD — «Menú del mes» (PRO-378, specs/menus.md). The
 * week Cocina prepared for this month, day by day, and «Copiar a mi semana»:
 * its dishes go into the week the household was looking at (`?week=`, else
 * this week), only in the meals of its plantilla, with the dishes that break
 * someone's allergies or diet swapped by the API for a similar one. A week
 * that already has dishes asks first («Se cambiarán los platos de esta
 * semana»). The notice says how many were copied and swapped.
 */
import { useState } from "react"
import Link from "next/link"
import { ArrowLeft, CalendarDays } from "lucide-react"
import { MEALS } from "@ona/shared"
import { useAuth } from "@/lib/auth"
import { ApiError } from "@/lib/api"
import { mondayOf } from "@/lib/addToMenu"
import { weekRangeLabel } from "@/lib/menuDay"
import { MEAL_LABELS } from "@/lib/labels"
import { DISPLAY_UI } from "@/components/recipes/RecipeCard"
import { ConfirmSheet } from "@/components/menu/MenuSheet"
import { useCopyMonthMenu, useMonthMenu, type CopyMonthMenuResult } from "@/hooks/useMonthMenu"

const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]

function weekFromUrl(): string {
  if (typeof window === "undefined") return mondayOf(new Date())
  const raw = new URLSearchParams(window.location.search).get("week")
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number)
    if (new Date(y, m - 1, d).getDay() === 1) return raw
  }
  return mondayOf(new Date())
}

export default function MonthMenuPage() {
  const { user } = useAuth()
  const [weekStart] = useState(weekFromUrl)
  const { data: menu, isLoading, isError } = useMonthMenu(!!user)
  const copy = useCopyMonthMenu()
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [done, setDone] = useState<CopyMonthMenuResult | null>(null)
  const isCurrentWeek = weekStart === mondayOf(new Date())
  const menuHref = isCurrentWeek ? "/menu" : `/menu?week=${weekStart}`

  function run(force: boolean) {
    if (!menu) return
    setConfirmOpen(false)
    copy.mutate(
      { month: menu.month, weekStart, force },
      {
        onSuccess: (r) => setDone(r),
        onError: (err) => {
          if (err instanceof ApiError && err.code === "MENU_NOT_EMPTY") setConfirmOpen(true)
        },
      },
    )
  }
  const failed = copy.isError && !(copy.error instanceof ApiError && copy.error.code === "MENU_NOT_EMPTY")

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto w-full max-w-[760px] px-5 pb-12 pt-4 lg:px-0 lg:pt-8">
        <Link href={menuHref} className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 px-2 text-[14px] text-ink-mid hover:text-ink">
          <ArrowLeft size={16} aria-hidden="true" /> Mi menú
        </Link>

        {isLoading ? (
          <p className="mt-10 text-center text-eyebrow" role="status">
            Cargando...
          </p>
        ) : !menu ? (
          <div className="mt-6 rounded-[22px] border border-dashed border-border bg-paper px-6 py-8 text-center">
            <p className="font-serif-text text-xl font-[650] text-ink">
              {isError ? "No hemos podido cargar el menú del mes." : "Este mes aún no hay menú."}
            </p>
            <p className="mt-2 text-[14px] text-ink-soft">Mientras tanto, genera tu semana desde Mi menú.</p>
          </div>
        ) : (
          <>
            <header className="mt-2">
              {/* #B5432A: terracotta darkened for small text on cream (AA). */}
              <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[#B5432A]">Menú del mes</div>
              <h1 className={`${DISPLAY_UI} mt-1 text-[32px] leading-[1.1] text-ink lg:text-[40px]`}>{menu.title}</h1>
              <p className="mt-2 text-[14px] leading-snug text-ink-mid">
                Una semana pensada por la cocina de casa. Cópiala a la tuya: solo entran las comidas que haces y, si un plato no os
                encaja por alergias o dieta, lo cambiamos por otro parecido.
              </p>
            </header>

            <ol className="mt-6 flex flex-col gap-3" aria-label="Días del menú">
              {menu.days.map((day, d) => {
                const meals = MEALS.filter((m) => (day[m]?.length ?? 0) > 0)
                if (meals.length === 0) return null
                return (
                  <li key={d} className="rounded-[22px] border border-border bg-paper px-4 py-3.5" data-testid="month-menu-day">
                    <h2 className={`${DISPLAY_UI} text-[19px] text-ink`}>{DAY_NAMES[d]}</h2>
                    <dl className="mt-1.5 flex flex-col gap-1.5">
                      {meals.map((m) => (
                        <div key={m} className="flex gap-3">
                          <dt className="w-[78px] shrink-0 pt-px text-[12px] font-semibold uppercase tracking-[0.08em] text-ink-soft">{MEAL_LABELS[m]}</dt>
                          <dd className="flex min-w-0 flex-col gap-0.5">
                            {day[m]!.map((r) => (
                              <Link key={r.id} href={`/recipes/${r.id}`} className="text-[15px] leading-snug text-ink underline-offset-4 hover:underline">
                                {r.name}
                                {r.totalTime != null && <span className="text-[13px] text-ink-soft"> · {r.totalTime} min</span>}
                              </Link>
                            ))}
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                )
              })}
            </ol>

            <div className="sticky bottom-[calc(5.5rem+var(--safe-bottom))] mt-6 rounded-[22px] border border-border bg-paper/95 px-4 py-4 backdrop-blur lg:bottom-6">
              {done ? (
                <div role="status" className="flex flex-col gap-3">
                  <p className="text-[14.5px] leading-snug text-ink" data-testid="month-menu-notice">
                    {done.notice}
                  </p>
                  <Link
                    href={menuHref}
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-full bg-ink px-5 text-[15px] font-semibold text-cream transition-colors hover:bg-forest"
                  >
                    Ver mi semana
                  </Link>
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => run(false)}
                    disabled={copy.isPending}
                    className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-full bg-ink px-5 text-[15px] font-semibold text-cream transition-colors hover:bg-forest disabled:opacity-50"
                  >
                    <CalendarDays size={16} aria-hidden="true" />
                    {copy.isPending ? "Copiando..." : "Copiar a mi semana"}
                  </button>
                  <p className="mt-2 text-center text-[12.5px] text-ink-soft">{weekRangeLabel(weekStart)}</p>
                  {failed && (
                    <p role="alert" className="mt-2 text-center text-[13px] text-[#B5432A]">
                      No hemos podido copiarlo. Inténtalo de nuevo.
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      <ConfirmSheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        onConfirm={() => run(true)}
        title="Se cambiarán los platos de esta semana"
        message="Tu semana ya tiene platos. Si copias el menú del mes, se sustituyen (los huecos fijados se quedan como están)."
        confirmLabel="Copiar igualmente"
      />
    </div>
  )
}
