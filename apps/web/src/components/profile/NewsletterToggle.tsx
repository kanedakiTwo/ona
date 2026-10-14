"use client"

/**
 * «El menú de los viernes» switch in the profile (PRO-95, specs/newsletter.md).
 * Saves on tap (it's its own consent, not part of «Guardar»). Off also stops
 * the email for the waitlist entry with the same address.
 */

import { useEffect, useState } from "react"
import { NEWSLETTER_OPT_IN_HINT, NEWSLETTER_OPT_IN_LABEL } from "@ona/shared"
import { api } from "@/lib/api"
import { Switch } from "@/app/profile/sections/ProfileCards"

export function NewsletterToggle() {
  const [on, setOn] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)

  useEffect(() => {
    api
      .get<{ optIn: boolean }>("/newsletter/me")
      .then((r) => setOn(r.optIn))
      .catch(() => setOn(false))
  }, [])

  async function toggle() {
    if (on === null || saving) return
    const next = !on
    setSaving(true)
    setError(false)
    try {
      const r = await api.put<{ optIn: boolean }>("/newsletter/me", { optIn: next })
      setOn(r.optIn)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div data-testid="profile-newsletter">
      <button
        type="button"
        onClick={toggle}
        disabled={on === null || saving}
        className="mt-2 flex min-h-[56px] w-full items-center justify-between gap-3 border-t border-border-soft py-2 disabled:opacity-60"
        aria-pressed={!!on}
      >
        <div className="min-w-0 text-left">
          <div className="text-[14px] font-medium text-ink">{NEWSLETTER_OPT_IN_LABEL}</div>
          <div className="text-[12px] text-ink-muted">
            {on ? "Activado · te llega cada viernes" : NEWSLETTER_OPT_IN_HINT}
          </div>
        </div>
        <Switch on={!!on} />
      </button>
      {error && (
        <p role="alert" className="text-[12px] text-[#8A3B22]">
          No hemos podido guardarlo. Prueba de nuevo en un momento.
        </p>
      )}
    </div>
  )
}
