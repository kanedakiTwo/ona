"use client"

/**
 * «Opinión» (beta feedback box, specs/feedback.md, Miguel 2026-10-15): a small
 * floating pill on every signed-in page, bottom-left (Mimo's button is
 * bottom-right). It opens a sheet with a text box; what's sent lands in the
 * same box as what people tell Mimo («quiero dejar una sugerencia»), read in
 * Admin → Opiniones and summarised in the morning brief. Hidden in cook mode
 * and during onboarding.
 */
import { useEffect, useState } from "react"
import { usePathname } from "next/navigation"
import { MessageSquareHeart, X } from "lucide-react"
import { useMutation } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { isCookPath, isRecipeDetailPath } from "@/components/mimo/MimoButton"
import { useFloatingButtonsHidden } from "@/hooks/useFloatingButtonsHidden"

export function feedbackButtonHidden(pathname: string | null): boolean {
  return !pathname || isCookPath(pathname) || pathname.startsWith("/onboarding") || pathname.startsWith("/afinar")
}

/** Mirror of Mimo's button, on the left, clear of each page's fixed bars. */
export function feedbackButtonPosition(pathname: string | null): string {
  if (isRecipeDetailPath(pathname)) return "bottom-[calc(104px+var(--safe-bottom))] left-4 lg:bottom-6 lg:left-[calc(var(--sidebar-width)+24px)]"
  return "bottom-[calc(84px+var(--safe-bottom))] left-4 md:bottom-6 md:left-[calc(var(--sidebar-width)+24px)]"
}

export function FeedbackButton() {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState("")
  const [thanks, setThanks] = useState(false)
  // PRO-122: out of the way while a sheet is open or the keyboard is up.
  const floatingHidden = useFloatingButtonsHidden()
  const send = useMutation({
    mutationFn: () => api.post("/feedback", { text: text.trim(), page: pathname, channel: "app" }),
    onSuccess: () => {
      setThanks(true)
      setText("")
    },
  })

  useEffect(() => {
    if (!thanks) return
    const t = setTimeout(() => {
      setOpen(false)
      setThanks(false)
    }, 2200)
    return () => clearTimeout(t)
  }, [thanks])

  if (feedbackButtonHidden(pathname)) return null

  return (
    <>
      {!floatingHidden && (
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-testid="feedback-button"
        aria-label="Danos tu opinión"
        className={`fixed z-40 ${feedbackButtonPosition(pathname)} inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-paper/95 px-3.5 text-[13px] font-medium text-ink shadow-[0_6px_18px_-8px_rgba(26,22,18,0.35)] backdrop-blur transition-transform active:scale-95`}
      >
        <MessageSquareHeart size={16} strokeWidth={1.9} aria-hidden="true" className="text-terracotta" />
        Opinión
      </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/30 md:items-center" onClick={() => setOpen(false)}>
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="feedback-title"
            data-testid="feedback-sheet"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[430px] rounded-t-3xl bg-cream p-6 pb-[calc(1.5rem+var(--safe-bottom,0px))] shadow-2xl md:rounded-3xl"
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="feedback-title" className="font-display text-[24px] leading-tight text-ink">
                {thanks ? "¡Gracias!" : "Danos tu opinión"}
              </h2>
              <button type="button" onClick={() => setOpen(false)} aria-label="Cerrar" className="-mr-2 -mt-1 rounded-full p-2 text-ink-muted hover:text-ink">
                <X size={18} />
              </button>
            </div>
            {thanks ? (
              <p role="status" className="mt-3 text-[15px] leading-relaxed text-ink-mid">
                Lo leemos todo. Nos ayuda muchísimo a hacer Mimoia.
              </p>
            ) : (
              <>
                <p className="mt-2 text-[14px] leading-relaxed text-ink-mid">
                  Lo que te sobra, lo que te falta, algo que no funciona o no entiendes… Cuéntanoslo con tus palabras. También
                  puedes decírselo a Mimo, aquí o por WhatsApp.
                </p>
                <textarea
                  autoFocus
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  maxLength={2000}
                  rows={5}
                  placeholder="Me gustaría que…"
                  aria-label="Tu opinión"
                  className="mt-4 w-full resize-none rounded-2xl border border-border bg-paper px-4 py-3 text-[15px] text-ink placeholder:text-ink-muted"
                />
                {send.isError && (
                  <p role="alert" className="mt-2 text-[13px] text-terracotta-deep">
                    No hemos podido enviarlo. Inténtalo de nuevo.
                  </p>
                )}
                <button
                  type="button"
                  disabled={text.trim().length < 2 || send.isPending}
                  onClick={() => send.mutate()}
                  className="mt-4 inline-flex min-h-[48px] w-full items-center justify-center rounded-full bg-ink px-6 text-[15px] font-medium text-cream disabled:opacity-40"
                >
                  {send.isPending ? "Enviando…" : "Enviar"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
