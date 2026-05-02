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
        className="inline-flex items-center gap-2 rounded-full bg-[#1A1612] px-4 py-2 text-[13px] font-medium text-[#FAF6EE] transition-transform active:scale-95"
        aria-label={`Iniciar temporizador de ${durationMin} minutos`}
      >
        <Timer size={14} />
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
        className="inline-flex items-center gap-2 rounded-full bg-[#C65D38] px-4 py-2 text-[13px] font-medium text-[#FAF6EE] transition-transform active:scale-95"
        aria-label="Reiniciar temporizador"
      >
        <RotateCcw size={14} />
        <span>Reiniciar</span>
      </button>
    )
  }

  return (
    <div className="inline-flex items-center gap-1.5 rounded-full bg-[#1A1612] py-1 pl-3 pr-1 text-[#FAF6EE]">
      <Timer size={13} className="text-[#95D5B2]" />
      <span className="font-mono tabular-nums text-[13px]">
        {formatMmSs(state.remainingSec)}
      </span>
      {state.running ? (
        <button
          type="button"
          onClick={onPause}
          className="ml-1 flex h-7 w-7 items-center justify-center rounded-full bg-[#FAF6EE]/15 transition-transform active:scale-90"
          aria-label="Pausar temporizador"
        >
          <Pause size={13} />
        </button>
      ) : (
        <button
          type="button"
          onClick={onResume}
          className="ml-1 flex h-7 w-7 items-center justify-center rounded-full bg-[#52B788] text-[#1A1612] transition-transform active:scale-90"
          aria-label="Reanudar temporizador"
        >
          <Play size={13} />
        </button>
      )}
      <button
        type="button"
        onClick={onReset}
        className="flex h-7 w-7 items-center justify-center rounded-full bg-[#FAF6EE]/15 transition-transform active:scale-90"
        aria-label="Reiniciar temporizador"
      >
        <RotateCcw size={12} />
      </button>
    </div>
  )
}
