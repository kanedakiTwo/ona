"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion } from "motion/react"
import {
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Timer,
  X,
} from "lucide-react"
import type { Recipe } from "@ona/shared"
import { ServingsScaler } from "@/components/recipes/ServingsScaler"
import { useStepTimers } from "@/hooks/useStepTimers"
import { useWakeLock } from "@/hooks/useWakeLock"
import { haptic } from "@/lib/pwa/haptics"
import { subscribeCookingCommands } from "@/lib/cookingCommands"
import { StepCard, buildIngredientRefCounts } from "./StepCard"
import { ChecklistPanel } from "./ChecklistPanel"

interface CookingShellProps {
  recipe: Recipe
  servings: number
  onServingsChange: (n: number) => void
}

/* ─── Web Audio chime (no asset file) ────────────────────────────── */

let sharedCtx: AudioContext | null = null
function playChime() {
  if (typeof window === "undefined") return
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const Ctor: typeof AudioContext | undefined =
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      window.AudioContext ?? (window as any).webkitAudioContext
    if (!Ctor) return
    sharedCtx ??= new Ctor()
    const ctx = sharedCtx
    if (ctx.state === "suspended") ctx.resume().catch(() => {})

    const now = ctx.currentTime
    // Two short sine pings, classic kitchen-timer feel.
    for (const offset of [0, 0.35]) {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = "sine"
      osc.frequency.setValueAtTime(880, now + offset)
      gain.gain.setValueAtTime(0.0001, now + offset)
      gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + offset + 0.3)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + offset)
      osc.stop(now + offset + 0.32)
    }
  } catch {
    // ignore — best-effort only
  }
}

function vibrateExpire() {
  if (typeof navigator === "undefined") return
  navigator.vibrate?.([200, 100, 200])
}

/* ─── Component ──────────────────────────────────────────────────── */

export function CookingShell({
  recipe,
  servings,
  onServingsChange,
}: CookingShellProps) {
  const router = useRouter()
  const [stepIdx, setStepIdx] = useState(0)
  const [checklistOpen, setChecklistOpen] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  // step indexes whose timer fired and the user hasn't dismissed yet
  const [pendingExpired, setPendingExpired] = useState<number[]>([])

  // Wake lock for the duration of cooking mode.
  useWakeLock(true)

  const totalSteps = recipe.steps.length
  const safeIdx = Math.min(Math.max(0, stepIdx), Math.max(0, totalSteps - 1))
  const currentStep = recipe.steps[safeIdx]
  const nextStep = recipe.steps[safeIdx + 1]

  const refCounts = useMemo(
    () => buildIngredientRefCounts(recipe.steps),
    [recipe.steps],
  )

  // Toggle helper for checklist + inline chips. Stable reference so the
  // StepCard can subscribe-by-prop without re-rendering on every state.
  const toggleIngredient = useCallback((ingredientId: string) => {
    haptic.light()
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(ingredientId)) next.delete(ingredientId)
      else next.add(ingredientId)
      return next
    })
  }, [])

  const handleTimerExpire = useCallback((stepIndexExpired: number) => {
    vibrateExpire()
    playChime()
    setPendingExpired((prev) =>
      prev.includes(stepIndexExpired) ? prev : [...prev, stepIndexExpired],
    )
  }, [])

  const timers = useStepTimers({ onExpire: handleTimerExpire })

  /* ─── Navigation: arrow buttons + keyboard + swipe ─── */

  const goPrev = useCallback(() => {
    if (safeIdx <= 0) return
    haptic.light()
    setStepIdx(safeIdx - 1)
  }, [safeIdx])

  const goNext = useCallback(() => {
    if (safeIdx >= totalSteps - 1) return
    haptic.light()
    setStepIdx(safeIdx + 1)
  }, [safeIdx, totalSteps])

  // Subscribe to assistant-driven cooking commands (voice + text chat).
  useEffect(() => {
    const unsubscribe = subscribeCookingCommands((cmd) => {
      if (cmd.type === 'step.advance') {
        if (cmd.direction === 'next') goNext()
        else if (cmd.direction === 'previous') goPrev()
        // 'repeat' is a no-op — the user just hears the same step again
      } else if (cmd.type === 'timer.start') {
        const idx = typeof cmd.stepIndex === 'number' ? cmd.stepIndex : safeIdx
        timers.start(idx, cmd.minutes)
      }
    })
    return unsubscribe
  }, [goNext, goPrev, safeIdx, timers])

  // Keyboard arrows
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowLeft") goPrev()
      else if (e.key === "ArrowRight") goNext()
      else if (e.key === "Escape") handleExit()
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [goPrev, goNext])

  // Swipe via pointer events — no extra dep.
  const dragStartX = useRef<number | null>(null)
  const dragStartY = useRef<number | null>(null)
  const onPointerDown = (e: React.PointerEvent) => {
    dragStartX.current = e.clientX
    dragStartY.current = e.clientY
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const x0 = dragStartX.current
    const y0 = dragStartY.current
    dragStartX.current = null
    dragStartY.current = null
    if (x0 == null || y0 == null) return
    const dx = e.clientX - x0
    const dy = e.clientY - y0
    if (Math.abs(dx) < 60) return
    if (Math.abs(dy) > Math.abs(dx)) return // mostly vertical → ignore
    if (dx < 0) goNext()
    else goPrev()
  }

  function handleExit() {
    haptic.medium()
    router.push(`/recipes/${recipe.id}`)
  }

  /* ─── Active timer chips (top of screen) ─── */

  const activeTimers = timers.timers.filter((t) => !t.expired)

  // Build a quick lookup: step index → timer state, used by the StepCard.
  const timerByStep = useMemo(() => {
    const m = new Map<number, (typeof timers.timers)[number]>()
    for (const t of timers.timers) m.set(t.stepIndex, t)
    return m
  }, [timers.timers])

  const progressPct = totalSteps > 0 ? ((safeIdx + 1) / totalSteps) * 100 : 0

  /* ─── Render ─── */

  if (totalSteps === 0) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#FAF6EE] px-6 text-center">
        <div className="max-w-sm">
          <p className="font-display text-2xl text-[#1A1612]">
            Esta receta no tiene pasos para cocinar.
          </p>
          <button
            onClick={handleExit}
            className="mt-6 rounded-full bg-[#1A1612] px-5 py-2 text-sm text-[#FAF6EE] active:scale-95"
          >
            Salir
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-[#FAF6EE]">
      {/* Top bar */}
      <header className="flex-none border-b border-[#DDD6C5] bg-[#FAF6EE] px-4 pt-[max(env(safe-area-inset-top),12px)] pb-3">
        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={handleExit}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#DDD6C5] bg-[#FAF6EE] px-3 py-1.5 text-[12px] text-[#1A1612] transition-transform active:scale-95"
            aria-label="Salir del modo cocina"
          >
            <X size={14} />
            Salir
          </button>
          <div className="text-[12px] tabular-nums text-[#7A7066]">
            {safeIdx + 1} / {totalSteps}
          </div>
          <button
            type="button"
            onClick={() => {
              haptic.light()
              setChecklistOpen(true)
            }}
            className="inline-flex items-center gap-1.5 rounded-full border border-[#DDD6C5] bg-[#FAF6EE] px-3 py-1.5 text-[12px] text-[#1A1612] transition-transform active:scale-95"
            aria-label="Abrir lista de ingredientes"
          >
            <ListChecks size={14} />
            <span className="tabular-nums">
              {checked.size}/{recipe.ingredients.length}
            </span>
          </button>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-[#EFE8D8]">
          <motion.div
            className="h-full bg-[#52B788]"
            initial={false}
            animate={{ width: `${progressPct}%` }}
            transition={{ type: "spring", damping: 30, stiffness: 280 }}
          />
        </div>

        {/* Scaler row */}
        <div className="mt-3 flex items-center justify-between gap-2">
          <ServingsScaler
            value={servings}
            onChange={onServingsChange}
            min={1}
            max={12}
          />
          {activeTimers.length > 0 && (
            <div className="flex items-center gap-1.5">
              {activeTimers.map((t) => (
                <ActiveTimerChip
                  key={t.stepIndex}
                  remainingSec={t.remainingSec}
                  paused={t.paused}
                  onClick={() => {
                    haptic.light()
                    setStepIdx(t.stepIndex)
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </header>

      {/* Step pane (swipeable) */}
      <div
        className="relative flex-1 overflow-hidden"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={safeIdx}
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -24 }}
            transition={{ duration: 0.22, ease: [0.19, 1, 0.22, 1] }}
            className="absolute inset-0 overflow-y-auto"
          >
            <StepCard
              step={currentStep}
              stepNumber={safeIdx + 1}
              totalSteps={totalSteps}
              ingredients={recipe.ingredients}
              refCounts={refCounts}
              checkedIngredientIds={checked}
              onToggleIngredient={toggleIngredient}
              timerState={timerByStep.get(safeIdx)}
              onStartTimer={() => {
                if (currentStep.durationMin == null) return
                haptic.medium()
                timers.start(safeIdx, currentStep.durationMin)
              }}
              onPauseTimer={() => {
                haptic.light()
                timers.pause(safeIdx)
              }}
              onResumeTimer={() => {
                haptic.light()
                timers.resume(safeIdx)
              }}
              onResetTimer={() => {
                if (currentStep.durationMin == null) return
                haptic.light()
                timers.reset(safeIdx, currentStep.durationMin)
              }}
              nextStepText={nextStep?.text}
            />
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Expired-timer banner(s) — stacked above bottom nav */}
      <AnimatePresence>
        {pendingExpired.map((idx) => (
          <motion.div
            key={`expired-${idx}`}
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            className="mx-4 mb-2 flex items-center justify-between gap-3 rounded-2xl bg-[#C65D38] px-4 py-3 text-[#FAF6EE] shadow-lg"
            role="alert"
          >
            <div className="flex items-center gap-2">
              <Timer size={16} />
              <span className="text-[14px] font-medium">
                Tiempo terminado · paso {idx + 1}
              </span>
            </div>
            <button
              type="button"
              onClick={() => {
                haptic.medium()
                timers.cancel(idx)
                setPendingExpired((prev) => prev.filter((i) => i !== idx))
              }}
              className="rounded-full bg-[#FAF6EE]/15 px-3 py-1 text-[12px] active:scale-95"
            >
              Listo
            </button>
          </motion.div>
        ))}
      </AnimatePresence>

      {/* Bottom step nav */}
      <nav className="flex-none border-t border-[#DDD6C5] bg-[#FAF6EE] px-4 py-3 pb-[max(env(safe-area-inset-bottom),12px)]">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={goPrev}
            disabled={safeIdx === 0}
            className="inline-flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full border border-[#DDD6C5] bg-[#FAF6EE] text-[14px] font-medium text-[#1A1612] transition-transform active:scale-95 disabled:opacity-40"
            aria-label="Paso anterior"
          >
            <ChevronLeft size={18} />
            Anterior
          </button>
          <button
            type="button"
            onClick={goNext}
            disabled={safeIdx >= totalSteps - 1}
            className="inline-flex h-12 flex-[1.4] items-center justify-center gap-1.5 rounded-full bg-[#1A1612] text-[14px] font-medium text-[#FAF6EE] transition-transform active:scale-95 disabled:opacity-40"
            aria-label="Paso siguiente"
          >
            Siguiente
            <ChevronRight size={18} />
          </button>
        </div>
      </nav>

      {/* Checklist sheet */}
      <ChecklistPanel
        open={checklistOpen}
        onClose={() => setChecklistOpen(false)}
        ingredients={recipe.ingredients}
        checkedIngredientIds={checked}
        onToggle={toggleIngredient}
      />
    </div>
  )
}

/* ─── Active timer pill (top bar) ─── */

function fmt(remainingSec: number): string {
  const m = Math.floor(remainingSec / 60)
  const s = remainingSec % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

function ActiveTimerChip({
  remainingSec,
  paused,
  onClick,
}: {
  remainingSec: number
  paused: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-medium transition-transform active:scale-95 ${
        paused
          ? "bg-[#EFE8D8] text-[#7A7066]"
          : "bg-[#1A1612] text-[#FAF6EE]"
      }`}
      aria-label={paused ? "Temporizador pausado" : "Temporizador en marcha"}
    >
      <Timer size={11} />
      <span className="font-mono tabular-nums">{fmt(remainingSec)}</span>
    </button>
  )
}
