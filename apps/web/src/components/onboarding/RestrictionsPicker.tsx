"use client"

/**
 * Allergies and things the household doesn't eat: the separate, unticked
 * health-data box (RGPD art. 9, PRO-21) and, only with it ticked, the preset
 * chips and a free field. Used by the web sign-up's step 4 and by «Tu menú
 * está listo» after the WhatsApp sign-up (PRO-161).
 */
import { useState, type KeyboardEvent } from "react"
import { X } from "lucide-react"
import { RESTRICTION_PRESETS } from "@ona/shared"
import { cn } from "@/lib/utils"
import { HealthConsentCheckbox } from "@/components/HealthConsentCheckbox"
import { withTyped } from "@/lib/restrictionText"

const FIELD =
  "h-12 w-full rounded-2xl border border-border bg-paper px-4 text-[15px] text-ink placeholder:text-ink-light transition-colors focus:border-ink focus:outline-none disabled:opacity-60"

export function RestrictionsPicker({
  consent,
  onConsentChange,
  restrictions,
  onChange,
  onTypingChange,
  typed,
}: {
  consent: boolean
  onConsentChange: (consent: boolean) => void
  restrictions: string[]
  onChange: (restrictions: string[]) => void
  /**
   * What is typed and not added yet: the screen counts and saves it
   * (`withTyped`), so «Guardar» without Enter keeps «pimiento» (2026-10-22).
   * Not added on blur: the new chip moved the button under the finger.
   */
  onTypingChange?: (text: string) => void
  /** The box's text when the screen holds it (it empties it after reading it, PRO-347). */
  typed?: string
}) {
  const [ownInput, setTagInputState] = useState("")
  const tagInput = typed ?? ownInput
  function setTagInput(text: string) {
    setTagInputState(text)
    onTypingChange?.(text)
  }

  function addRestriction(tag: string) {
    const next = withTyped(restrictions, tag)
    if (next.length > restrictions.length) onChange(next)
    setTagInput("")
  }

  function removeRestriction(tag: string) {
    onChange(restrictions.filter((r) => r !== tag))
  }

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      addRestriction(tagInput)
    }
  }

  return (
    <>
      <div className="mt-5">
        <HealthConsentCheckbox
          checked={consent}
          onChange={(v) => {
            onConsentChange(v)
            if (!v) onChange([])
          }}
        />
        {!consent && (
          <p className="mt-2 text-[13px] text-ink-muted">
            Sin tu consentimiento no guardamos alergias ni restricciones; puedes seguir sin marcarlo.
          </p>
        )}
      </div>
      <div className={cn("mt-6", !consent && "pointer-events-none opacity-40")} aria-disabled={!consent}>
        <div className="flex flex-wrap gap-2">
          {RESTRICTION_PRESETS.map((tag) => {
            const active = restrictions.includes(tag)
            return (
              <button
                key={tag}
                type="button"
                disabled={!consent}
                aria-pressed={active}
                onClick={() => (active ? removeRestriction(tag) : addRestriction(tag))}
                // 36 px visual + a pseudo-element that stretches the hit area to 44 px.
                className={cn(
                  "relative h-9 rounded-full border px-3.5 text-[14px] transition-colors before:absolute before:inset-x-0 before:-inset-y-1 active:scale-[0.97]",
                  active ? "border-ink bg-ink font-medium text-cream" : "border-border bg-paper text-ink hover:border-ink",
                )}
              >
                {tag}
              </button>
            )
          })}
        </div>
        <div className="mt-4">
          <input
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleTagKeyDown}
            disabled={!consent}
            placeholder="Otra: escríbela (p. ej. pimiento)"
            className={FIELD}
          />
        </div>
        {restrictions.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {restrictions.map((tag) => (
              <span
                key={tag}
                className="inline-flex h-9 items-center gap-1 rounded-full border border-border-soft bg-paper pl-3.5 text-[14px] text-ink"
              >
                {tag}
                <button
                  type="button"
                  onClick={() => removeRestriction(tag)}
                  aria-label={`Quitar ${tag}`}
                  className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted hover:text-ink"
                >
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
        )}
      </div>
    </>
  )
}
