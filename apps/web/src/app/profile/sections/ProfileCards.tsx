"use client"

/**
 * Building blocks of the /profile front page in "D · Luz y foto" (PRO-39):
 * paper cards with border-soft, an icon on a bone circle, a Fraunces 650
 * title and one status line. `ProfileHubLink` is a whole-card link to a
 * sub-page; `ProfileCard` holds inline controls (voice, WhatsApp, forms).
 */
import Link from "next/link"
import type { ReactNode } from "react"
import { ChevronRight, MoreHorizontal } from "lucide-react"

type Icon = React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>

export const CARD = "rounded-[20px] border border-border-soft bg-paper"

function IconDot({ icon: Icon }: { icon: Icon }) {
  return (
    <span
      aria-hidden="true"
      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-cream-deep text-ink"
    >
      <Icon size={19} strokeWidth={1.7} />
    </span>
  )
}

/** Whole-card link to a profile sub-page (Casa, Memoria, Despensa…). */
export function ProfileHubLink({
  href,
  icon,
  title,
  status,
}: {
  href: string
  icon: Icon
  title: string
  status: ReactNode
}) {
  return (
    <Link
      href={href}
      className={`${CARD} group flex min-h-[44px] flex-col gap-3 p-4 transition-colors hover:border-border hover:bg-cream-deep/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink lg:flex-row lg:items-center lg:gap-3.5 lg:p-5`}
    >
      <div className="flex items-start justify-between gap-2 lg:contents">
        <IconDot icon={icon} />
        <ChevronRight
          size={18}
          strokeWidth={1.8}
          aria-hidden="true"
          className="mt-2.5 text-ink-light transition-transform group-hover:translate-x-0.5 lg:order-last lg:mt-0"
        />
      </div>
      <div className="min-w-0 lg:flex-1">
        <span className="block font-serif-text text-[17px] font-[650] leading-tight text-ink">{title}</span>
        <span className="mt-0.5 block text-[13px] leading-snug text-ink-muted">{status}</span>
      </div>
    </Link>
  )
}

/** A paper card with inline controls. `onMore` adds a "···" button (opens a MenuSheet). */
export function ProfileCard({
  icon,
  title,
  status,
  onMore,
  moreLabel,
  children,
  className = "",
  ...rest
}: {
  icon: Icon
  title: ReactNode
  status?: ReactNode
  onMore?: () => void
  moreLabel?: string
  children?: ReactNode
  className?: string
  "data-testid"?: string
}) {
  return (
    <section className={`${CARD} p-4 lg:p-5 ${className}`} data-testid={rest["data-testid"]}>
      <div className="flex items-center gap-3">
        <IconDot icon={icon} />
        <div className="min-w-0 flex-1">
          <h3 className="font-serif-text text-[18px] font-[650] leading-tight text-ink">{title}</h3>
          {status != null && <p className="mt-0.5 text-[13px] leading-snug text-ink-muted">{status}</p>}
        </div>
        {onMore && <MoreButton onClick={onMore} label={moreLabel ?? "Más opciones"} />}
      </div>
      {children}
    </section>
  )
}

export function MoreButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-haspopup="dialog"
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-paper text-ink transition-colors hover:bg-cream-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
    >
      <MoreHorizontal size={20} strokeWidth={2} />
    </button>
  )
}

/** iOS-style switch drawn inside a toggle button (the button carries aria-pressed). */
export function Switch({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative block h-6 w-11 shrink-0 rounded-full transition-colors ${on ? "bg-ink" : "bg-border"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-paper shadow transition-[left] duration-200 ${
          on ? "left-[22px]" : "left-0.5"
        }`}
      />
    </span>
  )
}

/** Small uppercase section kicker between groups of cards. */
export function GroupLabel({ children }: { children: ReactNode }) {
  return (
    <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted lg:text-[12px]">{children}</h2>
  )
}
