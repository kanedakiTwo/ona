"use client"

/**
 * «Tu menú está listo» (PRO-161): after the WhatsApp sign-up, before /menu.
 * Mimo built the first menu in the chat without allergies (health data never
 * goes through WhatsApp, PRO-24), so the web asks here, with the separate
 * consent box. With something added: consent + restrictions saved and this
 * week's menu rebuilt without it, then /menu. With nothing: straight to /menu.
 */
import { useState } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { firstMenuWeeks } from "@ona/shared"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { Accent, OnboardingHeader } from "./OnboardingShell"
import { RestrictionsPicker } from "./RestrictionsPicker"

const PILL =
  "flex h-[52px] w-full items-center justify-center rounded-full bg-ink px-6 text-[16px] font-semibold text-cream transition-colors hover:bg-ink-mid active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

export function OnboardingMenuReady() {
  const { user, updateUser } = useAuth()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [consent, setConsent] = useState(false)
  const [restrictions, setRestrictions] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")

  async function seeMenu() {
    if (!user) return
    if (consent && restrictions.length > 0) {
      setSaving(true)
      setError("")
      try {
        await api.post(`/user/${user.id}/health-consent`, { consent: true })
        const updated = await api.put<{ restrictions?: string[] }>(`/user/${user.id}`, { restrictions })
        updateUser({ restrictions: updated.restrictions ?? restrictions })
        // The week Mimo built in the chat, again, now without what they don't eat.
        await api.post("/menu/generate", { userId: user.id, weekStart: firstMenuWeeks().weeks[0] })
        await queryClient.invalidateQueries({ queryKey: ["menu"] })
      } catch {
        setSaving(false)
        setError("No hemos podido guardarlo. Inténtalo otra vez o añádelo luego en tu perfil.")
        return
      }
    }
    router.push("/menu")
  }

  return (
    <section data-testid="onboarding-menu-ready" className="flex flex-1 flex-col">
      <div className="flex-1">
        <OnboardingHeader eyebrow="Primeros pasos · Último paso">
          Tu menú está <Accent>listo</Accent>
        </OnboardingHeader>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">
          Antes de verlo: ¿hay algo que no comáis en casa? Alergias, intolerancias o cosas que no os gustan. Por
          WhatsApp no guardamos datos de salud; aquí sí, si nos das permiso. Si añades algo, rehacemos el menú sin ello.
        </p>
        {error && (
          <div role="alert" className="mt-4 rounded-2xl bg-warn-bg p-3 text-[14px] text-terracotta-deep">
            {error}
          </div>
        )}
        <RestrictionsPicker
          consent={consent}
          onConsentChange={setConsent}
          restrictions={restrictions}
          onChange={setRestrictions}
        />
      </div>
      <div className="sticky bottom-0 z-10 -mx-4 mt-8 border-t border-border-soft bg-cream/95 px-4 pt-3 pb-[calc(var(--safe-bottom)+12px)] backdrop-blur-sm lg:mx-0 lg:border-t-0 lg:px-0 lg:pb-4">
        <button type="button" onClick={seeMenu} disabled={saving} className={PILL}>
          {saving ? "Rehaciendo tu menú…" : "Ver mi menú"}
        </button>
      </div>
    </section>
  )
}
