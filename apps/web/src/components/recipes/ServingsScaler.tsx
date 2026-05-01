"use client"

import { AnimatePresence, motion } from "motion/react"
import { Minus, Plus } from "lucide-react"

interface ServingsScalerProps {
  /** Current target servings */
  value: number
  /** Called with the next value when the user presses + or − */
  onChange: (n: number) => void
  /** Lower bound, default 1 */
  min?: number
  /** Upper bound, default 12 */
  max?: number
  className?: string
}

/**
 * Editorial-style diner counter: −  N  +  comensales.
 *
 * Purely presentational. The parent owns the state and refetches on
 * change; this component never touches the network.
 */
export function ServingsScaler({
  value,
  onChange,
  min = 1,
  max = 12,
  className = "",
}: ServingsScalerProps) {
  const canDecrement = value > min
  const canIncrement = value < max

  return (
    <div
      className={`inline-flex items-center gap-2.5 ${className}`}
      role="group"
      aria-label="Comensales"
    >
      <button
        type="button"
        onClick={() => canDecrement && onChange(value - 1)}
        disabled={!canDecrement}
        aria-label="Reducir comensales"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-[#DDD6C5] bg-[#FAF6EE] text-[#1A1612] transition-all active:scale-95 hover:border-[#1A1612] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[#DDD6C5]"
      >
        <Minus size={14} />
      </button>

      <div className="relative flex h-8 min-w-[1.75rem] items-center justify-center overflow-hidden">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value}
            initial={{ opacity: 0, scale: 0.7, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.7, y: -6 }}
            transition={{ duration: 0.18, ease: [0.19, 1, 0.22, 1] }}
            className="font-display text-[1.5rem] leading-none text-[#C65D38]"
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </div>

      <button
        type="button"
        onClick={() => canIncrement && onChange(value + 1)}
        disabled={!canIncrement}
        aria-label="Aumentar comensales"
        className="flex h-8 w-8 items-center justify-center rounded-full border border-[#DDD6C5] bg-[#FAF6EE] text-[#1A1612] transition-all active:scale-95 hover:border-[#1A1612] disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:border-[#DDD6C5]"
      >
        <Plus size={14} />
      </button>

      <span className="text-[12px] uppercase tracking-[0.15em] text-[#7A7066]">
        comensales
      </span>
    </div>
  )
}
