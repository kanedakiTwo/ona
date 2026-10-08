"use client"

/**
 * Bottom sheet (mobile) / centred dialog (lg+) used by /menu for the week
 * options and the per-meal options.
 *
 * Portalled to document.body: the app shell wraps pages in transformed
 * motion containers (PageTransition, SwipeNavigator) and a `position: fixed`
 * child of a transformed ancestor is positioned against that ancestor, not
 * the viewport. Escape closes it, focus moves into the panel on open and
 * back to the trigger on close. Under prefers-reduced-motion it only fades.
 */
import { useEffect, useId, useRef, type ReactNode } from "react"
import Link from "next/link"
import { createPortal } from "react-dom"
import { AnimatePresence, motion, useReducedMotion } from "motion/react"
import { X } from "lucide-react"

interface Props {
  open: boolean
  onClose: () => void
  /** Small uppercase kicker above the title. */
  eyebrow?: string
  title: ReactNode
  children: ReactNode
}

export function MenuSheet({ open, onClose, eyebrow, title, children }: Props) {
  const reduce = useReducedMotion()
  const panelRef = useRef<HTMLDivElement>(null)
  const returnFocusRef = useRef<HTMLElement | null>(null)
  const titleId = useId()

  // Latest onClose without re-running the open/close effect on every parent
  // render (that would bounce focus out of an input inside the sheet).
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    returnFocusRef.current = document.activeElement as HTMLElement | null
    const t = setTimeout(() => panelRef.current?.focus({ preventScroll: true }), 30)
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current()
    }
    window.addEventListener("keydown", onKey)
    return () => {
      clearTimeout(t)
      window.removeEventListener("keydown", onKey)
      returnFocusRef.current?.focus?.({ preventScroll: true })
    }
  }, [open])

  if (typeof document === "undefined") return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[70] flex items-end justify-center lg:items-center">
          <motion.div
            aria-hidden="true"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
            className="absolute inset-0 bg-ink/40"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={reduce ? { opacity: 0 } : { y: 32, opacity: 0 }}
            animate={reduce ? { opacity: 1 } : { y: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { y: 32, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.19, 1, 0.22, 1] }}
            className="relative max-h-[88vh] w-full max-w-[480px] overflow-y-auto rounded-t-[28px] bg-cream px-5 pt-5 pb-[max(var(--safe-bottom),20px)] shadow-[0_-12px_40px_-12px_rgba(26,22,18,0.3)] outline-none lg:rounded-[28px] lg:pb-6"
          >
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-border lg:hidden" aria-hidden="true" />
            <div className="mb-3 flex items-start justify-between gap-3">
              <div className="min-w-0">
                {eyebrow && (
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{eyebrow}</p>
                )}
                <h2 id={titleId} className="mt-0.5 font-serif-text font-[650] text-[1.4rem] leading-tight text-ink">
                  {title}
                </h2>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar"
                className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-soft transition-colors hover:bg-cream-deep hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
              >
                <X size={20} />
              </button>
            </div>
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** One tappable row inside a MenuSheet (≥ 48 px, icon + label + optional hint). */
export function SheetAction({
  icon: Icon,
  label,
  hint,
  onClick,
  href,
  disabled,
  destructive,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>
  label: string
  hint?: string
  onClick?: () => void
  href?: string
  disabled?: boolean
  destructive?: boolean
}) {
  const cls = `flex min-h-[52px] w-full items-center gap-3.5 rounded-2xl px-3 text-left transition-colors focus-visible:outline-2 focus-visible:outline-ink ${
    disabled
      ? "cursor-not-allowed opacity-40"
      : destructive
        ? "text-terracotta-deep hover:bg-warn-bg"
        : "text-ink hover:bg-cream-deep"
  }`
  // The label is the accessible name; the hint is its description (so
  // "Compartir" is named "Compartir", not "Compartir Tu menú como texto…").
  const labelId = useId()
  const hintId = useId()
  const a11y = { "aria-labelledby": labelId, "aria-describedby": hint ? hintId : undefined }
  const body = (
    <>
      <Icon size={20} strokeWidth={1.7} className="shrink-0" />
      <span className="min-w-0 flex-1">
        <span id={labelId} className="block text-[15px] font-medium leading-tight">
          {label}
        </span>
        {hint && (
          <span id={hintId} className="mt-0.5 block text-[12.5px] leading-snug text-ink-soft">
            {hint}
          </span>
        )}
      </span>
    </>
  )
  if (href && !disabled) {
    return (
      <Link href={href} className={cls} {...a11y}>
        {body}
      </Link>
    )
  }
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={cls} {...a11y}>
      {body}
    </button>
  )
}
