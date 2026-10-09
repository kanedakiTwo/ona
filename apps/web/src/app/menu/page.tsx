"use client"

/**
 * /menu — "D · Luz y foto" (2026-10-08): the order of a light editorial
 * layout with the photos as protagonists.
 *
 * Mobile (Vista día): compact header (week eyebrow + "Hoy, jueves" + one
 * "···" for the week), day strip, the day's featured meal as a full-bleed
 * photo with "Empezar a cocinar", the other meals as rows. Every per-meal
 * action sits behind its own "···" (MealOptions); every week action behind
 * the header "···" (WeekActionsSheet). Vista semana (mobile) keeps the
 * draggable WeekGridView. Desktop (lg+) renders MenuDesktop: hero row +
 * "La semana" columns with drag & drop.
 */
import { NoHealthDataNotice } from "@/components/menu/NoHealthDataNotice"
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"
import { useRouter } from "next/navigation"
import { MoreHorizontal, RefreshCw, Share2, Sparkles } from "lucide-react"
import type { DayMenu, MealSlot } from "@ona/shared"
import { menuShareText } from "@ona/shared"
import { useAuth } from "@/lib/auth"
import {
  useMenu,
  useGenerateMenu,
  useRegenerateMeal,
  useLockMeal,
  useAddMealSlot,
  useDeleteMealSlot,
  useMoveMealSlot,
  useUpdateSlotServings,
  useBanRecipe,
  useUnbanRecipe,
  useSkipDay,
  useUnskipDay,
  useSetSlotPinnedType,
  useAddDish,
  useRemoveDish,
  usePatchDish,
  useRegenerateDish,
  useAddRandomDish,
} from "@/hooks/useMenu"
import { useUser } from "@/hooks/useUser"
import { haptic } from "@/lib/pwa/haptics"
import { recordMenuVisit } from "@/lib/pwa/installPrompt"
import { share } from "@/lib/pwa/share"
import { dateOfDay, dayHeading, missingMeals, orderedSlots, splitDay, weekHasDishes, weekRangeLabel, weekdayName, type MealKey } from "@/lib/menuDay"
import { WeekGridView } from "@/components/menu/WeekGridView"
import { WeekStrip } from "@/components/menu/WeekStrip"
import { PantryMatchCard } from "@/components/menu/PantryMatchCard"
import { BannedRecipesPanel } from "@/components/menu/BannedRecipesPanel"
import { WeekActionsSheet } from "@/components/menu/WeekActionsSheet"
import { MenuDesktop } from "@/components/menu/MenuDesktop"
import { DayFooter, DayMeals, SkippedDay, type SlotPropsFn } from "@/components/menu/DayMeals"
import type { SlotHandlers } from "@/components/menu/MealOptions"

/** Local-time Monday of `d` as `YYYY-MM-DD`. */
function mondayOf(d: Date): string {
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + diff)
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`
}

function getWeekStart(): string {
  return mondayOf(new Date())
}

/** Shift a YYYY-MM-DD by ±weeks (sign matters). Validates and normalises to Monday. */
function shiftWeek(weekStart: string, deltaWeeks: number): string {
  const [y, m, d] = weekStart.split("-").map(Number)
  const next = new Date(y, (m ?? 1) - 1, d ?? 1)
  next.setDate(next.getDate() + deltaWeeks * 7)
  return mondayOf(next)
}

/** YYYY-MM-DD passed validation? (form + parses to a real Monday) */
function isValidWeekStart(s: string | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d && date.getDay() === 1
}

/** Whole-week delta from current Monday to `weekStart`. Negative = past. */
function weeksFromNow(weekStart: string): number {
  const today = new Date(getWeekStart() + "T00:00:00")
  const target = new Date(weekStart + "T00:00:00")
  return Math.round((target.getTime() - today.getTime()) / (7 * 24 * 60 * 60 * 1000))
}

/** "Esta semana" / "Próxima semana" / "Semana pasada" / "En N semanas" / "Hace N semanas". */
function weekLabel(weekStart: string): string {
  const d = weeksFromNow(weekStart)
  if (d === 0) return "Esta semana"
  if (d === 1) return "Próxima semana"
  if (d === -1) return "Semana pasada"
  if (d > 1) return `En ${d} semanas`
  return `Hace ${-d} semanas`
}

/** lg+ (≥1024 px) — the desktop layout replaces the day/week views. */
function useIsDesktop(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia("(min-width: 1024px)")
      mq.addEventListener("change", cb)
      return () => mq.removeEventListener("change", cb)
    },
    () => window.matchMedia("(min-width: 1024px)").matches,
    () => false,
  )
}

function todayIndexIn(weekStart: string): number {
  const start = new Date(weekStart + "T00:00:00")
  const diff = Math.floor((Date.now() - start.getTime()) / (1000 * 60 * 60 * 24))
  return diff >= 0 && diff <= 6 ? diff : -1
}

export default function MenuPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()
  const isDesktop = useIsDesktop()

  // Initial week from `?week=YYYY-MM-DD` (shareable / back-forward-able).
  // Avoids `useSearchParams`: it forces a Suspense boundary at build time
  // and broke a sibling route in commit 5c1af4c.
  const [weekStart, setWeekStartState] = useState<string>(() => {
    if (typeof window === "undefined") return getWeekStart()
    const raw = new URLSearchParams(window.location.search).get("week")
    return isValidWeekStart(raw) ? raw : getWeekStart()
  })

  const setWeekStart = useCallback((next: string) => {
    setWeekStartState(next)
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    if (next === getWeekStart()) url.searchParams.delete("week")
    else url.searchParams.set("week", next)
    window.history.replaceState(null, "", url.toString())
  }, [])

  const delta = useMemo(() => weeksFromNow(weekStart), [weekStart])
  const isPastWeek = delta < 0
  const isCurrentWeek = delta === 0
  const todayIndex = useMemo(() => todayIndexIn(weekStart), [weekStart])

  const {
    data: menu,
    isLoading: menuLoading,
    isError: menuFailed,
    refetch: refetchMenu,
    isFetching: menuFetching,
  } = useMenu(user?.id, weekStart)
  const generateMenu = useGenerateMenu()
  const regenerateMeal = useRegenerateMeal()
  const lockMeal = useLockMeal()
  const addMealSlot = useAddMealSlot()
  const deleteMealSlot = useDeleteMealSlot()
  const moveMealSlot = useMoveMealSlot()
  const updateSlotServings = useUpdateSlotServings()
  const banRecipe = useBanRecipe()
  const unbanRecipe = useUnbanRecipe()
  const skipDay = useSkipDay()
  const unskipDay = useUnskipDay()
  const setSlotPinnedType = useSetSlotPinnedType()
  const addDish = useAddDish()
  const removeDish = useRemoveDish()
  const patchDish = usePatchDish()
  const regenerateDish = useRegenerateDish()
  const addRandomDish = useAddRandomDish()

  // Household diner count — the fallback when a slot has no override.
  const { data: profile } = useUser(user?.id)
  const householdDiners =
    ((profile?.adults as number | undefined) ?? user?.adults ?? 0) +
    ((profile?.kidsCount as number | undefined) ?? user?.kidsCount ?? 0)
  const defaultDiners = Math.max(1, householdDiners || 2)

  const [selectedDay, setSelectedDay] = useState(() => {
    const day = new Date().getDay()
    return day === 0 ? 6 : day - 1
  })

  // "Vista día" vs "Vista semana" (mobile only; desktop shows both at once).
  // Persisted in localStorage; lazy-init so the first render is right.
  const [viewMode, setViewModeState] = useState<"day" | "week">(() => {
    if (typeof window === "undefined") return "day"
    const stored = window.localStorage.getItem("ona.menu.view")
    return stored === "week" ? "week" : "day"
  })
  const setViewMode = useCallback((next: "day" | "week") => {
    setViewModeState(next)
    try {
      window.localStorage.setItem("ona.menu.view", next)
    } catch {
      /* private mode: preference just doesn't stick */
    }
  }, [])

  const [weekSheetOpen, setWeekSheetOpen] = useState(false)

  // Changing week resets the day: today on the current week, Monday otherwise.
  useEffect(() => {
    if (isCurrentWeek) {
      const day = new Date().getDay()
      setSelectedDay(day === 0 ? 6 : day - 1)
    } else {
      setSelectedDay(0)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStart])

  useEffect(() => {
    recordMenuVisit()
  }, [])

  const isLockedAt = useCallback(
    (day: number, meal: string) => Boolean((menu?.locked as Record<string, Record<string, boolean>> | undefined)?.[String(day)]?.[meal]),
    [menu],
  )

  /** "Pásalo": the week as text, with a link that brings another household. */
  async function handleShareWeek() {
    if (!menu) return
    haptic.light()
    await share({ title: "Mi menú de la semana", text: menuShareText(menu.days as never, window.location.origin) })
  }

  function handleGenerate() {
    if (!user) return
    haptic.medium()
    generateMenu.mutate({ userId: user.id, weekStart })
  }

  /**
   * Auto-materialise an empty menu on a current/future week that has none
   * (the user gets the template slots to fill), and self-heal legacy rows
   * persisted as `[{}, {}, …]`. Only a confirmed 404 (`menu === null`)
   * creates — a failed GET (`undefined`) never writes (menu-load-failure).
   */
  useEffect(() => {
    if (!user || authLoading || menuLoading) return
    if (isPastWeek) return
    if (generateMenu.isPending) return
    if (menu === undefined) return
    if (menu === null) {
      generateMenu.mutate({ userId: user.id, weekStart, empty: true })
      return
    }
    const malformed =
      Array.isArray(menu.days) && menu.days.length > 0 && menu.days.every((d) => !d || Object.keys(d).length === 0)
    if (malformed) generateMenu.mutate({ userId: user.id, weekStart, empty: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, menu?.id, menuLoading, isPastWeek, weekStart])

  /** "Vaciar semana" / "Empezar de cero": confirmed, sends `force` (API 409s otherwise). */
  function handleClearWeek() {
    if (!user) return
    if (
      menu &&
      typeof window !== "undefined" &&
      !window.confirm(
        "¿Vaciar esta semana? Se borrarán los platos actuales, salvo los fijados (queda como historial). Podrás rellenar a mano o volver a generar.",
      )
    ) {
      return
    }
    haptic.medium()
    generateMenu.mutate({ userId: user.id, weekStart, empty: true, force: true })
  }

  /** Per-slot mutations + context, shared by every view. */
  const slotPropsFor = useCallback(
    (day: number): SlotPropsFn =>
      (meal: string, slot: MealSlot) => {
        const menuId = menu!.id
        const base = { menuId, day, meal }
        const handlers: SlotHandlers = {
          regenerate: () => {
            haptic.medium()
            regenerateMeal.mutate(base)
          },
          pickRecipe: (recipeId) => {
            haptic.medium()
            regenerateMeal.mutate({ ...base, recipeId })
          },
          toggleLock: () => lockMeal.mutate({ ...base, locked: !isLockedAt(day, meal) }),
          remove: () => {
            haptic.medium()
            deleteMealSlot.mutate(base)
          },
          setServings: (servings) => updateSlotServings.mutate({ ...base, servings }),
          ban: (recipeId) => {
            haptic.medium()
            banRecipe.mutate({ menuId, recipeId })
          },
          setPinnedType: (pinnedType) => {
            haptic.light()
            setSlotPinnedType.mutate({ ...base, pinnedType })
          },
          addDish: (payload) => {
            haptic.light()
            addDish.mutate({ ...base, payload })
          },
          addRandomDish: () => {
            haptic.medium()
            addRandomDish.mutate(base)
          },
          removeDish: (position) => {
            haptic.medium()
            removeDish.mutate({ ...base, position })
          },
          regenerateDish: (position) => {
            haptic.medium()
            regenerateDish.mutate({ ...base, position })
          },
          reorderDish: (from, to) => patchDish.mutate({ ...base, position: from, patch: { newPosition: to } }),
          editNote: (position, text) => patchDish.mutate({ ...base, position, patch: { text } }),
        }
        return {
          handlers,
          ctx: {
            menuId,
            day,
            meal,
            slot,
            dayLabel: `${weekdayName(day)} ${dateOfDay(weekStart, day).getDate()}`,
            isLocked: isLockedAt(day, meal),
            defaultDiners,
            isRegenerating: regenerateMeal.isPending,
          },
        }
      },
    // Mutation objects are stable per hook instance; `menu` drives the rest.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menu, weekStart, defaultDiners, isLockedAt, regenerateMeal.isPending],
  )

  const onMoveSlot = useCallback(
    (p: { fromDay: number; fromMeal: MealKey; toDay: number; toMeal: MealKey }) => {
      if (!menu) return
      haptic.medium()
      moveMealSlot.mutate({ menuId: menu.id, ...p })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [menu],
  )

  if (authLoading || !user) {
    // Not `return null`: a blank cream screen while auth re-hydrates read as
    // a broken page. Quiet, in place — no full-screen splash.
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-cream">
        <div className="text-eyebrow">Cargando...</div>
      </div>
    )
  }

  const weekRange = weekRangeLabel(weekStart)
  const showWeekGrid = !isDesktop && viewMode === "week"
  const heading = dayHeading(weekStart, selectedDay, todayIndex, { withDate: isDesktop })
  const days = (menu?.days ?? []) as DayMenu[]
  const blankWeek = Boolean(menu) && !weekHasDishes(days) && !isPastWeek
  const skippedDays = menu?.skippedDays ?? []
  const banned = !isPastWeek && menu ? menu.bannedRecipeIds ?? [] : []

  const weekSheet = (
    <WeekActionsSheet
      open={weekSheetOpen}
      onClose={() => setWeekSheetOpen(false)}
      weekLabel={weekLabel(weekStart)}
      weekRange={weekRange}
      isCurrentWeek={isCurrentWeek}
      isPastWeek={isPastWeek}
      hasMenu={Boolean(menu)}
      isGenerating={generateMenu.isPending}
      viewMode={viewMode}
      showViewToggle={!isDesktop}
      onPrevWeek={() => {
        haptic.light()
        setWeekStart(shiftWeek(weekStart, -1))
      }}
      onNextWeek={() => {
        haptic.light()
        setWeekStart(shiftWeek(weekStart, 1))
      }}
      onThisWeek={() => setWeekStart(getWeekStart())}
      onRegenerate={handleGenerate}
      onShare={handleShareWeek}
      onClear={handleClearWeek}
      onToggleView={() => {
        haptic.light()
        setViewMode(viewMode === "day" ? "week" : "day")
      }}
    />
  )

  const moreButton = (
    <button
      type="button"
      onClick={() => setWeekSheetOpen(true)}
      aria-label="Opciones de la semana"
      aria-haspopup="dialog"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-paper text-ink transition-colors hover:bg-cream-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <MoreHorizontal size={20} strokeWidth={2} />
    </button>
  )

  const backToToday = !isCurrentWeek && (
    <button
      type="button"
      onClick={() => {
        haptic.light()
        setWeekStart(getWeekStart())
      }}
      className="-ml-1 inline-flex min-h-[36px] w-fit items-center gap-1 rounded-full px-1 text-[13px] font-medium text-ink underline underline-offset-4 hover:text-terracotta-deep"
    >
      {weekLabel(weekStart)} · volver a hoy
    </button>
  )

  const h1 = showWeekGrid ? (
    <h1 className="font-serif-text text-[30px] font-[650] leading-[1.1] text-ink">
      Tu <span className="font-medium italic text-terracotta-deep">semana</span>
    </h1>
  ) : (
    <h1 className="font-serif-text text-[30px] font-[650] leading-[1.1] text-ink lg:text-[40px] lg:leading-[1.05]">
      {heading.lead}
      <span className="font-medium italic text-terracotta-deep">{heading.accent}</span>
      {heading.tail}
    </h1>
  )

  const eyebrow = (
    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted lg:text-[12px]">{weekRange}</p>
  )

  /* ── States without a usable menu ─────────────────────────── */
  const loadFailed = menuFailed && !menu
  // While a week loads (first visit or week navigation) the header, strip
  // and week sheet stay mounted; only the content area waits.
  const statusCard = menuLoading ? (
    <div className="mx-4 mt-10 text-center text-eyebrow" role="status">
      Cargando...
    </div>
  ) : loadFailed ? (
    <div role="alert" className="mx-4 mt-6 rounded-[22px] border border-border bg-paper px-6 py-10 text-center">
      <p className="font-serif-text font-[650] text-xl text-ink">
        No hemos podido <span className="italic">cargar tu menú</span>.
      </p>
      <p className="mx-auto mt-2 max-w-xs text-[14px] text-ink-soft">
        Tu semana sigue guardada. Revisa la conexión y vuelve a intentarlo.
      </p>
      <button
        type="button"
        onClick={() => refetchMenu()}
        disabled={menuFetching}
        className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-medium text-cream transition-colors hover:bg-forest disabled:opacity-50"
      >
        {menuFetching ? "Cargando..." : "Reintentar"}
      </button>
    </div>
  ) : !menu || blankWeek ? (
    <div className="mx-4 mt-5 rounded-[22px] border border-dashed border-border bg-paper px-6 py-8 text-center">
      <p className="font-serif-text font-[650] text-xl text-ink">
        {isPastWeek ? (
          <>
            Sin menú <span className="italic">esta semana</span>.
          </>
        ) : (
          <>
            Tu semana está <span className="italic">en blanco</span>.
          </>
        )}
      </p>
      <p className="mx-auto mt-2 max-w-xs text-[14px] text-ink-soft">
        {isPastWeek
          ? "Esta semana ya pasó. Vuelve a la actual para planificar."
          : "Genera tu menú y la lista de la compra sale automática. O rellena tú los huecos."}
      </p>
      {!isPastWeek && (
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generateMenu.isPending}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-semibold text-cream transition-colors hover:bg-forest disabled:opacity-50"
          >
            <Sparkles size={15} />
            {generateMenu.isPending ? "Generando..." : "Generar mi menú"}
          </button>
          {!menu && (
            <button
              type="button"
              onClick={handleClearWeek}
              disabled={generateMenu.isPending}
              className="inline-flex min-h-[44px] items-center rounded-full border border-border bg-paper px-4 text-[14px] text-ink-mid transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
            >
              Empezar de cero
            </button>
          )}
        </div>
      )}
    </div>
  ) : null

  const extras = (
    <>
      {banned.length > 0 && menu && (
        <BannedRecipesPanel
          className="mx-4 lg:mx-0"
          bannedRecipeIds={banned}
          onUnban={(recipeId) => {
            haptic.light()
            unbanRecipe.mutate({ menuId: menu.id, recipeId })
          }}
        />
      )}
      {/* Cook from pantry: renders only when the household has matches. */}
      <div className="lg:-mx-5">
        <PantryMatchCard />
      </div>
    </>
  )

  /* ── Desktop (lg+) ─────────────────────────── */
  if (isDesktop) {
    const header = (
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          {eyebrow}
          {h1}
          {backToToday}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {menu && (
            <button
              type="button"
              onClick={handleShareWeek}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-paper px-4 text-[14px] font-medium text-ink transition-colors hover:border-ink"
            >
              <Share2 size={15} /> Compartir semana
            </button>
          )}
          {!isPastWeek && menu && (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={generateMenu.isPending}
              className="inline-flex h-11 items-center gap-2 rounded-full border border-border bg-paper px-4 text-[14px] font-medium text-ink transition-colors hover:border-ink disabled:opacity-50"
            >
              <RefreshCw size={15} className={generateMenu.isPending ? "animate-spin" : ""} />
              Regenerar semana
            </button>
          )}
          {moreButton}
        </div>
      </div>
    )
    return (
      <div className="min-h-screen bg-cream">
        {menu && !loadFailed ? (
          <MenuDesktop
            header={
              <>
                {header}
                <NoHealthDataNotice />
                {statusCard}
              </>
            }
            weekStart={weekStart}
            days={days}
            todayIndex={todayIndex}
            selectedDay={selectedDay}
            skippedDays={skippedDays}
            readOnly={isPastWeek}
            isAddingMeal={addMealSlot.isPending}
            slotPropsFor={slotPropsFor}
            onSelectDay={(d) => {
              haptic.light()
              setSelectedDay(d)
            }}
            onMoveSlot={onMoveSlot}
            onUnskipDay={(d) => {
              haptic.light()
              unskipDay.mutate({ menuId: menu.id, day: d })
            }}
            onSkipDay={(d) => {
              haptic.medium()
              skipDay.mutate({ menuId: menu.id, day: d })
            }}
            onAddMeal={(d, meal) => {
              haptic.light()
              addMealSlot.mutate({ menuId: menu.id, day: d, meal })
            }}
            footer={extras}
          />
        ) : (
          <div className="mx-auto flex max-w-[1180px] flex-col gap-4 px-12 pt-8 pb-10">
            {header}
            <NoHealthDataNotice />
            {statusCard}
          </div>
        )}
        {weekSheet}
      </div>
    )
  }

  /* ── Mobile ─────────────────────────── */
  const day = days[selectedDay]
  const { featured, rest } = splitDay(day)
  const isSkipped = skippedDays.includes(selectedDay)

  return (
    <div className="min-h-screen bg-cream pb-6">
      <header className="flex items-center justify-between gap-2 px-5 pt-3">
        <div className="flex min-w-0 flex-col gap-0.5">
          {eyebrow}
          {h1}
          {backToToday}
        </div>
        {moreButton}
      </header>

      <NoHealthDataNotice />

      {!showWeekGrid && (
        <WeekStrip
          weekStart={weekStart}
          selectedDay={selectedDay}
          todayIndex={todayIndex}
          skippedDays={skippedDays}
          onSelectDay={(i) => {
            haptic.light()
            setSelectedDay(i)
          }}
        />
      )}

      {statusCard}

      {menu && !loadFailed && (
        showWeekGrid ? (
          <div className="mt-4">
            <WeekGridView
              days={menu.days as never}
              weekStart={weekStart}
              todayIndex={todayIndex}
              skippedDays={skippedDays}
              lockedSlots={menu.locked as never}
              defaultDiners={defaultDiners}
              onSelectDay={(d) => {
                setSelectedDay(d)
                setViewMode("day")
              }}
              onSelectRecipe={(recipeId) => {
                haptic.light()
                router.push(`/recipes/${recipeId}`)
              }}
              onMoveSlot={onMoveSlot}
              onUnskipDay={(d) => {
                haptic.light()
                unskipDay.mutate({ menuId: menu.id, day: d })
              }}
              onRandomize={(d, m) => {
                haptic.medium()
                regenerateMeal.mutate({ menuId: menu.id, day: d, meal: m })
              }}
              onBan={(_d, _m, recipeId) => {
                haptic.medium()
                banRecipe.mutate({ menuId: menu.id, recipeId })
              }}
              onRemove={(d, m) => {
                haptic.medium()
                deleteMealSlot.mutate({ menuId: menu.id, day: d, meal: m })
              }}
              onAddRecipe={(d, m, recipeId) => {
                haptic.medium()
                regenerateMeal.mutate({ menuId: menu.id, day: d, meal: m, recipeId })
              }}
              onPickRecipe={(d, m, recipeId) => {
                haptic.medium()
                regenerateMeal.mutate({ menuId: menu.id, day: d, meal: m, recipeId })
              }}
              onToggleLock={(d, m, nextLocked) => lockMeal.mutate({ menuId: menu.id, day: d, meal: m, locked: nextLocked })}
              onAddDish={(d, m, payload) => {
                haptic.light()
                addDish.mutate({ menuId: menu.id, day: d, meal: m, payload })
              }}
              onAddRandomDish={(d, m) => {
                haptic.medium()
                addRandomDish.mutate({ menuId: menu.id, day: d, meal: m })
              }}
              onEditNote={(d, m, position, text) =>
                patchDish.mutate({ menuId: menu.id, day: d, meal: m, position, patch: { text } })
              }
              onRemoveDish={(d, m, position) => {
                haptic.medium()
                removeDish.mutate({ menuId: menu.id, day: d, meal: m, position })
              }}
            />
          </div>
        ) : isSkipped ? (
          <SkippedDay
            readOnly={isPastWeek}
            onUnskip={() => {
              haptic.light()
              unskipDay.mutate({ menuId: menu.id, day: selectedDay })
            }}
          />
        ) : (
          <>
            <DayMeals featured={featured} rest={rest} slotProps={slotPropsFor(selectedDay)} readOnly={isPastWeek} />
            {!isPastWeek && (
              <div className="mt-5">
                <DayFooter
                  dayName={weekdayName(selectedDay)}
                  missing={missingMeals(day)}
                  canSkip={orderedSlots(day).length > 0}
                  isAdding={addMealSlot.isPending}
                  onAddMeal={(meal) => {
                    haptic.light()
                    addMealSlot.mutate({ menuId: menu.id, day: selectedDay, meal })
                  }}
                  onSkip={() => {
                    haptic.medium()
                    skipDay.mutate({ menuId: menu.id, day: selectedDay })
                  }}
                />
              </div>
            )}
          </>
        )
      )}

      <div className="mt-6 flex flex-col gap-4">{menu && !loadFailed && extras}</div>

      {weekSheet}
    </div>
  )
}
