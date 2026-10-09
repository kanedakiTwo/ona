"use client"

import { Pause, Play, RotateCcw, Timer } from "lucide-react"
import type { StepTimer as StepTimerState } from "@/hooks/useStepTimers"

function formatMmSs(totalSec: number): string {
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}:${s.toString().padStart(2, "0")}`
}

interface StepTimerProps {
  durationMin: number
  state: StepTimerState | undefined
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onReset: () => void
}

/**
 * Inline timer button used inside a step. Renders one of three shapes:
 * - never started yet → "Iniciar 30:00"
 * - running          → "12:34 ⏸"
 * - paused           → "12:34 ▶"
 *
 * The expired banner is owned by `<CookingShell>` (a single global
 * banner area). This component just stops counting.
 */
export function StepTimer({
  durationMin,
  state,
  onStart,
  onPause,
  onResume,
  onReset,
}: StepTimerProps) {
  const initialLabel = formatMmSs(Math.round(durationMin * 60))

  if (!state) {
    return (
      <button
        type="button"
        onClick={onStart}
        className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-4 text-[14px] font-semibold text-paper transition-transform active:scale-95"
        aria-label={`Iniciar temporizador de ${durationMin} minutos`}
      >
        <Timer size={15} />
        <span className="font-mono tabular-nums">{initialLabel}</span>
        <span>Iniciar</span>
      </button>
    )
  }

  if (state.expired) {
    // The shell shows the alert banner; here we just offer to restart.
    return (
      <button
        type="button"
        onClick={onReset}
        className="inline-flex h-11 items-center gap-2 rounded-full bg-terracotta-deep px-4 text-[14px] font-semibold text-paper transition-transform active:scale-95"
        aria-label="Reiniciar temporizador"
      >
        <RotateCcw size={15} />
        <span>Reiniciar</span>
      </button>
    )
  }

  return (
    <div className="inline-flex h-11 items-center gap-0.5 rounded-full bg-ink pl-3.5 text-paper">
      <Timer size={15} className="text-paper/70" aria-hidden />
      <span className="ml-1.5 mr-0.5 font-mono text-[14px] font-semibold tabular-nums">
        {formatMmSs(state.remainingSec)}
      </span>
      {state.running ? (
        <button
          type="button"
          onClick={onPause}
          className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-paper/15 active:scale-90"
          aria-label="Pausar temporizador"
        >
          <Pause size={15} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onResume}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-paper text-ink ring-4 ring-ink transition-transform active:scale-90"
          aria-label="Reanudar temporizador"
        >
          <Play size={15} fill="currentColor" strokeWidth={0} />
        </button>
      )}
      <button
        type="button"
        onClick={onReset}
        className="flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-paper/15 active:scale-90"
        aria-label="Reiniciar temporizador"
      >
        <RotateCcw size={14} />
      </button>
    </div>
  )
}
