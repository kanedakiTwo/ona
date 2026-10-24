"use client"

/**
 * /profile/casa/alergias — «Tus alergias y tu dieta» (PRO-271, Seguridad).
 *
 * Right after accepting an invitation to a household (`/invites/[token]`)
 * and before the menu: the person who joins says their allergies and diet,
 * with the separate health-data box (RGPD art. 9, PRO-21) right here. Same
 * picker as the sign-up (`RestrictionsPicker`) and the same API as «Tu menú
 * está listo» (`POST /user/:id/health-consent` + `PUT /user/:id`).
 *
 *   - box ticked + something chosen → saved; every member's restrictions go
 *     into the household's menu (menuGenerator, PRO-271);
 *   - box ticked + nothing chosen → «No tengo ninguna»: the consent records
 *     the answer, so /menu stops asking (≠ never answered);
 *   - box unticked → «No tengo ninguna» (PRO-347: the answer, no health
 *     data; `POST /user/:id/allergies-none`) or «Ahora no»: nothing stored,
 *     /menu keeps warning.
 *
 * What is written by hand is read as Mimo reads it before saving
 * (`POST /user/:id/restrictions/read`, PRO-347): «sin glutn» is saved as «sin
 * gluten», «nada» as nothing, and what isn't understood is asked.
 *
 * If the household's current week already has dishes and something was
 * added, it offers to remake the week (locked meals stay) before the menu.
 * Also opened from the warning above «Generar mi menú» (`?next=/menu`).
 */
import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useQueryClient } from "@tanstack/react-query"
import { firstMenuWeeks, RESTRICTION_PRESETS, unionRestrictions, type HealthConsentState } from "@ona/shared"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"
import { safeNext } from "@/lib/safeNext"
import { RestrictionsPicker } from "@/components/onboarding/RestrictionsPicker"
import { withTyped } from "@/lib/restrictionText"
import { Accent, PILL_INK, PILL_OUTLINE, SubPage } from "@/components/profile/SubPage"

/** Mirrors `RestrictionReading` in apps/api/src/services/restrictionReader.ts. */
interface RestrictionReading {
  text: string
  none: boolean
  restrictions: string[]
  understood: boolean
}

type WeekDays =Array<Record<string, { dishes?: Array<{ kind?: string }> } | undefined>>

function weekHasDishes(days: WeekDays | undefined): boolean {
  return (days ?? []).some((d) => Object.values(d ?? {}).some((slot) => (slot?.dishes ?? []).length > 0))
}

export default function HouseholdAllergiesPage() {
  const { user, updateUser } = useAuth()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [householdName, setHouseholdName] = useState<string | null>(null)
  const [consent, setConsent] = useState(false)
  const [restrictions, setRestrictions] = useState<string[]>([])
  /** Typed in the free-text box and not added yet: it counts and is saved too. */
  const [typed, setTyped] = useState("")
  const toSave = withTyped(restrictions, typed)
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  /** Saved with something new and this week already had dishes. */
  const [offerRemake, setOfferRemake] = useState(false)
  /** Written by hand and not understood (PRO-347): asked, not saved. */
  const [unclear, setUnclear] = useState<string[]>([])

  const next = (() => {
    if (typeof window === "undefined") return "/menu"
    return safeNext(new URLSearchParams(window.location.search).get("next")) ?? "/menu"
  })()

  // Prefill with what the account already has (an existing user who joins).
  useEffect(() => {
    if (!user?.id) return
    let cancelled = false
    Promise.all([
      api.get<{ name: string }>("/households/me").catch(() => null),
      api.get<HealthConsentState>(`/user/${user.id}/health-consent`).catch(() => null),
      api.get<{ restrictions?: string[] }>(`/user/${user.id}`).catch(() => null),
    ]).then(([h, c, u]) => {
      if (cancelled) return
      setHouseholdName(h?.name ?? null)
      if (c?.active) {
        setConsent(true)
        setRestrictions(unionRestrictions(u?.restrictions))
      }
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [user?.id])

  /** «No tengo ninguna» without the box: no health data, only the answer (PRO-347). */
  async function sayNone() {
    if (!user) return
    setSaving(true)
    setError("")
    try {
      await api.post(`/user/${user.id}/allergies-none`)
      await queryClient.invalidateQueries({ queryKey: ["household-allergies"] })
    } catch {
      setSaving(false)
      setError("No hemos podido guardarlo. Inténtalo otra vez.")
      return
    }
    router.push(next)
  }

  async function save() {
    if (!user) return
    if (!consent) {
      router.push(next)
      return
    }
    setSaving(true)
    setError("")
    setUnclear([])
    try {
      await api.post(`/user/${user.id}/health-consent`, { consent: true })
      // PRO-347: what was written by hand is read as Mimo reads it («sin
      // glutn» → «sin gluten»); what isn't understood is asked, not saved.
      let final = toSave
      const free = toSave.filter((r) => !(RESTRICTION_PRESETS as readonly string[]).includes(r))
      if (free.length > 0) {
        const { readings } = await api.post<{ readings: RestrictionReading[] }>(`/user/${user.id}/restrictions/read`, { texts: free })
        final = unionRestrictions(
          toSave.filter((r) => !free.includes(r)),
          readings.flatMap((r) => r.restrictions),
        )
        const notUnderstood = readings.filter((r) => !r.understood).map((r) => r.text)
        if (notUnderstood.length > 0) {
          setRestrictions(final)
          setTyped("")
          setUnclear(notUnderstood)
          setSaving(false)
          return
        }
      }
      const updated = await api.put<{ restrictions?: string[] }>(`/user/${user.id}`, { restrictions: final })
      updateUser({ restrictions: updated.restrictions ?? final })
      if (final.length === 0) await api.post(`/user/${user.id}/allergies-none`)
      await queryClient.invalidateQueries({ queryKey: ["household-allergies"] })
      // The «Alergias e intolerancias» card on /profile reads it.
      await queryClient.invalidateQueries({ queryKey: ["user", user.id] })
      if (final.length > 0) {
        const { weeks } = firstMenuWeeks()
        const week = await api.get<{ days?: WeekDays }>(`/menu/${user.id}/${weeks[0]}`).catch(() => null)
        if (weekHasDishes(week?.days)) {
          setSaving(false)
          setOfferRemake(true)
          return
        }
      }
    } catch {
      setSaving(false)
      setError("No hemos podido guardarlo. Inténtalo otra vez o añádelo luego en tu perfil.")
      return
    }
    router.push(next)
  }

  async function remakeWeek() {
    if (!user) return
    setSaving(true)
    setError("")
    try {
      const { weeks, today } = firstMenuWeeks()
      await api.post("/menu/generate", { userId: user.id, weekStart: weeks[0], fromDate: today })
      await queryClient.invalidateQueries({ queryKey: ["menu"] })
    } catch {
      setSaving(false)
      setError("No hemos podido rehacer el menú. Puedes cambiar los platos desde el menú o pedírselo a Mimo.")
      return
    }
    router.push(next)
  }

  // From «Alergias e intolerancias» on /profile (2026-10-22), not on the way to the menu.
  const fromProfile = next.startsWith("/profile")
  const noneLabel = fromProfile ? "No tengo ninguna" : "No tengo ninguna, ver el menú"
  // PRO-347: «No tengo ninguna» also without the box — it stores no health data.
  const primaryLabel = consent && toSave.length > 0 ? (fromProfile ? "Guardar" : "Guardar y ver el menú") : noneLabel

  return (
    <SubPage
      eyebrow={householdName ?? "Mi casa"}
      title={
        <>
          Tus alergias y tu <Accent>dieta</Accent>
        </>
      }
      intro={
        fromProfile
          ? "¿Tienes alguna alergia o intolerancia, o sigues alguna dieta (vegetariana, sin cerdo…)? Si no está en la lista, escríbela. El menú de la casa las tendrá en cuenta para todos."
          : "Antes de ver el menú de la casa: ¿tienes alguna alergia o intolerancia, o sigues alguna dieta (vegetariana, sin cerdo…)? El menú de la casa las tendrá en cuenta para todos."
      }
    >
      <div data-testid="household-allergies" className="max-w-xl">
        {error && (
          <div role="alert" className="mt-4 rounded-2xl bg-warn-bg p-3 text-[14px] text-terracotta-deep">
            {error}
          </div>
        )}

        {offerRemake ? (
          <div data-testid="household-allergies-remake" className="mt-6 rounded-[20px] border border-border-soft bg-paper p-4">
            <p className="font-serif-text text-[18px] font-[650] text-ink">Guardado.</p>
            <p className="mt-1 text-[14px] leading-relaxed text-ink-mid">
              El menú de esta semana ya estaba hecho y puede llevar algo de lo que no tomas. ¿Lo rehacemos? Los platos
              fijados se quedan.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <button type="button" onClick={() => void remakeWeek()} disabled={saving} className={PILL_INK}>
                {saving ? "Rehaciendo el menú…" : "Rehacer el menú de esta semana"}
              </button>
              <button type="button" onClick={() => router.push(next)} disabled={saving} className={PILL_OUTLINE}>
                {fromProfile ? "Dejar el menú tal cual" : "Ver el menú tal cual"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <RestrictionsPicker
              consent={consent}
              onConsentChange={setConsent}
              restrictions={restrictions}
              onChange={setRestrictions}
              onTypingChange={(text) => {
                setTyped(text)
                if (text) setUnclear([])
              }}
              typed={typed}
            />
            {unclear.length > 0 && (
              <div
                role="alert"
                data-testid="household-allergies-unclear"
                className="mt-4 rounded-2xl bg-warn-bg p-3 text-[14px] leading-relaxed text-ink"
              >
                No hemos entendido {unclear.map((t) => `«${t}»`).join(", ")}. ¿Qué es lo que no puedes comer? Elígelo en
                la lista o escríbelo con otras palabras (p. ej. «sin gluten», «marisco», «pimiento»).
              </div>
            )}
            <div className="mt-8 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => void (consent ? save() : sayNone())}
                disabled={saving || !loaded}
                className={PILL_INK}
              >
                {saving ? "Guardando…" : primaryLabel}
              </button>
              {!consent && (
                <>
                  <button type="button" onClick={() => router.push(next)} disabled={saving} className={PILL_OUTLINE}>
                    {fromProfile ? "Volver" : "Ahora no"}
                  </button>
                  <p className="text-center text-[13px] text-ink-muted">
                    Si tienes alguna y no nos la dices, el menú no sabrá lo que no puedes comer.
                  </p>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </SubPage>
  )
}
