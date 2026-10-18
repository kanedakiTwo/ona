"use client"

/**
 * Public calls to action that follow the registration mode (PRO-167,
 * specs/waitlist.md «Open registration»). Client pieces so server-rendered
 * pages (blog, recipe CTAs) can use them too.
 */
import Link from "next/link"
import { useRegistrationMode, useSignupCta } from "@/hooks/useRegistrationMode"

interface SignupCtaLinkProps {
  /** Where it goes before open registration (the waitlist). */
  waitlistHref: string
  /** Its label before open registration. */
  waitlistLabel: string
  /** `?ref=` for `/register` when the page has none (the placement). */
  openRef: string | null
  className?: string
  testId?: string
  onClick?: (e: React.MouseEvent<HTMLAnchorElement>, open: boolean) => void
  /** An icon after the label. */
  icon?: React.ReactNode
}

export function SignupCtaLink({ waitlistHref, waitlistLabel, openRef, className, testId, onClick, icon }: SignupCtaLinkProps) {
  const cta = useSignupCta(waitlistHref, waitlistLabel, openRef)
  return (
    <Link
      href={cta.href}
      className={className}
      data-testid={testId}
      data-registration={cta.open ? "open" : "invite"}
      onClick={onClick ? (e) => onClick(e, cta.open) : undefined}
    >
      {cta.label}
      {icon}
    </Link>
  )
}

/** Shows its children only while registration is by invitation (waitlist-only copy such as «Entramos por tandas»). */
export function WaitlistOnly({ children }: { children: React.ReactNode }) {
  return useRegistrationMode() === "open" ? null : <>{children}</>
}

/** Shows its children only with open registration. */
export function OpenRegistrationOnly({ children }: { children: React.ReactNode }) {
  return useRegistrationMode() === "open" ? <>{children}</> : null
}
