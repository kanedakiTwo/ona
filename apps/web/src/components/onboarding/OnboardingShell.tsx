import type { ReactNode } from "react"

/**
 * Layout of the onboarding pages ("D · Luz y foto", PRO-37).
 *
 * Mobile: one column at the viewport width (16 px gutters). At `lg+`: a
 * centred 560 px column with a dish photo beside it (sticky, radius 24),
 * the whole composition capped at 1180 px. The photo is decorative.
 */
export function OnboardingShell({
  photo,
  children,
  className = "",
}: {
  /** A committed seed photo under /images/recipes/. */
  photo: string
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={`mx-auto w-full max-w-[560px] lg:grid lg:max-w-[1180px] lg:grid-cols-[minmax(0,560px)_minmax(0,1fr)] lg:gap-14 lg:px-10 ${className}`}
    >
      <div className="flex min-w-0 flex-col">{children}</div>
      <aside aria-hidden="true" className="hidden lg:block">
        <div className="sticky top-8 h-[calc(100dvh-4rem)] max-h-[820px] min-h-[480px] overflow-hidden rounded-[24px] bg-bone">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photo} alt="" className="h-full w-full object-cover" />
        </div>
      </aside>
    </div>
  )
}

/** Compact header: 11 px uppercase eyebrow + Fraunces 650 h1 (the accent goes in `<Accent>`). */
export function OnboardingHeader({ eyebrow, children }: { eyebrow: ReactNode; children: ReactNode }) {
  return (
    <header>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted lg:text-[12px]">{eyebrow}</p>
      <h1 className="mt-1.5 font-serif-text text-[30px] font-[650] leading-[1.1] text-ink lg:text-[40px] lg:leading-[1.05]">
        {children}
      </h1>
    </header>
  )
}

/** The terracotta-deep italic word inside an onboarding h1. */
export function Accent({ children }: { children: ReactNode }) {
  return <span className="font-medium italic text-terracotta-deep">{children}</span>
}
