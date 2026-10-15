import { Sparkles } from "lucide-react"
import { FOUNDING_HOUSEHOLD_LABEL } from "@ona/shared"

/**
 * «Hogar fundador»: households from the beta (created before launch day),
 * promised on the waitlist. Shown on the profile header and on Casa.
 */
export function FoundingBadge({ className = "" }: { className?: string }) {
  return (
    <span
      data-testid="founding-badge"
      title="Tu casa estuvo en la beta de Mimoia. Gracias por ayudarnos a hacerla."
      className={`inline-flex items-center gap-1.5 self-start rounded-full bg-terracotta/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-terracotta-deep ${className}`}
    >
      <Sparkles size={12} strokeWidth={2} aria-hidden="true" />
      {FOUNDING_HOUSEHOLD_LABEL}
    </span>
  )
}
