"use client"

/**
 * «Primeros pasos» (PRO-07): the first time a new account lands on /menu,
 * three steps over the real screen — the «···» button of the day's dish
 * (tapping the dish opens the recipe; changing it goes through «···»), the
 * shopping tab and Mimo's button — each lit up with the rest dimmed. Skippable at any step;
 * finishing or skipping calls POST /user/:id/first-steps, so it never comes
 * back on any device. Only accounts created after the feature see it
 * (`users.first_steps_pending`, set by POST /register; see specs/auth.md).
 */
import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"

/** Each step lights up the first selector that is on screen (fallbacks after the first). */
export const FIRST_STEPS = [
  {
    // PRO-68: the «···» of the day's dish; with the day still empty, the
    // first «···» on screen (an empty slot's); read-only, the whole dish.
    targets: ['[data-first-steps="dish"] [data-meal-options]', "[data-meal-options]", '[data-first-steps="dish"]'],
    text: "Toca «···» en un plato para cambiarlo",
  },
  { targets: ['[data-first-steps="shopping"]'], text: "Aquí tienes la lista de la compra: se hace sola" },
  { targets: ['[data-testid="mimo-button"]'], text: "Este es Mimo: pídele lo que quieras" },
] as const

type Rect = { top: number; left: number; width: number; height: number }

/** First matching element that is actually on screen (mobile tab bar vs desktop sidebar). */
function findTarget(selectors: readonly string[]): HTMLElement | null {
  for (const selector of selectors) {
    for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) return el
    }
  }
  return null
}

export function FirstStepsGuide({ userId, ready }: { userId: string; ready: boolean }) {
  const queryClient = useQueryClient()
  // Its own key and always fresh: a cached profile from before the guide was
  // dismissed (on another page or device) must not bring it back.
  const { data: pending } = useQuery({
    queryKey: ["first-steps", userId],
    queryFn: async () => Boolean((await api.get<{ firstStepsPending?: boolean }>(`/user/${userId}`)).firstStepsPending),
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  })
  const [step, setStep] = useState(0)
  const [closed, setClosed] = useState(false)
  const [rect, setRect] = useState<Rect | null>(null)
  const open = ready && pending === true && !closed

  // `outcome` only feeds the product analytics (first_steps_completed / _skipped).
  const finish = useCallback((outcome: "completed" | "skipped") => {
    setClosed(true)
    queryClient.setQueryData(["first-steps", userId], false)
    api.post(`/user/${userId}/first-steps`, { outcome }).catch(() => {
      // Not saved: it may show once more next time. Never blocks the menu.
    })
  }, [queryClient, userId])

  // Follow the highlighted element (scroll, resize, late layout).
  useLayoutEffect(() => {
    if (!open) return
    const selector = FIRST_STEPS[step].targets
    const el = findTarget(selector)
    if (el && step === 0) el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior })
    const measure = () => {
      const t = findTarget(selector)
      if (!t) return setRect(null)
      const r = t.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }
    measure()
    const id = window.setInterval(measure, 400)
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      window.clearInterval(id)
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [open, step])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish("skipped")
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, finish])

  if (!open) return null

  const last = step === FIRST_STEPS.length - 1
  const pad = 6
  const vh = typeof window !== "undefined" ? window.innerHeight : 800
  // Card on the other half of the screen from the lit element.
  const cardBelow = rect ? rect.top + rect.height / 2 < vh / 2 : false
  const cardStyle: CSSProperties = rect
    ? cardBelow
      ? { top: Math.min(rect.top + rect.height + pad + 12, vh - 200) }
      : { bottom: Math.max(vh - rect.top + pad + 12, 16) }
    : { top: "50%", transform: "translateY(-50%)" }

  return (
    <div className="fixed inset-0 z-[120]" data-testid="first-steps">
      {rect ? (
        <div
          aria-hidden="true"
          data-testid="first-steps-spotlight"
          className="pointer-events-none fixed rounded-[20px] ring-2 ring-cream transition-all duration-200"
          style={{
            top: rect.top - pad,
            left: rect.left - pad,
            width: rect.width + pad * 2,
            height: rect.height + pad * 2,
            boxShadow: "0 0 0 9999px rgba(26, 22, 18, 0.62)",
          }}
        />
      ) : (
        <div aria-hidden="true" className="fixed inset-0 bg-[rgba(26,22,18,0.62)]" />
      )}

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="first-steps-title"
        className="fixed inset-x-4 mx-auto max-w-[360px] rounded-[22px] border border-border bg-paper px-5 pt-4 pb-4 shadow-[0_18px_40px_rgba(26,22,18,0.25)]"
        style={cardStyle}
      >
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
          Primeros pasos · {step + 1} de {FIRST_STEPS.length}
        </p>
        <h2 id="first-steps-title" className="mt-1.5 font-serif-text text-[22px] font-[650] leading-[1.2] text-ink">
          {FIRST_STEPS[step].text}
        </h2>
        <div className="mt-4 flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => finish("skipped")}
            className="inline-flex min-h-[44px] items-center rounded-full px-2 text-[14px] font-medium text-ink-mid underline underline-offset-4 hover:text-ink"
          >
            Saltar
          </button>
          <button
            type="button"
            autoFocus
            onClick={() => (last ? finish("completed") : setStep(step + 1))}
            className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-cream transition-colors hover:bg-forest"
          >
            {last ? "Entendido" : "Siguiente"}
          </button>
        </div>
      </div>
    </div>
  )
}
