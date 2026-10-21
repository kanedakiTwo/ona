"use client"

/**
 * «Tu ficha» (PRO-318) building blocks, from the design Miguel approved on
 * 2026-10-21 (https://claude.ai/artifact/9WPRprGUFk2gJQHKvJd6yY): cream page
 * with a «← Perfil» link, an 11 px eyebrow and a Fraunces 400 title with a
 * Cormorant italic terracotta accent; paper lists (radius 18, #E8E2D3) whose
 * rows are buttons with the sentence, where it comes from and a chevron.
 *
 * At lg+ the page keeps the /profile sub-pages' container (1180 px) and reads
 * in one 720 px column, like the reading pages.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { ChevronLeft, ChevronRight, Lock } from "lucide-react"
import type { FichaFactView } from "@ona/shared"

/** 11.2 px uppercase kicker (sections, sheets). */
export const FICHA_EYEBROW = "text-[11.2px] font-medium uppercase tracking-[0.18em] text-ink-muted"
/** Paper list / card: radius 18, #E8E2D3 border. */
export const FICHA_CARD = "rounded-[18px] border border-border-soft bg-paper"
/** Terracotta-deep text action (links of the design), 44 px tall. */
export const FICHA_TEXT_ACTION =
  "inline-flex min-h-[44px] items-center self-start rounded-md text-[14px] font-medium text-terracotta-deep transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
/** Ink pill (primary). */
export const FICHA_PILL_INK =
  "inline-flex min-h-[44px] items-center justify-center rounded-full bg-ink px-[18px] text-[14px] font-medium text-cream transition-colors hover:bg-ink-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-40"
/** Outlined ink pill (secondary). */
export const FICHA_PILL_OUTLINE =
  "inline-flex min-h-[44px] items-center justify-center rounded-full border border-ink bg-transparent px-[18px] text-[14px] font-medium text-ink transition-colors hover:bg-cream-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:cursor-not-allowed disabled:opacity-40"

/** Cormorant italic accent inside the Fraunces title («Así veo *tu casa*»). */
export function FichaAccent({ children }: { children: ReactNode }) {
  return (
    <span className="text-[40px] font-medium italic text-terracotta [font-family:var(--font-italic)] lg:text-[48px]">
      {children}
    </span>
  )
}

export function FichaShell({
  back,
  eyebrow,
  title,
  children,
}: {
  back: { href: string; label: string }
  eyebrow: string
  title: ReactNode
  children: ReactNode
}) {
  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto w-full max-w-[var(--page-max)] px-4 pb-14 pt-2 md:px-8 lg:px-12 lg:pt-6">
        <div className="flex flex-col gap-7 lg:max-w-[720px]">
          <header className="flex flex-col gap-3.5">
            <Link
              href={back.href}
              className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-full px-2 text-[14px] text-ink-mid transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
            >
              <ChevronLeft size={16} strokeWidth={1.8} aria-hidden="true" />
              {back.label}
            </Link>
            <p className={FICHA_EYEBROW}>{eyebrow}</p>
            <h1 className="text-[36px] font-normal leading-[1.02] tracking-[-0.025em] text-ink [font-family:var(--font-display)] lg:text-[44px]">{title}</h1>
          </header>
          {children}
        </div>
      </div>
    </div>
  )
}

/** A titled block: eyebrow (h2) + content. */
export function FichaSection({
  title,
  aside,
  children,
  id,
  className = "",
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
  id?: string
  className?: string
}) {
  const headingId = `${id ?? slug(title)}-titulo`
  return (
    <section aria-labelledby={headingId} id={id} className={`flex flex-col gap-2.5 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <h2 id={headingId} className={FICHA_EYEBROW}>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

function slug(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
}

const BADGE = "inline-flex items-center rounded-full text-[12px] font-medium leading-[1.45] whitespace-nowrap"

/** Where a fact comes from: «Lo dijiste tú» (ink outline) · «Lo he deducido» (terracotta) · «Del alta» (bone). */
export function OriginBadge({ origin, label }: { origin: FichaFactView["origin"] | "mimo" | "otro"; label: string }) {
  const style =
    origin === "deducido" || origin === "mimo"
      ? "border border-terracotta-soft px-[9px] py-[2px] text-terracotta-deep"
      : origin === "alta"
        ? "bg-bone px-[9px] py-[3px] text-ink-mid"
        : "border border-ink px-[9px] py-[2px] text-ink"
  return <span className={`${BADGE} ${style}`}>{label}</span>
}

/** «Por ahora»: a temporary situation or a fact with an end date. */
export function TemporaryBadge() {
  return <span className={`${BADGE} bg-warn-bg px-[9px] py-[3px] text-warn-text`}>Por ahora</span>
}

/** One fact: its sentence, where it comes from and a chevron; opens «¿Por qué lo sé?». */
export function FactRow({ fact, onOpen }: { fact: FichaFactView; onOpen: (fact: FichaFactView) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(fact)}
      aria-haspopup="dialog"
      data-testid="ficha-fact"
      className="flex min-h-[60px] w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-cream/70 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink"
    >
      <span className="flex min-w-0 flex-1 flex-col items-start gap-[7px]">
        <span className="text-[15.5px] leading-[1.4] text-ink [overflow-wrap:anywhere]">{fact.sentence}</span>
        <span className="flex flex-wrap gap-1.5">
          <OriginBadge origin={fact.origin} label={fact.originLabel} />
          {fact.temporary && <TemporaryBadge />}
        </span>
      </span>
      <ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-ink-light" />
    </button>
  )
}

/** Paper list with hairlines between rows. */
export function FichaList({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <ul aria-label={label} className={`${FICHA_CARD} divide-y divide-border-soft overflow-hidden`}>
      {children}
    </ul>
  )
}

export function FactList({ facts, onOpen, label }: { facts: FichaFactView[]; onOpen: (fact: FichaFactView) => void; label?: string }) {
  return (
    <FichaList label={label}>
      {facts.map((f) => (
        <li key={f.id}>
          <FactRow fact={f} onOpen={onOpen} />
        </li>
      ))}
    </FichaList>
  )
}

/** A whole-row link inside a FichaList (e.g. «Ver tus creencias», «Datos físicos»). */
export function LinkRow({ href, title, hint, hintAccent = false }: { href: string; title: string; hint: string; hintAccent?: boolean }) {
  return (
    <Link
      href={href}
      className="flex min-h-[60px] items-center gap-3 px-4 py-3 text-ink transition-colors hover:bg-cream/70 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-ink"
    >
      <span className="flex min-w-0 flex-1 flex-col items-start gap-1">
        <span className="text-[15.5px] leading-[1.4] [overflow-wrap:anywhere]">{title}</span>
        <span className={hintAccent ? "text-[13px] font-medium text-terracotta-deep" : "text-[13.5px] text-ink-muted"}>{hint}</span>
      </span>
      <ChevronRight size={16} strokeWidth={1.8} aria-hidden="true" className="shrink-0 text-ink-light" />
    </Link>
  )
}

/** «Solo lo ves tú» with its padlock, beside the «Salud» heading. */
export function OnlyYou() {
  return (
    <span className="inline-flex items-center gap-1.5 text-[12.5px] font-medium text-ink-mid">
      <Lock size={14} strokeWidth={1.8} aria-hidden="true" />
      Solo lo ves tú
    </span>
  )
}

/** Bone note with a padlock (minors, privacy). */
export function LockNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 rounded-[10px] bg-bone px-3.5 py-3">
      <Lock size={16} strokeWidth={1.8} aria-hidden="true" className="mt-0.5 shrink-0 text-ink-mid" />
      <p className="text-[13.5px] leading-[1.5] text-ink-mid">{children}</p>
    </div>
  )
}

/** Short confirmation after an action («Olvidado.»), read out by screen readers. */
export function useFichaToast() {
  const [message, setMessage] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const show = useCallback((text: string) => {
    if (timer.current) clearTimeout(timer.current)
    setMessage(text)
    timer.current = setTimeout(() => setMessage(null), 4_000)
  }, [])
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])
  const node = (
    <div
      role="status"
      aria-live="polite"
      data-testid="ficha-toast"
      className={`pointer-events-none fixed inset-x-4 bottom-[calc(5.5rem+var(--safe-bottom,0px))] z-40 mx-auto max-w-[420px] transition-opacity duration-200 md:bottom-6 ${
        message ? "opacity-100" : "opacity-0"
      }`}
    >
      {message && <p className="rounded-2xl bg-ink px-4 py-3 text-[14px] leading-snug text-cream shadow-lg">{message}</p>}
    </div>
  )
  return { show, node }
}
