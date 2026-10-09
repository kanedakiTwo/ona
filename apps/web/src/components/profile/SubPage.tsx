"use client"

/**
 * Shared skin for the /profile sub-pages ("D · Luz y foto", PRO-40):
 * /profile/casa, /memoria, /creencias, /pantry, /staples, /cookbooks.
 *
 * - `SubPage` — cream page, 1180 px max at lg+, compact header with a
 *   "← Perfil" link, 11 px eyebrow and a Fraunces 650 h1 (same cut as /menu).
 * - `MoreButton` — the 44 px "···" trigger that opens a `MenuSheet`.
 * - Class strings for paper cards, inputs (#E8E2D3 border) and ink pills.
 */
import type { ReactNode } from "react"
import Link from "next/link"
import { ArrowLeft, MoreHorizontal } from "lucide-react"

/** Paper card / list container: #E8E2D3 border, radius 20. */
export const SUB_CARD = "rounded-[20px] border border-border-soft bg-paper"
/** Paper list whose rows are separated by hairlines. */
export const SUB_LIST = `${SUB_CARD} divide-y divide-border-soft`
/** Text input / select / textarea: paper, #E8E2D3 border, 44 px tall. */
export const SUB_INPUT =
  "min-h-[44px] w-full rounded-xl border border-border-soft bg-paper px-3.5 text-[15px] text-ink placeholder:text-ink-light focus:border-ink focus:outline-none disabled:opacity-50"
/** Small uppercase kicker for sections and form labels. */
export const SUB_EYEBROW = "text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted"
/** Primary action: ink pill, 44 px. */
export const PILL_INK =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full bg-ink px-5 text-[14px] font-medium text-cream transition-colors hover:bg-ink-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-40"
/** Secondary action: outlined paper pill, 44 px. */
export const PILL_OUTLINE =
  "inline-flex min-h-[44px] items-center justify-center gap-2 rounded-full border border-border bg-paper px-5 text-[14px] font-medium text-ink transition-colors hover:bg-cream-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-40"

export function SubPage({
  eyebrow,
  title,
  intro,
  action,
  children,
}: {
  eyebrow: string
  /** h1 content; wrap the accent word in `<Accent>`. */
  title: ReactNode
  intro?: ReactNode
  /** Right-hand header slot (e.g. a "···" button or a primary pill). */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto w-full max-w-[1180px] px-4 pb-12 pt-3 md:px-8 lg:px-12 lg:pt-6">
        <Link
          href="/profile"
          className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2 text-[14px] font-medium text-ink-mid transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
        >
          <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />
          Perfil
        </Link>
        <header className="mt-2 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted lg:text-[12px]">
              {eyebrow}
            </p>
            <h1 className="mt-1 font-serif-text text-[30px] font-[650] leading-[1.1] text-ink lg:text-[40px] lg:leading-[1.05]">
              {title}
            </h1>
            {intro && <p className="mt-2 max-w-[560px] text-[14px] leading-relaxed text-ink-soft">{intro}</p>}
          </div>
          {action && <div className="shrink-0 pt-1">{action}</div>}
        </header>
        <div className="mt-6 lg:mt-8">{children}</div>
      </div>
    </div>
  )
}

/** Terracotta-deep italic accent inside a sub-page h1 (as in /menu). */
export function Accent({ children }: { children: ReactNode }) {
  return <span className="font-medium italic text-terracotta-deep">{children}</span>
}

/** 44 px "···" trigger for a row or header sheet. */
export function MoreButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="dialog"
      onClick={onClick}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-mid transition-colors hover:bg-cream-deep hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <MoreHorizontal size={20} strokeWidth={2} />
    </button>
  )
}

/** Centered "loading" / empty notice in the sub-page style. */
export function SubNotice({ children, dashed = false }: { children: ReactNode; dashed?: boolean }) {
  return (
    <div
      className={`rounded-[20px] px-6 py-10 text-center ${dashed ? "border border-dashed border-border bg-paper" : ""}`}
    >
      {children}
    </div>
  )
}
