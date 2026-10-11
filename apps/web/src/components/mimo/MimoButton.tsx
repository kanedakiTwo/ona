'use client'

import { MimoiaSymbol } from '@/components/brand/Mimoia'
import { isCookPath } from '@/lib/mimoHandsFree'

/** `/recipes/<id>` (not `/new`, `/edit` or cook mode): it has its own fixed action bar until lg. */
export function isRecipeDetailPath(pathname: string | null): boolean {
  return !!pathname && /^\/recipes\/(?!new\/?$)[^/]+\/?$/.test(pathname)
}

export { isCookPath }

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

export default function MimoButton({ pathname, onOpen }: { pathname: string | null; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="mimo-button"
      aria-label="Hablar con Mimo"
      className={`fixed ${mimoButtonPosition(pathname)} flex h-14 w-14 items-center justify-center rounded-full bg-[#C65D38] text-[#FAF6EE] shadow-[0_8px_24px_-6px_rgba(26,22,18,0.45)] ring-2 ring-[#FAF6EE] transition-transform hover:bg-[#B5432A] active:scale-95`}
    >
      <MimoiaSymbol size={30} />
    </button>
  )
}
