"use client"

/**
 * "D · Luz y foto" shell for the access screens (PRO-36): /login, /register,
 * /reset and /invites/[token].
 *
 * Mobile: full-bleed photo on top, a paper card (border-border-soft, radius 24)
 * overlapping it with the form, and the "the other way in" line underneath.
 * `lg+`: 50/50 — sticky rounded photo on the left with a paper caption, the
 * card on the right, all inside a 1180 px container.
 */

import { useId, type ReactNode } from "react"
import Link from "next/link"
import { motion, useReducedMotion } from "motion/react"
import { ArrowLeft } from "lucide-react"
import { MimoiaLogo } from "@/components/brand/Mimoia"

export const AUTH_TITLE = "font-serif-text font-[650] text-[30px] leading-[1.1] tracking-[-0.01em] text-ink lg:text-[38px] lg:leading-[1.05]"

/** Ink pill for the main action (submit or link). */
export const AUTH_PILL =
  "group flex min-h-[52px] w-full items-center justify-center gap-2 rounded-full bg-ink px-6 text-[15px] font-semibold text-cream transition-[gap,opacity] hover:gap-3 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"

export function AuthShell({
  image,
  caption,
  backHref,
  footer,
  children,
}: {
  image: string
  /** Paper caption on the desktop photo (`lg+` only). */
  caption?: { eyebrow: string; title: ReactNode; body?: string }
  /** Back link on the photo ("Volver"). Omit to hide it. */
  backHref?: string
  /** The line under the card ("¿Aún no tienes cuenta? …"). */
  footer?: ReactNode
  children: ReactNode
}) {
  const reduce = useReducedMotion()

  return (
    <div className="min-h-[100dvh] bg-cream pb-10 lg:pb-0">
      <div className="lg:mx-auto lg:grid lg:min-h-[100dvh] lg:max-w-[1180px] lg:grid-cols-2 lg:gap-12 lg:px-8 lg:py-6">
        {/* Photo — full bleed on mobile, sticky rounded half at lg+ */}
        <div className="relative h-[280px] overflow-hidden md:h-[340px] lg:sticky lg:top-6 lg:h-[calc(100dvh-48px)] lg:rounded-[24px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-b from-ink/25 via-transparent to-transparent lg:to-ink/30" />

          {backHref && (
            <Link
              href={backHref}
              className="absolute left-4 top-[calc(var(--safe-top)+12px)] inline-flex min-h-[44px] items-center gap-1.5 rounded-full bg-paper px-4 text-[13px] font-medium text-ink shadow-sm transition-colors hover:text-terracotta-deep lg:left-6 lg:top-6"
            >
              <ArrowLeft size={15} strokeWidth={2} aria-hidden />
              Volver<span className="hidden lg:inline">&nbsp;a inicio</span>
            </Link>
          )}

          {caption && (
            <div className="absolute bottom-6 left-6 right-6 hidden max-w-[440px] flex-col gap-2 rounded-[20px] bg-paper px-6 py-5 lg:flex">
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">{caption.eyebrow}</span>
              <span className="font-serif-text text-[26px] font-[650] leading-[1.1] text-ink">{caption.title}</span>
              {caption.body && <span className="text-[14px] leading-relaxed text-ink-mid">{caption.body}</span>}
            </div>
          )}
        </div>

        {/* Card column */}
        <div className="lg:flex lg:flex-col lg:items-center lg:justify-center lg:py-10">
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0.2 : 0.6, ease: [0.19, 1, 0.22, 1] }}
            className="relative z-10 mx-4 -mt-[56px] rounded-[24px] border border-border-soft bg-paper px-5 pb-7 pt-6 md:mx-auto md:max-w-[440px] lg:mx-0 lg:mt-0 lg:w-full lg:px-9 lg:py-10"
          >
            <MimoiaLogo size={22} className="mb-6" />
            {children}
          </motion.div>

          {footer && (
            <div className="mx-4 mt-5 flex flex-wrap items-center justify-center gap-x-2 text-[13px] text-ink-muted md:mx-auto md:max-w-[440px] lg:w-full">
              {footer}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** 11 px uppercase eyebrow + Fraunces 650 title + optional lead. */
export function AuthHeading({ eyebrow, title, lead }: { eyebrow: string; title: ReactNode; lead?: ReactNode }) {
  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">{eyebrow}</p>
      <h1 className={`mt-2 ${AUTH_TITLE}`}>{title}</h1>
      {lead && <p className="mt-3 text-[14px] leading-relaxed text-ink-mid">{lead}</p>}
    </div>
  )
}

/** Accent word inside a title (terracotta-deep italic, like /menu). */
export function Accent({ children }: { children: ReactNode }) {
  return <span className="font-medium italic text-terracotta-deep">{children}</span>
}

/** Link to the other way in, under the card (44 px tap target). */
export function AuthFooterLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-[44px] items-center font-semibold text-ink underline underline-offset-4 hover:text-terracotta-deep">
      {children}
    </Link>
  )
}

/** Labelled input: paper, #E8E2D3 border, radius 14, 48 px tall. */
export function AuthField({
  label,
  value,
  onChange,
  type = "text",
  autoFocus,
  autoComplete,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  autoFocus?: boolean
  autoComplete?: string
}) {
  const id = useId()

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-medium text-ink-mid">
        {label}
      </label>
      <input
        id={id}
        type={type}
        required
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        className="h-12 w-full rounded-[14px] border border-border-soft bg-paper px-4 text-[16px] text-ink outline-none transition-colors focus:border-ink"
      />
    </div>
  )
}

/** Error notice inside a form. */
export function AuthError({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="rounded-[14px] border border-terracotta/30 bg-[#FDEEE8] px-4 py-3 text-[13px] text-terracotta-deep">
      {children}
    </div>
  )
}
