"use client"

/**
 * A menu change shows at once (lib/menuOptimistic.ts); when the API says no,
 * the week goes back as it was and this line says so for a few seconds
 * (2026-11-10). When changes were queued behind the failed one they go back
 * too, never sent, and it says how many. Ink pill above the tab bar (bottom of the page at lg+).
 * The same pill says other short news of a change (`showMenuNotice`: «Guardado
 * en tu semana tipo…», PRO-1186), as a status, not an alert.
 */
import { useEffect, useState } from "react"
import { MENU_CHANGE_FAILED_EVENT } from "@/hooks/useMenu"

const MENU_NOTICE_EVENT = "ona:menu-notice"

/** A short line in the menu's pill for a few seconds (a change that went well but has something to say). */
export function showMenuNotice(text: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(MENU_NOTICE_EVENT, { detail: { text } }))
}

export function ChangeFailedNotice() {
  // How many changes went back: the one that failed and the ones queued behind it.
  const [undone, setUndone] = useState(0)
  const [notice, setNotice] = useState("")
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined
    const later = () => {
      clearTimeout(timer)
      timer = setTimeout(() => {
        setUndone(0)
        setNotice("")
      }, 6000)
    }
    const on = (e: Event) => {
      const n = Number((e as CustomEvent<{ undone?: number }>).detail?.undone ?? 1)
      setUndone(Number.isFinite(n) && n > 0 ? n : 1)
      setNotice("")
      later()
    }
    const onNotice = (e: Event) => {
      setNotice(String((e as CustomEvent<{ text?: string }>).detail?.text ?? ""))
      setUndone(0)
      later()
    }
    window.addEventListener(MENU_CHANGE_FAILED_EVENT, on)
    window.addEventListener(MENU_NOTICE_EVENT, onNotice)
    return () => {
      window.removeEventListener(MENU_CHANGE_FAILED_EVENT, on)
      window.removeEventListener(MENU_NOTICE_EVENT, onNotice)
      clearTimeout(timer)
    }
  }, [])
  if (undone === 0 && !notice) return null
  const pill = "fixed bottom-[calc(5.5rem+var(--safe-bottom))] left-1/2 z-[70] w-[calc(100%-32px)] max-w-[420px] -translate-x-1/2 rounded-2xl bg-ink px-4 py-3 text-center text-[14px] text-cream shadow-lg lg:bottom-8"
  if (notice) {
    return (
      <p role="status" data-testid="menu-notice" className={pill}>
        {notice}
      </p>
    )
  }
  return (
    <p
      role="alert"
      data-testid="menu-change-failed"
      className={pill}
    >
      {undone === 1
        ? "No se ha podido guardar el cambio. Lo he dejado como estaba: prueba otra vez."
        : `No se ha podido guardar; he deshecho ${undone} cambios. Prueba otra vez.`}
    </p>
  )
}
