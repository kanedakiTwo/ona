"use client"

/**
 * The five-question onboarding ("D · Luz y foto", PRO-37): one question per
 * screen with a compact header (eyebrow + Fraunces h1 with a terracotta
 * italic accent), answers as paper cards or chips, and an ink pill pinned to
 * the bottom. At `lg+` the column is 560 px with a dish photo beside it
 * (`OnboardingShell`). Behaviour is unchanged: same steps, same payload,
 * same first-menu generation before landing on /menu.
 */
import { useState, type KeyboardEvent, type ReactNode } from "react"
import { useAuth } from "@/lib/auth"
import { api } from "@/lib/api"
import { useRouter } from "next/navigation"
import { Check, ChevronLeft, Minus, Plus, X } from "lucide-react"
import { cn, currentWeekStart } from "@/lib/utils"
import { RESTRICTION_PRESETS } from "@ona/shared"
import { HealthConsentCheckbox } from "@/components/HealthConsentCheckbox"
import { Accent, OnboardingHeader, OnboardingShell } from "./OnboardingShell"

// Shared with the profile so both offer the same chips (@ona/shared).
const PRESET_RESTRICTIONS = RESTRICTION_PRESETS

const PHOTO = "/images/recipes/lentejas-estofadas.jpg"

interface OnboardingData {
  adults: number
  kidsCount: number
  cookingFreq: string | null
  restrictions: string[]
  favoriteDishes: string[]
  priority: string | null
}

const FIELD =
  "h-12 w-full rounded-2xl border border-border bg-paper px-4 text-[15px] text-ink placeholder:text-ink-light transition-colors focus:border-ink focus:outline-none disabled:opacity-60"

/** Paper answer card; selected = ink border + ink check. */
function OptionCard({
  selected,
  onClick,
  label,
  desc,
  stacked,
}: {
  selected: boolean
  onClick: () => void
  label: string
  desc: string
  stacked?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        "relative flex min-h-[64px] w-full rounded-[20px] border bg-paper p-4 pr-12 text-left transition-colors active:scale-[0.99] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
        stacked ? "flex-col justify-start gap-1" : "items-center",
        selected ? "border-ink ring-1 ring-ink" : "border-border-soft hover:border-ink",
      )}
    >
      <span className={cn("font-serif-text text-[17px] font-[650] leading-tight text-ink", !stacked && "mr-2")}>
        {label}
      </span>
      <span className="text-[13px] leading-snug text-ink-muted">{desc}</span>
      <span
        aria-hidden="true"
        className={cn(
          "absolute right-4 top-4 flex h-6 w-6 items-center justify-center rounded-full border transition-colors",
          selected ? "border-ink bg-ink text-cream" : "border-border bg-paper text-transparent",
        )}
      >
        <Check size={14} strokeWidth={2.5} />
      </span>
    </button>
  )
}

/** Household counter in a paper card with 44 px − / + buttons. */
function Counter({
  label,
  value,
  onDec,
  onInc,
  decLabel,
  incLabel,
}: {
  label: string
  value: number
  onDec: () => void
  onInc: () => void
  decLabel: string
  incLabel: string
}) {
  const btn =
    "flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-paper text-ink transition-colors hover:border-ink active:scale-95 focus-visible:outline-2 focus-visible:outline-ink"
  return (
    <div className="rounded-[20px] border border-border-soft bg-paper p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{label}</p>
      <div className="mt-3 flex items-center justify-between gap-2">
        <button type="button" onClick={onDec} className={btn} aria-label={decLabel}>
          <Minus size={18} />
        </button>
        <span className="font-serif-text text-[28px] font-[650] tabular-nums text-ink" aria-live="polite">
          {value}
        </span>
        <button type="button" onClick={onInc} className={btn} aria-label={incLabel}>
          <Plus size={18} />
        </button>
      </div>
    </div>
  )
}

function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-[14px] leading-relaxed text-ink-muted">{children}</p>
}

export default function OnboardingFlow() {
  const { user, updateUser } = useAuth()
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [preparingMenu, setPreparingMenu] = useState(false)
  const [error, setError] = useState("")

  const [data, setData] = useState<OnboardingData>({
    adults: 2,
    kidsCount: 0,
    cookingFreq: null,
    restrictions: [],
    favoriteDishes: ["", "", ""],
    priority: null,
  })

  const [tagInput, setTagInput] = useState("")
  // RGPD art. 9 (PRO-21): restrictions are health data, only with this box.
  const [healthConsent, setHealthConsent] = useState(false)

  const totalSteps = 5

  function next() {
    if (step < totalSteps) setStep(step + 1)
  }

  function prev() {
    if (step > 1) setStep(step - 1)
  }

  function addRestriction(tag: string) {
    const trimmed = tag.trim().toLowerCase()
    if (trimmed && !data.restrictions.includes(trimmed)) {
      setData({ ...data, restrictions: [...data.restrictions, trimmed] })
    }
    setTagInput("")
  }

  function removeRestriction(tag: string) {
    setData({
      ...data,
      restrictions: data.restrictions.filter((r) => r !== tag),
    })
  }

  function handleTagKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault()
      addRestriction(tagInput)
    }
  }

  function setFavoriteDish(index: number, value: string) {
    const dishes = [...data.favoriteDishes]
    dishes[index] = value
    setData({ ...data, favoriteDishes: dishes })
  }

  async function handleComplete() {
    if (!user) return
    setIsSubmitting(true)
    setError("")

    try {
      const payload = {
        adults: data.adults,
        kidsCount: data.kidsCount,
        cookingFreq: data.cookingFreq,
        restrictions: healthConsent ? data.restrictions : [],
        favoriteDishes: data.favoriteDishes.filter((d) => d.trim() !== ""),
        priority: data.priority,
        healthConsent,
      }
      const result = await api.post<any>(`/user/${user.id}/onboarding`, payload)

      // Land on a real first menu built from these answers, not an empty
      // week. If generation fails, /menu still offers "Generar mi menú".
      setPreparingMenu(true)
      await api
        .post("/menu/generate", { userId: user.id, weekStart: currentWeekStart() })
        .catch(() => undefined)

      // Only now mark the user as onboarded (auth context + localStorage).
      // Doing it before the generate let the onboarding page's own
      // "already onboarded" redirect reach /menu first; /menu then found no
      // week (404) and auto-created an empty one on top of the real menu.
      updateUser(result)
      router.push("/menu")
    } catch (err: any) {
      setError(err.message || "Error al guardar")
    } finally {
      setIsSubmitting(false)
    }
  }

  const canAdvance = () => {
    switch (step) {
      case 1:
        return data.adults >= 1 && data.kidsCount >= 0
      case 2:
        return data.cookingFreq !== null
      case 3:
        return true
      case 4:
        return data.favoriteDishes.some((d) => d.trim() !== "")
      case 5:
        return data.priority !== null
      default:
        return false
    }
  }

  const pill =
    "flex h-[52px] w-full items-center justify-center rounded-full bg-ink px-6 text-[16px] font-semibold text-cream transition-colors hover:bg-ink-mid active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

  return (
    <div className="min-h-[100dvh] bg-cream lg:py-8">
      <OnboardingShell photo={PHOTO}>
        <div className="flex min-h-[100dvh] flex-col px-4 pt-[calc(var(--safe-top)+12px)] lg:min-h-[calc(100dvh-4rem)] lg:px-0 lg:pt-0">
          {/* Back + progress */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={prev}
              disabled={step === 1}
              aria-label="Atrás"
              className="-ml-1.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors hover:bg-cream-deep disabled:invisible focus-visible:outline-2 focus-visible:outline-ink"
            >
              <ChevronLeft size={22} />
            </button>
            <div
              className="flex flex-1 gap-1.5"
              role="progressbar"
              aria-label="Progreso"
              aria-valuemin={1}
              aria-valuemax={totalSteps}
              aria-valuenow={step}
            >
              {Array.from({ length: totalSteps }, (_, i) => (
                <div
                  key={i}
                  className={cn("h-1 flex-1 rounded-full transition-colors", i < step ? "bg-ink" : "bg-border")}
                />
              ))}
            </div>
          </div>

          <div className="flex-1 pb-8 pt-6 lg:pt-10">
            {error && (
              <div role="alert" className="mb-4 rounded-2xl bg-warn-bg p-3 text-[14px] text-terracotta-deep">
                {error}
              </div>
            )}

            {/* Step 1: Household size */}
            {step === 1 && (
              <section>
                <OnboardingHeader eyebrow={`Primeros pasos · 1 de ${totalSteps}`}>
                  ¿Para <Accent>cuántos</Accent> cocinas?
                </OnboardingHeader>
                <Lead>Adultos cuenta a partir de 11 años. Niños son los de 2 a 10. Los menores de 2 no cuentan.</Lead>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  <Counter
                    label="Adultos"
                    value={data.adults}
                    onDec={() => setData({ ...data, adults: Math.max(1, data.adults - 1) })}
                    onInc={() => setData({ ...data, adults: Math.min(20, data.adults + 1) })}
                    decLabel="Quitar adulto"
                    incLabel="Añadir adulto"
                  />
                  <Counter
                    label="Niños 2–10"
                    value={data.kidsCount}
                    onDec={() => setData({ ...data, kidsCount: Math.max(0, data.kidsCount - 1) })}
                    onInc={() => setData({ ...data, kidsCount: Math.min(20, data.kidsCount + 1) })}
                    decLabel="Quitar niño"
                    incLabel="Añadir niño"
                  />
                </div>
                <p className="mt-3 text-[13px] italic text-ink-muted">
                  Cada niño cuenta como media ración para la lista de la compra.
                </p>
              </section>
            )}

            {/* Step 2: Cooking frequency */}
            {step === 2 && (
              <section>
                <OnboardingHeader eyebrow={`Primeros pasos · 2 de ${totalSteps}`}>
                  ¿Cuántas veces a la semana cocinas <Accent>de verdad</Accent>?
                </OnboardingHeader>
                <Lead>No cuenta calentar sobras.</Lead>
                <div className="mt-6 space-y-3">
                  {[
                    { value: "rarely", label: "Poco", desc: "Prefiero recetas rápidas" },
                    { value: "3_4_times", label: "3-4 veces", desc: "Lo normal" },
                    { value: "daily", label: "Todos los días", desc: "Me encanta cocinar" },
                  ].map((opt) => (
                    <OptionCard
                      key={opt.value}
                      selected={data.cookingFreq === opt.value}
                      onClick={() => setData({ ...data, cookingFreq: opt.value })}
                      label={opt.label}
                      desc={opt.desc}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Step 3: Restrictions */}
            {step === 3 && (
              <section>
                <OnboardingHeader eyebrow={`Primeros pasos · 3 de ${totalSteps}`}>
                  ¿Hay algo que <Accent>no comas</Accent>?
                </OnboardingHeader>
                <Lead>Alergias, intolerancias o preferencias.</Lead>
                <div className="mt-5">
                  <HealthConsentCheckbox
                    checked={healthConsent}
                    onChange={(v) => {
                      setHealthConsent(v)
                      if (!v) setData({ ...data, restrictions: [] })
                    }}
                  />
                  {!healthConsent && (
                    <p className="mt-2 text-[13px] text-ink-muted">
                      Sin tu consentimiento no guardamos alergias ni restricciones; puedes seguir sin marcarlo.
                    </p>
                  )}
                </div>
                <div
                  className={cn("mt-6", !healthConsent && "pointer-events-none opacity-40")}
                  aria-disabled={!healthConsent}
                >
                  <div className="flex flex-wrap gap-2">
                    {PRESET_RESTRICTIONS.map((tag) => {
                      const active = data.restrictions.includes(tag)
                      return (
                        <button
                          key={tag}
                          type="button"
                          disabled={!healthConsent}
                          aria-pressed={active}
                          onClick={() => (active ? removeRestriction(tag) : addRestriction(tag))}
                          // 36 px visual + a pseudo-element that stretches the hit area to 44 px.
                          className={cn(
                            "relative h-9 rounded-full border px-3.5 text-[14px] transition-colors before:absolute before:inset-x-0 before:-inset-y-1 active:scale-[0.97]",
                            active
                              ? "border-ink bg-ink font-medium text-cream"
                              : "border-border bg-paper text-ink hover:border-ink",
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
                      disabled={!healthConsent}
                      placeholder="Escribe y pulsa Enter para añadir..."
                      className={FIELD}
                    />
                  </div>
                  {data.restrictions.length > 0 && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {data.restrictions.map((tag) => (
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
              </section>
            )}

            {/* Step 4: Favorite dishes */}
            {step === 4 && (
              <section>
                <OnboardingHeader eyebrow={`Primeros pasos · 4 de ${totalSteps}`}>
                  Dame 3 platos que te <Accent>encanten</Accent>
                </OnboardingHeader>
                <Lead>Para entender tus gustos.</Lead>
                <div className="mt-6 space-y-3">
                  {[0, 1, 2].map((i) => (
                    <input
                      key={i}
                      type="text"
                      value={data.favoriteDishes[i]}
                      onChange={(e) => setFavoriteDish(i, e.target.value)}
                      placeholder={`Plato ${i + 1}`}
                      className={FIELD}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Step 5: Priority */}
            {step === 5 && (
              <section>
                <OnboardingHeader eyebrow={`Primeros pasos · 5 de ${totalSteps}`}>
                  ¿Qué quieres que Mimoia <Accent>priorice</Accent>?
                </OnboardingHeader>
                <Lead>Elegimos el enfoque de tus menús.</Lead>
                <div className="mt-6 grid grid-cols-2 gap-3">
                  {[
                    { value: "healthy", label: "Salud", desc: "Equilibrio nutricional" },
                    { value: "quick", label: "Rapidez", desc: "Recetas sencillas" },
                    { value: "varied", label: "Variedad", desc: "Probar cosas nuevas" },
                    { value: "cheap", label: "Ahorro", desc: "Máximo con poco" },
                  ].map((opt) => (
                    <OptionCard
                      key={opt.value}
                      stacked
                      selected={data.priority === opt.value}
                      onClick={() => setData({ ...data, priority: opt.value })}
                      label={opt.label}
                      desc={opt.desc}
                    />
                  ))}
                </div>
              </section>
            )}
          </div>

          {/* Ink pill pinned to the bottom of the column */}
          <div className="sticky bottom-0 z-10 -mx-4 border-t border-border-soft bg-cream/95 px-4 pt-3 pb-[calc(var(--safe-bottom)+12px)] backdrop-blur-sm lg:mx-0 lg:border-t-0 lg:px-0 lg:pb-4">
            {step < totalSteps ? (
              <button type="button" onClick={next} disabled={!canAdvance()} className={pill}>
                Siguiente
              </button>
            ) : (
              <button type="button" onClick={handleComplete} disabled={!canAdvance() || isSubmitting} className={pill}>
                {preparingMenu ? "Preparando tu menú..." : isSubmitting ? "Guardando..." : "Empezar"}
              </button>
            )}
          </div>
        </div>
      </OnboardingShell>
    </div>
  )
}
