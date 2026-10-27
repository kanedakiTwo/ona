"use client"

import Link from "next/link"
import { HEALTH_CONSENT_TEXT } from "@ona/shared"

/**
 * The separate, unticked box for health data (RGPD art. 9, PRO-21). Distinct
 * from accepting the terms; used in onboarding (restrictions step) and in
 * the profile.
 */
export function HealthConsentCheckbox({
  checked,
  onChange,
  disabled,
  ariaLabel = "Consiento que Mimoia trate mis datos de salud",
}: {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** A second box on the same screen (the current text for a v1 consent) needs its own name. */
  ariaLabel?: string
}) {
  const [before] = HEALTH_CONSENT_TEXT.split("Más información en la política de privacidad.")
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-3 text-[13px] leading-snug text-[#1A1612]">
      <input
        type="checkbox"
        name="healthConsent"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        aria-label={ariaLabel}
        className="mt-0.5 h-5 w-5 shrink-0 accent-[#1A1612]"
      />
      <span>
        {before.trim()} Más información en la{" "}
        <Link href="/privacidad" className="underline">
          política de privacidad
        </Link>
        .
      </span>
    </label>
  )
}
