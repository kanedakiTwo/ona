"use client"

/**
 * Under the chips when a diet for religious reasons is picked (halal,
 * 2026-10-25, Legal E-19): what Mimoia does with it — it leaves pork and
 * alcohol out, it doesn't certify — and, for whoever consented under v1 of the
 * health text (which didn't name it), a separate unticked box for the current
 * text. Without it ticked the diet isn't saved; their v1 stands for the rest.
 */
import { HALAL_HINT, RELIGION_CONSENT_NOTE, isReligiousDiet } from "@ona/shared"
import { HealthConsentCheckbox } from "@/components/HealthConsentCheckbox"

export function ReligionConsentNote({
  restrictions,
  needsConsent,
  checked,
  onChange,
  disabled,
}: {
  restrictions: string[]
  /** The consent in force is v1: ask for the current text. */
  needsConsent: boolean
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
}) {
  if (!restrictions.some(isReligiousDiet)) return null
  return (
    <div data-testid="religion-consent" className="mt-3 space-y-2">
      <p className="text-[13px] leading-snug text-ink-muted">{HALAL_HINT}</p>
      {needsConsent && (
        <>
          <p className="text-[13px] leading-snug text-ink">{RELIGION_CONSENT_NOTE}</p>
          <HealthConsentCheckbox
            checked={checked}
            onChange={onChange}
            disabled={disabled}
            ariaLabel="Consiento el texto nuevo, que nombra la dieta por motivos religiosos"
          />
        </>
      )}
    </div>
  )
}
