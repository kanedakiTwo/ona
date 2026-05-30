"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { motion, AnimatePresence } from "motion/react"
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
  useMarkLeftover,
  useSetSlotPinnedType,
} from "@/hooks/useMenu"
import { MEAL_TYPE_TAGS, MEAL_TYPE_TAG_LABELS } from "@ona/shared"
import { useUser } from "@/hooks/useUser"
import { haptic } from "@/lib/pwa/haptics"
import { recordMenuVisit } from "@/lib/pwa/installPrompt"
import {
  Ban,
  CalendarX,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Grid3x3,
  LayoutList,
  Lock,
  Minus,
  Pin,
  Plus,
  RefreshCw,
  Replace,
  RotateCw,
  Sparkles,
  Tag,
  Trash2,
  Unlock,
  Users,
  Utensils,
} from "lucide-react"
import { mealLabel } from "@/lib/labels"
import { RecipePickerSheet } from "@/components/menu/RecipePickerSheet"
import { WeekGridView } from "@/components/menu/WeekGridView"
import { CookedBadge } from "@/components/recipes/CookedBadge"
import { PantryMatchCard } from "@/components/menu/PantryMatchCard"

const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
const DAY_SHORT = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"]
const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snack"]

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
  const next = new Date(y, (m ?? 1) - 1, (d ?? 1))
  next.setDate(next.getDate() + deltaWeeks * 7)
  return mondayOf(next)
}

/** YYYY-MM-DD passed validation? (form + parses to a real date) */
function isValidWeekStart(s: string | null): s is string {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  return (
    date.getFullYear() === y &&
    date.getMonth() === m - 1 &&
    date.getDate() === d &&
    date.getDay() === 1 // must be a Monday
  )
}

/** Whole-week delta from current Monday to `weekStart`. Negative = past. */
function weeksFromNow(weekStart: string): number {
  const today = new Date(getWeekStart() + "T00:00:00")
  const target = new Date(weekStart + "T00:00:00")
  return Math.round((target.getTime() - today.getTime()) / (7 * 24 * 60 * 60 * 1000))
}

/**
 * Human-readable label for the chosen week:
 *   delta 0  → "Esta semana"
 *   delta 1  → "Próxima semana"
 *   delta -1 → "Semana pasada"
 *   delta n  → "En N semanas" / "Hace N semanas"
 */
function weekLabel(weekStart: string): string {
  const d = weeksFromNow(weekStart)
  if (d === 0) return "Esta semana"
  if (d === 1) return "Próxima semana"
  if (d === -1) return "Semana pasada"
  if (d > 1) return `En ${d} semanas`
  return `Hace ${-d} semanas`
}

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]
const MONTHS_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"]

/** "11–17 may" style range string from a Monday weekStart. */
function weekRangeShort(weekStart: string): string {
  const start = new Date(weekStart + "T00:00:00")
  const end = new Date(start)
  end.setDate(start.getDate() + 6)
  const sameMonth = start.getMonth() === end.getMonth()
  if (sameMonth) {
    return `${start.getDate()}–${end.getDate()} ${MONTHS_SHORT[start.getMonth()]}`
  }
  return `${start.getDate()} ${MONTHS_SHORT[start.getMonth()]} – ${end.getDate()} ${MONTHS_SHORT[end.getMonth()]}`
}

export default function MenuPage() {
  const { user, isLoading: authLoading } = useAuth()
  const router = useRouter()

  // Read initial week from `?week=YYYY-MM-DD` so the URL is shareable /
  // back-forward-able. Defaults to the current Monday. We avoid
  // `useSearchParams` here for the same reason cook/page.tsx does — it
  // forces a Suspense boundary at build time and broke a sibling route
  // in commit 5c1af4c.
  const [weekStart, setWeekStartState] = useState<string>(() => {
    if (typeof window === "undefined") return getWeekStart()
    const raw = new URLSearchParams(window.location.search).get("week")
    return isValidWeekStart(raw) ? raw : getWeekStart()
  })

  const setWeekStart = useCallback((next: string) => {
    setWeekStartState(next)
    if (typeof window === "undefined") return
    const url = new URL(window.location.href)
    if (next === getWeekStart()) {
      url.searchParams.delete("week") // omit ?week= when on current week → cleaner URL
    } else {
      url.searchParams.set("week", next)
    }
    window.history.replaceState(null, "", url.toString())
  }, [])

  const delta = useMemo(() => weeksFromNow(weekStart), [weekStart])
  const isPastWeek = delta < 0
  const isCurrentWeek = delta === 0

  const { data: menu, isLoading: menuLoading } = useMenu(user?.id, weekStart)
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
  const markLeftover = useMarkLeftover()
  const setSlotPinnedType = useSetSlotPinnedType()
  // Live user profile so we can fall back to the household diner count when
  // a slot doesn't have a per-day servings override.
  const { data: profile } = useUser(user?.id)
  const householdDiners =
    (profile?.adults as number | undefined ?? user?.adults ?? 0) +
    (profile?.kidsCount as number | undefined ?? user?.kidsCount ?? 0)
  const defaultDiners = Math.max(1, householdDiners || 2)

  const [selectedDay, setSelectedDay] = useState(() => {
    const now = new Date()
    const day = now.getDay()
    return day === 0 ? 6 : day - 1
  })

  // "Vista día" (current scroll-by-day UX) vs "Vista semana" (compact grid
  // that shows the whole week at a glance). Persisted in localStorage so the
  // user's preference sticks across visits.
  const [viewMode, setViewModeState] = useState<"day" | "week">("day")
  useEffect(() => {
    if (typeof window === "undefined") return
    const stored = window.localStorage.getItem("ona.menu.view")
    if (stored === "week" || stored === "day") setViewModeState(stored)
  }, [])
  const setViewMode = useCallback((next: "day" | "week") => {
    setViewModeState(next)
    if (typeof window !== "undefined") {
      window.localStorage.setItem("ona.menu.view", next)
    }
  }, [])

  // When the user navigates to a different week, reset the day picker:
  //   - Current week → land on today
  //   - Any other week → land on Monday
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

  const start = useMemo(() => new Date(weekStart + "T00:00:00"), [weekStart])
  const issueNumber = useMemo(() => {
    const yearStart = new Date(start.getFullYear(), 0, 1)
    return Math.ceil((start.getTime() - yearStart.getTime()) / (1000 * 60 * 60 * 24 * 7))
  }, [start])

  const weekDays = useMemo(() => {
    return DAY_SHORT.map((label, i) => {
      const d = new Date(start)
      d.setDate(start.getDate() + i)
      const hasMenu = menu?.days?.[i]
        ? Object.values(menu.days[i]).some((slot: any) => slot?.recipeId)
        : false
      return { label, date: d.getDate(), hasMenu }
    })
  }, [start, menu])

  const todayIndex = useMemo(() => {
    const now = new Date()
    const diff = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24))
    return diff >= 0 && diff <= 6 ? diff : -1
  }, [start])

  const plannedCount = useMemo(() => {
    if (!menu?.days) return 0
    return menu.days.filter((day: any) =>
      day && Object.values(day).some((slot: any) => slot?.recipeId)
    ).length
  }, [menu])

  const selectedDayMeals = useMemo(() => {
    if (!menu?.days?.[selectedDay]) return []
    const day = menu.days[selectedDay]
    return MEAL_ORDER
      .filter((meal) => day[meal])
      .map((meal) => ({ type: meal, ...day[meal] }))
  }, [menu, selectedDay])

  const isLocked = (meal: string) => {
    return Boolean((menu?.locked as any)?.[String(selectedDay)]?.[meal])
  }

  function handleGenerate() {
    if (!user) return
    haptic.medium()
    generateMenu.mutate({ userId: user.id, weekStart })
  }

  if (authLoading || menuLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF6EE]">
        <div className="text-eyebrow">Cargando...</div>
      </div>
    )
  }

  if (!user) return null

  return (
    <div className="bg-[#FAF6EE] min-h-screen">
      {/* Editorial Header */}
      <header className="px-5 pt-8 pb-6">
        <div className="flex items-baseline justify-between">
          <div>
            <div className="text-eyebrow mb-1">Menú de la semana</div>
            <div className="font-italic italic text-[11px] text-[#7A7066]">№ {issueNumber} · {start.getFullYear()}</div>
          </div>
          <div className="text-right">
            <div className="font-display text-[10px] uppercase tracking-[0.2em] text-[#7A7066]">
              {MONTHS[start.getMonth()]}
            </div>
          </div>
        </div>

        <h1 className="mt-4 font-display text-[2.6rem] leading-[0.95] tracking-tight text-[#1A1612]">
          Buen <span className="font-italic italic text-[#C65D38]">comer</span>,
          <br />
          {user.username}.
        </h1>

        {/* Week selector */}
        <div className="mt-6 flex items-center justify-between gap-2 rounded-full border border-[#DDD6C5] bg-[#FFFEFA] px-2 py-1.5">
          <button
            type="button"
            onClick={() => {
              haptic.light()
              setWeekStart(shiftWeek(weekStart, -1))
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#1A1612] transition-colors hover:bg-[#F2EDE0]"
            aria-label="Semana anterior"
          >
            <ChevronLeft size={16} />
          </button>
          <div className="flex flex-1 flex-col items-center text-center">
            <span className="text-[11px] uppercase tracking-[0.15em] text-[#1A1612]">
              {weekLabel(weekStart)}
            </span>
            <span className="font-italic italic text-[10px] text-[#7A7066]">
              {weekRangeShort(weekStart)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              haptic.light()
              setWeekStart(shiftWeek(weekStart, 1))
            }}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#1A1612] transition-colors hover:bg-[#F2EDE0]"
            aria-label="Semana siguiente"
          >
            <ChevronRight size={16} />
          </button>
          {!isCurrentWeek && (
            <button
              type="button"
              onClick={() => {
                haptic.light()
                setWeekStart(getWeekStart())
              }}
              className="ml-1 shrink-0 rounded-full bg-[#1A1612] px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-[#FAF6EE]"
            >
              Hoy
            </button>
          )}
        </div>

        {/* View-mode toggle — "vista día" (current) vs "vista semana" (grid). */}
        <div className="mt-3 inline-flex items-center gap-1 rounded-full border border-[#DDD6C5] bg-[#FFFEFA] p-1">
          <button
            type="button"
            onClick={() => {
              haptic.light()
              setViewMode("day")
            }}
            aria-pressed={viewMode === "day"}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors ${
              viewMode === "day"
                ? "bg-[#1A1612] text-[#FAF6EE]"
                : "text-[#7A7066] hover:text-[#1A1612]"
            }`}
          >
            <LayoutList size={11} />
            Día
          </button>
          <button
            type="button"
            onClick={() => {
              haptic.light()
              setViewMode("week")
            }}
            aria-pressed={viewMode === "week"}
            className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors ${
              viewMode === "week"
                ? "bg-[#1A1612] text-[#FAF6EE]"
                : "text-[#7A7066] hover:text-[#1A1612]"
            }`}
          >
            <Grid3x3 size={11} />
            Semana
          </button>
        </div>
      </header>

      {/* PR 12 — cook from pantry: only renders when the household has
          ingredients on hand that match real recipes */}
      {user && <PantryMatchCard />}

      {/* Week Strip — only in "vista día"; the week view has its own
          all-days header inside the grid. */}
      {viewMode === "day" && (
      <div className="border-y border-[#DDD6C5] bg-[#F2EDE0]">
        <div className="flex">
          {weekDays.map((d, i) => {
            const isSelected = i === selectedDay
            const isToday = i === todayIndex
            return (
              <button
                key={i}
                onClick={() => setSelectedDay(i)}
                className={`relative flex flex-1 flex-col items-center gap-0.5 py-3 transition-colors ${
                  isSelected ? "bg-[#1A1612] text-[#FAF6EE]" : ""
                }`}
              >
                <span className={`text-[9px] uppercase tracking-[0.2em] ${
                  isSelected ? "text-[#FAF6EE]/70" : "text-[#7A7066]"
                }`}>
                  {d.label}
                </span>
                <span className={`font-display text-2xl leading-none ${
                  isSelected ? "text-[#FAF6EE]" : isToday ? "text-[#C65D38]" : "text-[#1A1612]"
                }`}>
                  {d.date}
                </span>
                <span className={`mt-1 h-1 w-1 rounded-full transition-opacity ${
                  d.hasMenu
                    ? isSelected ? "bg-[#52B788]" : "bg-[#C65D38]"
                    : "opacity-0"
                }`} />
                {isToday && !isSelected && (
                  <div className="absolute inset-x-0 bottom-0 h-[2px] bg-[#C65D38]" />
                )}
              </button>
            )
          })}
        </div>
      </div>
      )}

      {/* Progress */}
      {menu && (
        <div className="px-5 py-4">
          <div className="flex items-baseline justify-between text-[11px] uppercase tracking-[0.18em] text-[#7A7066]">
            <span>{plannedCount} de 7 días planificados</span>
            <span className="font-italic italic text-[#1A1612] normal-case">
              {Math.round((plannedCount / 7) * 100)}%
            </span>
          </div>
          <div className="mt-2 h-px overflow-hidden bg-[#DDD6C5]">
            <motion.div
              initial={{ scaleX: 0 }}
              animate={{ scaleX: plannedCount / 7 }}
              transition={{ duration: 1, ease: [0.19, 1, 0.22, 1] }}
              style={{ originX: 0 }}
              className="h-full bg-[#1A1612]"
            />
          </div>
        </div>
      )}

      {!menu ? (
        /* Empty state — editorial */
        <div className="mx-5 mt-8 rounded-2xl border border-dashed border-[#DDD6C5] bg-[#FFFEFA] px-6 py-12 text-center">
          <div className="font-display text-5xl leading-none text-[#C65D38]/30">∅</div>
          <p className="mt-4 font-display text-xl text-[#1A1612]">
            {isPastWeek ? (
              <>Sin menú <span className="font-italic italic">esta semana</span>.</>
            ) : (
              <>Tu semana está <span className="font-italic italic">en blanco</span>.</>
            )}
          </p>
          <p className="mt-2 max-w-xs mx-auto text-[13px] text-[#7A7066]">
            {isPastWeek
              ? "Esta semana ya pasó. Vuelve a la actual para planificar."
              : "Genera tu menú y la lista de la compra sale automática."}
          </p>
          {!isPastWeek && (
            <button
              onClick={handleGenerate}
              disabled={generateMenu.isPending}
              className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#1A1612] px-5 py-2.5 text-[13px] font-medium text-[#FAF6EE] transition-all hover:gap-3 hover:bg-[#2D6A4F] disabled:opacity-50"
            >
              <Sparkles size={14} />
              {generateMenu.isPending ? "Generando..." : "Generar mi menú"}
            </button>
          )}
        </div>
      ) : viewMode === "week" ? (
        <>
          {/* All-week grid view. The grid carries its own header row of
              days and meal-row labels; the page just hosts it + the
              regenerate CTA. */}
          <div className="mt-4 flex items-center justify-end px-5">
            {!isPastWeek && (
              <button
                onClick={handleGenerate}
                disabled={generateMenu.isPending}
                className="flex items-center gap-1.5 rounded-full border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[#1A1612] transition-colors hover:bg-[#1A1612] hover:text-[#FAF6EE] disabled:opacity-50"
              >
                <RefreshCw size={11} className={generateMenu.isPending ? "animate-spin" : ""} />
                Regenerar semana
              </button>
            )}
          </div>
          <div className="mt-3">
            <WeekGridView
              days={menu.days as any}
              weekStart={weekStart}
              todayIndex={todayIndex}
              skippedDays={menu.skippedDays ?? []}
              onSelectDay={(d) => {
                setSelectedDay(d)
                setViewMode("day")
              }}
              onSelectRecipe={(recipeId) => {
                haptic.light()
                router.push(`/recipes/${recipeId}`)
              }}
              onMoveSlot={({ fromDay, fromMeal, toDay, toMeal }) => {
                if (!menu) return
                haptic.medium()
                moveMealSlot.mutate({
                  menuId: menu.id,
                  fromDay,
                  fromMeal,
                  toDay,
                  toMeal,
                })
              }}
              onUnskipDay={(d) => {
                if (!menu) return
                haptic.light()
                unskipDay.mutate({ menuId: menu.id, day: d })
              }}
              onRandomize={(d, m) => {
                if (!menu) return
                haptic.medium()
                regenerateMeal.mutate({ menuId: menu.id, day: d, meal: m })
              }}
              onBan={(_d, _m, recipeId) => {
                if (!menu) return
                haptic.medium()
                banRecipe.mutate({ menuId: menu.id, recipeId })
              }}
              onRemove={(d, m) => {
                if (!menu) return
                if (typeof window !== "undefined" && !window.confirm("¿Quitar este plato del día?")) {
                  return
                }
                haptic.medium()
                deleteMealSlot.mutate({ menuId: menu.id, day: d, meal: m })
              }}
            />
          </div>
        </>
      ) : (
        <>
          {/* Day title row */}
          <div className="px-5 mt-6 flex items-end justify-between">
            <div>
              <div className="text-eyebrow text-[#7A7066]">
                {todayIndex === selectedDay ? "Hoy" : "Día"}
              </div>
              <h2 className="mt-1 font-display text-[2rem] leading-none text-[#1A1612]">
                {DAY_NAMES[selectedDay]}
              </h2>
            </div>
            {!isPastWeek && (
              <button
                onClick={handleGenerate}
                disabled={generateMenu.isPending}
                className="flex items-center gap-1.5 rounded-full border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[#1A1612] transition-colors hover:bg-[#1A1612] hover:text-[#FAF6EE] disabled:opacity-50"
              >
                <RefreshCw size={11} className={generateMenu.isPending ? "animate-spin" : ""} />
                Regenerar semana
              </button>
            )}
          </div>

          {/* Meal cards */}
          <div className="px-5 pt-5 pb-12">
            {selectedDayMeals.length > 0 ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={selectedDay}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.4, ease: [0.19, 1, 0.22, 1] }}
                  className="space-y-4"
                >
                  {/* "Saltar día" toolbar. Only when there's something to
                      empty AND the day isn't already skipped. */}
                  {!isPastWeek &&
                    !(menu?.skippedDays ?? []).includes(selectedDay) &&
                    selectedDayMeals.length > 0 ? (
                    <div className="flex items-center justify-end">
                      <button
                        type="button"
                        onClick={() => {
                          if (
                            typeof window === "undefined" ||
                            window.confirm(`¿Marcar ${DAY_NAMES[selectedDay].toLowerCase()} como sin cocinar?`)
                          ) {
                            haptic.medium()
                            skipDay.mutate({ menuId: menu.id, day: selectedDay })
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-full bg-[#F2EDE0] px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[#7A7066] transition-colors hover:bg-[#1A1612] hover:text-[#FAF6EE]"
                      >
                        <CalendarX size={11} />
                        Saltar día
                      </button>
                    </div>
                  ) : null}
                  {selectedDayMeals.map((meal: any, i: number) => (
                    <EditorialMealCard
                      key={meal.type}
                      meal={meal}
                      index={i}
                      day={selectedDay}
                      isLocked={isLocked(meal.type)}
                      readOnly={isPastWeek}
                      defaultDiners={defaultDiners}
                      menuId={menu.id}
                      onRegenerate={() => {
                        haptic.medium()
                        regenerateMeal.mutate({
                          menuId: menu.id,
                          day: selectedDay,
                          meal: meal.type,
                        })
                      }}
                      onPickRecipe={(recipe) => {
                        haptic.medium()
                        regenerateMeal.mutate({
                          menuId: menu.id,
                          day: selectedDay,
                          meal: meal.type,
                          recipeId: recipe.id,
                        })
                      }}
                      onToggleLock={() =>
                        lockMeal.mutate({
                          menuId: menu.id,
                          day: selectedDay,
                          meal: meal.type,
                          locked: !isLocked(meal.type),
                        })
                      }
                      onDelete={() => {
                        haptic.medium()
                        deleteMealSlot.mutate({
                          menuId: menu.id,
                          day: selectedDay,
                          meal: meal.type,
                        })
                      }}
                      onChangeServings={(servings) => {
                        updateSlotServings.mutate({
                          menuId: menu.id,
                          day: selectedDay,
                          meal: meal.type,
                          servings,
                        })
                      }}
                      onBan={() => {
                        if (
                          typeof window === "undefined" ||
                          window.confirm(`¿Vetar "${meal.recipeName}" del resto de la semana?`)
                        ) {
                          haptic.medium()
                          banRecipe.mutate({
                            menuId: menu.id,
                            recipeId: meal.recipeId,
                          })
                        }
                      }}
                      onSetPinnedType={(pinnedType) => {
                        haptic.light()
                        setSlotPinnedType.mutate({
                          menuId: menu.id,
                          day: selectedDay,
                          meal: meal.type,
                          pinnedType,
                        })
                      }}
                      isRegenerating={regenerateMeal.isPending}
                    />
                  ))}

                  {/* "+ Añadir <comida>" affordances for the slots this day
                      is missing (because the user removed them from the
                      weekly template, or never had them). Scoped to this
                      week only — the profile template is untouched. */}
                  {!isPastWeek && menu?.days?.[selectedDay] ? (
                    <AddMealsRow
                      menuId={menu.id}
                      day={selectedDay}
                      presentMeals={selectedDayMeals.map((m: any) => m.type)}
                      onAdd={(meal) => {
                        haptic.light()
                        addMealSlot.mutate({
                          menuId: menu.id,
                          day: selectedDay,
                          meal,
                        })
                      }}
                      isAdding={addMealSlot.isPending}
                    />
                  ) : null}
                </motion.div>
              </AnimatePresence>
            ) : (menu?.skippedDays ?? []).includes(selectedDay) ? (
              <div className="rounded-2xl border border-dashed border-[#DDD6C5] bg-[#FFFEFA] py-12 text-center">
                <CalendarX size={24} className="mx-auto text-[#7A7066]" />
                <p className="mt-3 font-italic italic text-[#7A7066]">
                  Día marcado sin cocinar.
                </p>
                {!isPastWeek && (
                  <button
                    onClick={() => {
                      haptic.light()
                      unskipDay.mutate({ menuId: menu.id, day: selectedDay })
                    }}
                    className="mt-3 inline-flex items-center gap-1.5 text-[12px] font-medium text-[#2D6A4F] underline"
                  >
                    <RotateCw size={11} /> Reactivar día
                  </button>
                )}
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-[#DDD6C5] bg-[#FFFEFA] py-12 text-center">
                <p className="font-italic italic text-[#7A7066]">Sin platos para este día.</p>
                {!isPastWeek && (
                  <button
                    onClick={handleGenerate}
                    className="mt-3 text-[12px] font-medium text-[#2D6A4F] underline"
                  >
                    Generar menú
                  </button>
                )}
              </div>
            )}

            {/* "Vetadas esta semana" panel — collapsible, only when there's
                at least one vetoed recipe. Lets the user un-veto. */}
            {!isPastWeek && menu && (menu.bannedRecipeIds ?? []).length > 0 ? (
              <BannedRecipesPanel
                menuId={menu.id}
                bannedRecipeIds={menu.bannedRecipeIds ?? []}
                onUnban={(recipeId) => {
                  haptic.light()
                  unbanRecipe.mutate({ menuId: menu.id, recipeId })
                }}
              />
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Editorial Meal Card
   ───────────────────────────────────────────── */
function EditorialMealCard({
  meal,
  index,
  day,
  isLocked,
  readOnly,
  defaultDiners,
  onRegenerate,
  onPickRecipe,
  onToggleLock,
  onDelete,
  onChangeServings,
  onBan,
  onSetPinnedType,
  isRegenerating,
  menuId,
}: {
  meal: {
    type: string
    recipeId?: string
    recipeName?: string
    servings?: number | null
    imageUrl?: string | null
    pinnedType?: string | null
    kind?: "planned" | "leftover" | null
    leftoverOf?: { day: number; meal: string } | null
  }
  index: number
  day: number
  isLocked: boolean
  readOnly: boolean
  /** Household-derived diner count used when the slot has no override. */
  defaultDiners: number
  /** The menu this card belongs to — used as context when recording a cook event. */
  menuId: string
  onRegenerate: () => void
  onPickRecipe: (r: { id: string; name: string }) => void
  onToggleLock: () => void
  onDelete: () => void
  onChangeServings: (servings: number | null) => void
  /** Vetar la receta para el resto de la semana. */
  onBan: () => void
  /** Fijar / desfijar etiqueta de tipo de comida (cremas, pizza, …). */
  onSetPinnedType: (next: string | null) => void
  isRegenerating: boolean
}) {
  const [pinSheetOpen, setPinSheetOpen] = useState(false)
  const isLeftover = meal.kind === "leftover"
  const [pickerOpen, setPickerOpen] = useState(false)
  if (!meal.recipeId) {
    return (
      <div className="rounded-2xl border border-dashed border-[#DDD6C5] bg-[#FFFEFA] p-5">
        <div className="text-eyebrow text-[#7A7066]">{mealLabel(meal.type)}</div>
        <p className="mt-2 font-italic italic text-[#7A7066]">Sin asignar.</p>
      </div>
    )
  }

  const fallbackImg = `https://images.unsplash.com/photo-${
    ["1490645935967-10de6ba17061", "1546069901-ba9599a7e63c", "1540420773420-3366772f4999", "1556909114-44e3e9399a2c"][index % 4]
  }?w=800&q=80&auto=format&fit=crop`
  const heroSrc = meal.imageUrl || fallbackImg

  return (
    <motion.article
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.5, ease: [0.19, 1, 0.22, 1] }}
      className="group relative overflow-hidden rounded-2xl bg-[#FFFEFA]"
    >
      <Link href={`/recipes/${meal.recipeId}`} className="block">
        <div className="relative aspect-[16/10] overflow-hidden">
          <img
            src={heroSrc}
            alt={meal.recipeName}
            className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
          />
          {/* Top tags */}
          <div className="absolute inset-x-0 top-0 flex items-start justify-between p-3">
            <div className="rounded-full bg-[#FAF6EE]/95 px-2.5 py-0.5 text-[9px] uppercase tracking-[0.2em] backdrop-blur-sm">
              {mealLabel(meal.type)}
            </div>
            {isLocked && (
              <div className="rounded-full bg-[#C65D38] px-2 py-1 text-[9px] uppercase tracking-[0.15em] text-[#FAF6EE]">
                <Lock size={10} className="inline" /> Fijado
              </div>
            )}
          </div>
          {/* Bottom recipe name overlay */}
          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1A1612]/80 via-[#1A1612]/40 to-transparent p-4 pt-12">
            {isLeftover && meal.leftoverOf ? (
              <div className="mb-1.5 inline-flex items-center gap-1 rounded-full bg-[#C65D38] px-2 py-0.5 text-[9px] uppercase tracking-[0.15em] text-[#FAF6EE]">
                <Utensils size={10} /> Sobras de {DAY_SHORT[meal.leftoverOf.day]?.toLowerCase()} {mealLabel(meal.leftoverOf.meal).toLowerCase()}
              </div>
            ) : null}
            <h3 className="font-display text-xl leading-tight text-[#FAF6EE]">
              {meal.recipeName}
            </h3>
          </div>
        </div>
      </Link>

      {/* Action row */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
        {!readOnly && (
          <>
            <button
              onClick={onToggleLock}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] transition-colors ${
                isLocked
                  ? "bg-[#C65D38] text-[#FAF6EE]"
                  : "bg-[#F2EDE0] text-[#1A1612] hover:bg-[#1A1612] hover:text-[#FAF6EE]"
              }`}
            >
              {isLocked ? <Lock size={11} /> : <Unlock size={11} />}
              {isLocked ? "Fijado" : "Fijar"}
            </button>
            {/* Leftover slots hide Aleatorio / Elegir / Tag — the recipe is
                tied to its source slot. They keep Quitar + Comensales. */}
            {!isLeftover && (
              <>
                <button
                  onClick={() => setPickerOpen(true)}
                  disabled={isLocked || isRegenerating}
                  className="flex items-center gap-1.5 rounded-full bg-[#F2EDE0] px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[#1A1612] transition-colors hover:bg-[#1A1612] hover:text-[#FAF6EE] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Replace size={11} />
                  Elegir
                </button>
                <button
                  onClick={onRegenerate}
                  disabled={isLocked || isRegenerating}
                  className="flex items-center gap-1.5 rounded-full bg-[#F2EDE0] px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[#1A1612] transition-colors hover:bg-[#1A1612] hover:text-[#FAF6EE] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <RefreshCw size={11} className={isRegenerating ? "animate-spin" : ""} />
                  Aleatorio
                </button>
                <button
                  onClick={() => setPinSheetOpen(true)}
                  disabled={isLocked}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                    meal.pinnedType
                      ? "bg-[#2D6A4F] text-[#FAF6EE]"
                      : "bg-[#F2EDE0] text-[#1A1612] hover:bg-[#1A1612] hover:text-[#FAF6EE]"
                  }`}
                >
                  <Tag size={11} />
                  {meal.pinnedType ? MEAL_TYPE_TAG_LABELS[meal.pinnedType as keyof typeof MEAL_TYPE_TAG_LABELS] ?? meal.pinnedType : "Tipo"}
                </button>
                <button
                  onClick={onBan}
                  disabled={isLocked}
                  aria-label="Vetar esta receta para el resto de la semana"
                  className="flex items-center gap-1.5 rounded-full bg-[#F2EDE0] px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[#1A1612] transition-colors hover:bg-[#1A1612] hover:text-[#FAF6EE] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Ban size={11} />
                  Vetar
                </button>
              </>
            )}
            <button
              onClick={() => {
                if (typeof window === "undefined" || window.confirm(`¿Quitar ${mealLabel(meal.type).toLowerCase()} de este día?`)) {
                  onDelete()
                }
              }}
              disabled={isLocked}
              aria-label="Eliminar este plato del día"
              className="flex items-center gap-1.5 rounded-full bg-[#F2EDE0] px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[#C65D38] transition-colors hover:bg-[#C65D38] hover:text-[#FAF6EE] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Trash2 size={11} />
              Quitar
            </button>
          </>
        )}
        {!readOnly && meal.recipeId && (
          <CookedBadge
            recipeId={meal.recipeId}
            menuId={menuId}
            dayIndex={day}
            meal={meal.type}
            variant="button"
          />
        )}
        <Link
          href={`/recipes/${meal.recipeId}`}
          className="ml-auto text-[11px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]"
        >
          Ver receta →
        </Link>
      </div>

      {/* Per-slot diner override. Stays a separate row from the action chips
          to keep the touch targets large on mobile, and so the "Solo hoy"
          caption makes clear this isn't the recipe's authored serving size. */}
      {!readOnly && (
        <DinerStepper
          value={meal.servings ?? null}
          fallback={defaultDiners}
          disabled={isLocked}
          onChange={onChangeServings}
        />
      )}

      <RecipePickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title={`${mealLabel(meal.type)} del día`}
        subtitle={meal.recipeName ? `Ahora: ${meal.recipeName}` : "Sin plato"}
        onPick={(picked) => {
          onPickRecipe(picked)
          setPickerOpen(false)
        }}
      />
      <PinTypeSheet
        open={pinSheetOpen}
        onClose={() => setPinSheetOpen(false)}
        current={meal.pinnedType ?? null}
        onPick={(next) => {
          onSetPinnedType(next)
          setPinSheetOpen(false)
        }}
      />
    </motion.article>
  )
}

/* ─────────────────────────────────────────────
   Pin meal-type bottom sheet
   ───────────────────────────────────────────── */
function PinTypeSheet({
  open,
  onClose,
  current,
  onPick,
}: {
  open: boolean
  onClose: () => void
  current: string | null
  onPick: (next: string | null) => void
}) {
  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[#1A1612]/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[430px] rounded-t-3xl bg-[#FAF6EE] p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <div className="text-eyebrow text-[#7A7066]">Fijar tipo</div>
            <h3 className="mt-1 font-display text-lg text-[#1A1612]">¿Qué tipo de comida?</h3>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-[#7A7066]">
            <ChevronDown size={20} />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {MEAL_TYPE_TAGS.map((tag) => {
            const active = tag === current
            return (
              <button
                key={tag}
                onClick={() => onPick(active ? null : tag)}
                className={`rounded-full px-4 py-2 text-[12px] uppercase tracking-[0.12em] transition-colors ${
                  active
                    ? "bg-[#2D6A4F] text-[#FAF6EE]"
                    : "bg-[#F2EDE0] text-[#1A1612] hover:bg-[#1A1612] hover:text-[#FAF6EE]"
                }`}
              >
                {MEAL_TYPE_TAG_LABELS[tag]}
              </button>
            )
          })}
        </div>
        {current ? (
          <button
            onClick={() => onPick(null)}
            className="mt-4 inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]"
          >
            Quitar pin
          </button>
        ) : (
          <p className="mt-4 text-[11px] uppercase tracking-[0.12em] text-[#7A7066]">
            Aleatorio respetará la etiqueta a partir de ahora
          </p>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   "Vetadas esta semana" collapsible panel
   ───────────────────────────────────────────── */
function BannedRecipesPanel({
  menuId,
  bannedRecipeIds,
  onUnban,
}: {
  menuId: string
  bannedRecipeIds: string[]
  onUnban: (recipeId: string) => void
}) {
  const [open, setOpen] = useState(false)
  // Tiny name lookup — the cached menu carries names on slots, but vetoed
  // recipes might not be in any slot. Fetch on demand from /recipes/:id.
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!open) return
    const missing = bannedRecipeIds.filter((id) => !names[id])
    if (missing.length === 0) return
    Promise.all(
      missing.map((id) =>
        fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/recipes/${id}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => (j?.name ? [id, j.name as string] : null))
          .catch(() => null),
      ),
    ).then((pairs) => {
      const fresh: Record<string, string> = {}
      for (const p of pairs) if (p) fresh[p[0]] = p[1]
      if (Object.keys(fresh).length > 0) setNames((prev) => ({ ...prev, ...fresh }))
    })
  }, [open, bannedRecipeIds, names])
  return (
    <div className="mt-6 rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-4">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 text-[11px] uppercase tracking-[0.12em] text-[#7A7066]">
          <Ban size={12} />
          Vetadas esta semana ({bannedRecipeIds.length})
        </span>
        <ChevronDown
          size={16}
          className={`text-[#7A7066] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <ul className="mt-3 space-y-2 text-[13px] text-[#1A1612]">
          {bannedRecipeIds.map((id) => (
            <li key={id} className="flex items-center justify-between gap-3 border-t border-[#F2EDE0] pt-2 first:border-t-0 first:pt-0">
              <span>{names[id] ?? "Cargando…"}</span>
              <button
                onClick={() => onUnban(id)}
                className="text-[11px] uppercase tracking-[0.12em] text-[#2D6A4F] hover:text-[#1A1612]"
              >
                Levantar veto
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/* ─────────────────────────────────────────────
   Diner stepper for a single slot.
   `null` value = no override; falls back to `fallback` (household).
   The "Quitar" affordance reverts to fallback.
   ───────────────────────────────────────────── */
function DinerStepper({
  value,
  fallback,
  disabled,
  onChange,
}: {
  value: number | null
  fallback: number
  disabled: boolean
  onChange: (next: number | null) => void
}) {
  const effective = value ?? fallback
  const hasOverride = value != null
  const clamp = (n: number) => Math.max(1, Math.min(24, n))

  return (
    <div className="flex items-center justify-between gap-3 border-t border-[#F2EDE0] px-3 py-2">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[#7A7066]">
        <Users size={12} />
        <span>Comensales</span>
        {hasOverride ? (
          <span className="rounded-full bg-[#FAF6EE] px-1.5 text-[9px] text-[#C65D38]">solo hoy</span>
        ) : null}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          aria-label="Menos comensales"
          disabled={disabled || effective <= 1}
          onClick={() => onChange(clamp(effective - 1))}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F2EDE0] text-[#1A1612] transition-colors hover:bg-[#1A1612] hover:text-[#FAF6EE] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Minus size={12} />
        </button>
        <span className="min-w-[1.5rem] text-center text-[14px] font-medium tabular-nums text-[#1A1612]">
          {effective}
        </span>
        <button
          type="button"
          aria-label="Más comensales"
          disabled={disabled || effective >= 24}
          onClick={() => onChange(clamp(effective + 1))}
          className="flex h-7 w-7 items-center justify-center rounded-full bg-[#F2EDE0] text-[#1A1612] transition-colors hover:bg-[#1A1612] hover:text-[#FAF6EE] disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus size={12} />
        </button>
        {hasOverride ? (
          <button
            type="button"
            onClick={() => onChange(null)}
            disabled={disabled}
            className="ml-1 text-[10px] uppercase tracking-[0.12em] text-[#7A7066] underline-offset-2 hover:text-[#C65D38] hover:underline disabled:opacity-40"
          >
            Quitar
          </button>
        ) : null}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   "+ Añadir <comida>" buttons for the slots this day is missing.
   Solidifies the manual-vs-AI balance: the user can shape today's plan
   without touching their saved weekly preferences.
   ───────────────────────────────────────────── */
function AddMealsRow({
  menuId,
  day,
  presentMeals,
  onAdd,
  isAdding,
}: {
  menuId: string
  day: number
  presentMeals: string[]
  onAdd: (meal: string) => void
  isAdding: boolean
}) {
  const missing = MEAL_ORDER.filter((m) => !presentMeals.includes(m))
  if (missing.length === 0) return null

  return (
    <div className="rounded-2xl border border-dashed border-[#DDD6C5] bg-[#FFFEFA] px-4 py-3">
      <div className="text-eyebrow text-[#7A7066]">Añadir comida</div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {missing.map((m) => (
          <button
            key={m}
            type="button"
            disabled={isAdding}
            onClick={() => onAdd(m)}
            className="flex items-center gap-1.5 rounded-full bg-[#F2EDE0] px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[#1A1612] transition-colors hover:bg-[#1A1612] hover:text-[#FAF6EE] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Plus size={11} />
            {mealLabel(m)}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
        Solo afecta a este día / esta semana
      </p>
    </div>
  )
}
