"use client"

import { useEffect, useState } from "react"

/**
 * PRO-122: Mimo's button (right) and «Opinión» (left) float over every page;
 * at 390 px they covered the controls of an open sheet and the field being
 * typed in (hogares de prueba, 2026-10-18/19). They hide while:
 * - a sheet or dialog is open (`[role="dialog"]` in the page), any width;
 * - on a phone (< 768 px), a text field has the focus (the keyboard is up).
 * The rest of the time the page reserves room for them (RootShell's bottom
 * padding and `scroll-padding-bottom` in globals.css).
 */
export const FLOATING_BUTTONS_MOBILE_MAX = 767

const TEXT_INPUT_TYPES = new Set(["text", "search", "email", "password", "number", "tel", "url", "date", "time", ""])

/** Pure: does focusing this element bring up the on-screen keyboard? */
export function opensKeyboard(el: Element | null): boolean {
  if (!el) return false
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true
  if (el instanceof HTMLInputElement) return TEXT_INPUT_TYPES.has((el.getAttribute("type") ?? "").toLowerCase())
  return (el as HTMLElement).isContentEditable === true
}

function computeHidden(): boolean {
  if (typeof document === "undefined") return false
  if (document.querySelector('[role="dialog"]')) return true
  return window.innerWidth <= FLOATING_BUTTONS_MOBILE_MAX && opensKeyboard(document.activeElement)
}

export function useFloatingButtonsHidden(): boolean {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => setHidden(computeHidden()))
    }
    update()
    const observer = new MutationObserver(update)
    observer.observe(document.body, { childList: true, subtree: true })
    document.addEventListener("focusin", update)
    document.addEventListener("focusout", update)
    window.addEventListener("resize", update)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      document.removeEventListener("focusin", update)
      document.removeEventListener("focusout", update)
      window.removeEventListener("resize", update)
    }
  }, [])
  return hidden
}
