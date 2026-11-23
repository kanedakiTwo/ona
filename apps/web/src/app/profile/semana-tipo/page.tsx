"use client"

/**
 * /profile/semana-tipo — «Tu semana tipo» (D-182 §4, phase 2): what the
 * household usually eats each day. A grid of 7 days × its meals; tapping a
 * slot opens its panel (a sheet on mobile, the right column on desktop).
 * Every change writes that one slot.
 */
import { useEffect, useState } from "react"
import { Plus } from "lucide-react"
import { MEALS, householdToDiners, type Meal } from "@ona/shared"
import { useAuth } from "@/lib/auth"
import { useIsDesktop } from "@/hooks/useMediaQuery"
import { useSaveWeekTypeSlot, useWeekType } from "@/hooks/useWeekType"
import { MenuSheet } from "@/components/menu/MenuSheet"
import { Accent, SUB_CARD, SUB_EYEBROW, SubNotice, SubPage } from "@/components/profile/SubPage"
import { DAY_NAMES, MEAL_NAMES, WeekTypeGrid, weekTypeMeals } from "@/components/weekType/WeekTypeGrid"
import { SlotEditor } from "@/components/weekType/SlotEditor"

/** Chronological order for the columns. */
const MEAL_ORDER: Meal[] = ["breakfast", "lunch", "snack", "dinner"]

export default function WeekTypePage() {
  const { user } = useAuth()
  const { data: days, isLoading, isError } = useWeekType()
  const save = useSaveWeekTypeSlot()
  const desktop = useIsDesktop()
  const [selected, setSelected] = useState<{ day: number; meal: Meal } | null>(null)
  const [extraMeals, setExtraMeals] = useState<Meal[]>([])
  // PRO-1204: «Según tu semana» in the menu links here with `?dia=N` (0 = lunes): that day, marked.
  const [highlightDay, setHighlightDay] = useState<number | null>(null)
  useEffect(() => {
    const d = Number(new URLSearchParams(window.location.search).get("dia"))
    if (Number.isInteger(d) && d >= 0 && d <= 6 && window.location.search.includes("dia=")) setHighlightDay(d)
  }, [])
  const defaultDiners = householdToDiners(user?.adults ?? 2, user?.kidsCount ?? 0)

  const meals = weekTypeMeals(days, extraMeals)
  const hidden = MEAL_ORDER.filter((m) => !meals.includes(m) && (MEALS as readonly string[]).includes(m))

  const onSave = (day: number, meal: Meal, slot: Parameters<typeof save.mutate>[0]["slot"]) => save.mutate({ day, meal, slot })
  const panelTitle = selected ? `${DAY_NAMES[selected.day]} · ${MEAL_NAMES[selected.meal]}` : ""
  const editor = selected && days ? (
    <SlotEditor days={days} day={selected.day} meal={selected.meal} defaultDiners={defaultDiners} onSave={onSave} />
  ) : null

  return (
    <SubPage
      eyebrow="Perfil · Plantilla"
      title={
        <>
          Tu semana <Accent>tipo</Accent>
        </>
      }
      intro="Lo que soléis comer cada día. Mimo hace el menú de cada semana a partir de aquí y rellena los huecos libres con lo que mejor encaje. Toca un hueco para cambiarlo."
    >
      {isLoading && <SubNotice>Cargando…</SubNotice>}
      {isError && <SubNotice dashed>No he podido leer tu semana tipo. Prueba a recargar.</SubNotice>}
      {days && (
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start lg:gap-8">
          <section aria-label="La semana">
            <WeekTypeGrid days={days} meals={meals} selected={selected} highlightDay={highlightDay} onSelect={(day, meal) => setSelected({ day, meal })} />
            {hidden.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {hidden.map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setExtraMeals((x) => [...x, m])}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-border-soft bg-paper px-4 text-[14px] font-medium text-ink hover:bg-cream-deep"
                  >
                    <Plus size={16} aria-hidden="true" /> {MEAL_NAMES[m][0].toUpperCase() + MEAL_NAMES[m].slice(1)}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-4 max-w-[640px] text-[13px] leading-relaxed text-ink-muted">
              Los huecos con <em>Cualquier receta</em> los rellena Mimo con lo que encaje con vuestras alergias, el tiempo de cada día y vuestros aparatos.
              Cambiar la semana tipo no toca las semanas ya hechas: se nota en las siguientes que generes.
            </p>
          </section>

          {desktop && (
            <aside className={`${SUB_CARD} sticky top-6 hidden p-5 lg:block`} aria-label="Editar el hueco">
              {selected ? (
                <>
                  <div className={SUB_EYEBROW}>Editar hueco</div>
                  <h2 className="mb-4 mt-1 font-serif-text text-[26px] font-[650] leading-tight text-ink">{panelTitle}</h2>
                  {editor}
                </>
              ) : (
                <p className="text-[14px] text-ink-soft">Toca un hueco de la semana para cambiarlo.</p>
              )}
            </aside>
          )}
        </div>
      )}
      {!desktop && (
        <MenuSheet open={!!selected} onClose={() => setSelected(null)} eyebrow="Editar hueco" title={panelTitle}>
          {editor}
        </MenuSheet>
      )}
    </SubPage>
  )
}
