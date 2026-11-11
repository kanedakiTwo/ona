"use client"

/**
 * A menu change shows at once (lib/menuOptimistic.ts); when the API says no,
 * the week goes back as it was and this line says so for a few seconds
 * (2026-11-10). When changes were queued behind the failed one they go back
 * too, never sent, and it says how many. Ink pill above the tab bar (bottom of the page at lg+).
 */
import { useEffect, useState } from "react"
import { MENU_CHANGE_FAILED_EVENT } from "@/hooks/useMenu"

export function ChangeFailedNotice() {
  // How many changes went back: the one that failed and the ones queued behind it.
  const [undone, setUndone] = useState(0)
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const on = (e: Event) => {
      const n = Number((e as CustomEvent<{ undone?: number }>).detail?.undone ?? 1)
      setUndone(Number.isFinite(n) && n > 0 ? n : 1)
      clearTimeout(timer)
      timer = setTimeout(() => setUndone(0), 6000)
    }
    window.addEventListener(MENU_CHANGE_FAILED_EVENT, on)
    return () => {
      window.removeEventListener(MENU_CHANGE_FAILED_EVENT, on)
      clearTimeout(timer)
    }
  }, [])
  if (undone === 0) return null
  return (
    <p
      role="alert"
      data-testid="menu-change-failed"
      className="fixed bottom-[calc(5.5rem+var(--safe-bottom))] left-1/2 z-[70] w-[calc(100%-32px)] max-w-[420px] -translate-x-1/2 rounded-2xl bg-ink px-4 py-3 text-center text-[14px] text-cream shadow-lg lg:bottom-8"
    >
      {undone === 1
        ? "No se ha podido guardar el cambio. Lo he dejado como estaba: prueba otra vez."
        : `No se ha podido guardar; he deshecho ${undone} cambios. Prueba otra vez.`}
    </p>
  )
}
