'use client'

import { Sparkles } from 'lucide-react'
import { WAKE_PHRASE } from '@/hooks/useWakeWord'

/** `/recipes/<id>` (not `/new`, `/edit` or cook mode): it has its own fixed action bar until lg. */
export function isRecipeDetailPath(pathname: string | null): boolean {
  return !!pathname && /^\/recipes\/(?!new\/?$)[^/]+\/?$/.test(pathname)
}

export function isCookPath(pathname: string | null): boolean {
  return !!pathname && /^\/recipes\/[^/]+\/cook(\/|$)/.test(pathname)
}

/**
 * Where the floating button sits, clear of each page's fixed bars:
 * the bottom tab bar (60 px, < md), the recipe detail's action bar (84 px,
 * < lg) and the cook mode's step controls (full-screen, z-100).
 */
export function mimoButtonPosition(pathname: string | null): string {
  if (isCookPath(pathname)) return 'z-[110] bottom-[calc(84px+var(--safe-bottom))] right-4'
  if (isRecipeDetailPath(pathname)) return 'z-40 bottom-[calc(96px+var(--safe-bottom))] right-4 lg:bottom-6 lg:right-6'
  return 'z-40 bottom-[calc(76px+var(--safe-bottom))] right-4 md:bottom-6 md:right-6'
}

export default function MimoButton({ pathname, onOpen, listening }: { pathname: string | null; onOpen: () => void; listening: boolean }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="mimo-button"
      aria-label={listening ? `Hablar con Mimo (también puedes decir «${WAKE_PHRASE}»)` : 'Hablar con Mimo'}
      className={`fixed ${mimoButtonPosition(pathname)} flex h-14 w-14 items-center justify-center rounded-full bg-[#1A1612] text-[#FAF6EE] shadow-[0_8px_24px_-6px_rgba(26,22,18,0.45)] ring-2 ring-[#FAF6EE] transition-transform hover:bg-[#2D6A4F] active:scale-95`}
    >
      <Sparkles size={22} strokeWidth={1.8} aria-hidden />
      {listening && <span className="absolute right-1.5 top-1.5 h-2.5 w-2.5 animate-pulse rounded-full bg-[#C65D38]" aria-hidden />}
    </button>
  )
}
