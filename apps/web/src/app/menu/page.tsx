"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { motion, AnimatePresence } from "motion/react"
import { useAuth } from "@/lib/auth"
import { useMenu, useGenerateMenu, useRegenerateMeal } from "@/hooks/useMenu"
import { haptic } from "@/lib/pwa/haptics"
import { recordMenuVisit } from "@/lib/pwa/installPrompt"
import { RefreshCw, Lock, Unlock, Sparkles, Replace } from "lucide-react"
import { useLockMeal } from "@/hooks/useMenu"
import { mealLabel } from "@/lib/labels"
import { RecipePickerSheet } from "@/components/menu/RecipePickerSheet"

const DAY_NAMES = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"]
const DAY_SHORT = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"]
const MEAL_ORDER = ["breakfast", "lunch", "dinner", "snack"]

function getWeekStart(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`
}

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]

export default function MenuPage() {
  const { user, isLoading: authLoading } = useAuth()
  const weekStart = useMemo(() => getWeekStart(), [])

  const { data: menu, isLoading: menuLoading } = useMenu(user?.id, weekStart)
  const generateMenu = useGenerateMenu()
  const regenerateMeal = useRegenerateMeal()
  const lockMeal = useLockMeal()

  const [selectedDay, setSelectedDay] = useState(() => {
    const now = new Date()
    const day = now.getDay()
    return day === 0 ? 6 : day - 1
  })

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
      </header>

      {/* Week Strip */}
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
            Tu semana está <span className="font-italic italic">en blanco</span>.
          </p>
          <p className="mt-2 max-w-xs mx-auto text-[13px] text-[#7A7066]">
            Genera tu menú y la lista de la compra sale automática.
          </p>
          <button
            onClick={handleGenerate}
            disabled={generateMenu.isPending}
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#1A1612] px-5 py-2.5 text-[13px] font-medium text-[#FAF6EE] transition-all hover:gap-3 hover:bg-[#2D6A4F] disabled:opacity-50"
          >
            <Sparkles size={14} />
            {generateMenu.isPending ? "Generando..." : "Generar mi menú"}
          </button>
        </div>
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
            <button
              onClick={handleGenerate}
              disabled={generateMenu.isPending}
              className="flex items-center gap-1.5 rounded-full border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-1.5 text-[11px] uppercase tracking-[0.12em] text-[#1A1612] transition-colors hover:bg-[#1A1612] hover:text-[#FAF6EE] disabled:opacity-50"
            >
              <RefreshCw size={11} className={generateMenu.isPending ? "animate-spin" : ""} />
              Regenerar semana
            </button>
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
                  {selectedDayMeals.map((meal: any, i: number) => (
                    <EditorialMealCard
                      key={meal.type}
                      meal={meal}
                      index={i}
                      day={selectedDay}
                      isLocked={isLocked(meal.type)}
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
                      isRegenerating={regenerateMeal.isPending}
                    />
                  ))}
                </motion.div>
              </AnimatePresence>
            ) : (
              <div className="rounded-2xl border border-dashed border-[#DDD6C5] bg-[#FFFEFA] py-12 text-center">
                <p className="font-italic italic text-[#7A7066]">Sin platos para este día.</p>
                <button
                  onClick={handleGenerate}
                  className="mt-3 text-[12px] font-medium text-[#2D6A4F] underline"
                >
                  Generar menú
                </button>
              </div>
            )}
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
  onRegenerate,
  onPickRecipe,
  onToggleLock,
  isRegenerating,
}: {
  meal: { type: string; recipeId?: string; recipeName?: string }
  index: number
  day: number
  isLocked: boolean
  onRegenerate: () => void
  onPickRecipe: (r: { id: string; name: string }) => void
  onToggleLock: () => void
  isRegenerating: boolean
}) {
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
            src={fallbackImg}
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
            <h3 className="font-display text-xl leading-tight text-[#FAF6EE]">
              {meal.recipeName}
            </h3>
          </div>
        </div>
      </Link>

      {/* Action row */}
      <div className="flex items-center gap-2 px-3 py-2.5">
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
        <Link
          href={`/recipes/${meal.recipeId}`}
          className="ml-auto text-[11px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]"
        >
          Ver receta →
        </Link>
      </div>

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
    </motion.article>
  )
}
