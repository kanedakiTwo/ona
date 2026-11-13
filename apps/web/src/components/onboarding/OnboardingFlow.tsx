"use client"

/**
 * «Afina tu menú» first (PRO-146): 10 recipe cards with «Saltar» always
 * visible, right after creating the account and before choosing WhatsApp or
 * the web, so everyone does it. Then the questions: household, how they cook,
 * weekday time and, unless answered before the cards, allergies (the three
 * favourite dishes went away: «Me encanta» replaces them; the weekday time
 * question is PRO-138). Since 2026-11-03 (Miguel: they overlapped) there is no
 * «¿Cuántas veces a la semana cocinas?» (it comes from how they cook) and no
 * «¿Qué quieres que Mimoia priorice?» (it barely changed the menu). With 2
 * adults or more, «¿Quién hace la compra?» follows the household and, when
 * someone else buys or they take turns, «Invítale y le llegará la lista cada
 * semana» (PRO-383, D-158), which replaced the «Familia en el mismo hogar»
 * card of step 1.
 *
 * «Semana tipo» fase 4 (D-182 §4): «¿Algo más? Cuéntanos tu caso» gives
 * examples of habits («pasta los miércoles»…) and, when the AI read some into
 * the household's week type, «Así lo he entendido» comes before the first
 * menu: one row per slot, «Está bien» (on to the menu) or «Corregir» (the
 * slots go back as they were and the text opens again).
 *
 * The questions ("D · Luz y foto", PRO-37): one question per
 * screen with a compact header (eyebrow + Fraunces h1 with a terracotta
 * italic accent), answers as paper cards or chips, and an ink pill pinned to
 * the bottom. At `lg+` the column is 560 px with a dish photo beside it
 * (`OnboardingShell`). Behaviour is unchanged: same steps, same payload,
 * same first-menu generation before landing on /menu.
 */
import { useEffect, useState, type ReactNode } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { markOnboardedInCache } from "@/hooks/useOnboardingGate"
import { useAuth } from "@/lib/auth"
import { api } from "@/lib/api"
import { useRouter } from "next/navigation"
import { Check, ChevronLeft, Minus, Plus } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  COOKING_STYLES,
  FREEZE_ANSWERS,
  FREEZE_ANSWER_LABELS,
  FREEZE_QUESTION,
  SHOPPERS,
  SHOPPER_LABELS,
  asksShopper,
  cookingStyleParts,
  firstMenuWeeks,
  shopperInviteText,
  type CookingStyle,
  type FreezeAnswer,
  type OnboardingDraft,
  type Shopper,
  type WeekdayCookingChoice,
} from "@ona/shared"
import { RestrictionsPicker } from "./RestrictionsPicker"
import { withTyped } from "@/lib/restrictionText"
import { Accent, OnboardingHeader, OnboardingShell } from "./OnboardingShell"
import { OnboardingChannelChoice, OnboardingWhatsAppLink } from "./OnboardingWhatsApp"
import { useWhatsAppLinkCode, useWhatsAppStatus } from "@/hooks/useWhatsApp"
import { postTasteOffer, useTasteStatus } from "@/hooks/useTaste"
import { TasteSwiper } from "@/components/taste/TasteSwiper"
import { onboardingStepKey, trackUsage, type OnboardingStep } from "@/lib/usageEvents"
import { RESTRICTIONS_STEP, SHOPPER_INVITE_STEP, SHOPPER_STEP, onboardingOrder, resumeStep } from "@/lib/onboardingSteps"
import { useFamilyOfferOnce, useFamilyOfferStatus } from "@/components/household/FamilyInviteOffer"
import { FamilyInviteShare, familyInviteUrl } from "@/components/household/FamilyInviteShare"
import { DishTypeIcon } from "@/components/weekType/DishTypeIcon"

const PHOTO = "/images/recipes/lentejas-estofadas.jpg"

interface OnboardingData {
  adults: number
  kidsCount: number
  /** PRO-217 «¿Cómo cocináis en casa?» (the API reads how often they cook from it) */
  cookingStyle: CookingStyle | null
  /** PRO-221 «¿Congeláis la carne o el pescado cuando compráis?» (optional) */
  freezesMeatFish: FreezeAnswer | null
  /** PRO-383 «¿Quién hace la compra?» (only with 2 adults or more) */
  shopper: Shopper | null
  restrictions: string[]
  weekdayCooking: WeekdayCookingChoice | null
  cookingNote: string
}

/** D-182 fase 4: what `POST /user/:id/onboarding` says it put in the week type. */
interface WeekTypeUnderstood {
  /** `icon`: a `DishTypeIcon` key (a dish type, `any`, `fixed`, `recipe`, `taper`, `off`, `diners`). */
  rows: Array<{ icon: string; what: string; when: string }>
  /** The slots as they were, for «Corregir» (`PUT /households/me/week-type/:day/:meal`). */
  undo: Array<{ day: number; meal: string; slot: Record<string, unknown> }>
}

/** The step with «¿Algo más? Cuéntanos tu caso». */
const NOTE_STEP = 4

/** PRO-138: «Entre semana, ¿cómo te gusta cocinar?» — the weekend is «sin prisa». */
const WEEKDAY_COOKING_OPTIONS: Array<{ value: WeekdayCookingChoice; label: string; desc: string }> = [
  { value: "rapido", label: "Rápido", desc: "En media hora, a la mesa" },
  { value: "poco_trabajo", label: "Poco rato de trabajo", desc: "Aunque luego se haga solo" },
  { value: "sin_prisa", label: "Sin prisa", desc: "Me da igual lo que tarde" },
]

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
  desc?: string | null
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
      {desc && <span className="text-[13px] leading-snug text-ink-muted">{desc}</span>}
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

/** PRO-178: what «Siguiente» saves (`PUT /user/:id/onboarding-draft`). */
export function onboardingDraftPayload(step: number, data: OnboardingData): OnboardingDraft {
  return {
    step,
    adults: data.adults,
    kidsCount: data.kidsCount,
    cookingStyle: data.cookingStyle,
    freezesMeatFish: data.freezesMeatFish,
    shopper: data.shopper,
    weekdayCooking: data.weekdayCooking,
    cookingNote: data.cookingNote.slice(0, 500),
  }
}

/**
 * PRO-1042: what the account already says before the sign-up (Mimo by
 * WhatsApp, an API sign-up): the questions open with it filled in, and with
 * a menu already made the end doesn't generate another on top.
 */
export interface OnboardingKnown {
  adults?: number | null
  kidsCount?: number | null
  restrictions?: string[] | null
  hasMenu?: boolean
}

export default function OnboardingFlow({ draft = null, known = {} }: { draft?: OnboardingDraft | null; known?: OnboardingKnown } = {}) {
  const { user, updateUser } = useAuth()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [step, setStep] = useState(() => resumeStep(draft))
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [preparingMenu, setPreparingMenu] = useState(false)
  const [error, setError] = useState("")
  // D-182 fase 4: «Así lo he entendido», with the saved sign-up waiting for «Está bien».
  const [understood, setUnderstood] = useState<{ view: WeekTypeUnderstood; result: any } | null>(null)
  const [correcting, setCorrecting] = useState(false)

  const [data, setData] = useState<OnboardingData>(() => ({
    adults: draft?.adults ?? (known.adults && known.adults >= 1 ? known.adults : 2),
    kidsCount: draft?.kidsCount ?? known.kidsCount ?? 0,
    cookingStyle: draft?.cookingStyle ?? null,
    freezesMeatFish: draft?.freezesMeatFish ?? null,
    shopper: draft?.shopper ?? null,
    restrictions: [],
    weekdayCooking: draft?.weekdayCooking ?? null,
    cookingNote: draft?.cookingNote ?? "",
  }))

  // RGPD art. 9 (PRO-21): restrictions are health data, only with this box.
  const [healthConsent, setHealthConsent] = useState(false)

  // Allergies first (a beta tester, 2026-10-22: «estaría bien marcar las intolerancias
  // antes incluso que la sugerencia de recetas»): when «Dime qué te apetece» is coming,
  // «¿Hay algo que no comáis?» goes before it and is saved at once (with the consent),
  // so those 10 dishes already leave out what they don't eat. Then the web questions
  // skip it and the WhatsApp sign-up doesn't ask it again.
  const [allergiesFirst, setAllergiesFirst] = useState<"ask" | "done">("ask")
  const [allergiesAnswered, setAllergiesAnswered] = useState(false)
  const [savingAllergies, setSavingAllergies] = useState(false)
  /** Typed in the allergies box and not added yet: it counts as added (2026-10-22). */
  const [typedRestriction, setTypedRestriction] = useState("")
  const restrictionsWithTyped = withTyped(data.restrictions, typedRestriction)

  // PRO-383: «Invítale…» replaces the sign-up's «Familia en el mismo hogar»
  // card, so it follows the same «once» (PRO-261). Read once: stamping it as
  // shown doesn't take the screen away halfway through.
  const familyOfferStatus = useFamilyOfferStatus()
  const [inviteOffer, setInviteOffer] = useState<boolean | null>(null)
  useEffect(() => {
    if (inviteOffer !== null) return
    if (familyOfferStatus.isError) setInviteOffer(false)
    else if (familyOfferStatus.data) setInviteOffer(familyOfferStatus.data.alta)
  }, [inviteOffer, familyOfferStatus.data, familyOfferStatus.isError])
  const [shopperInvite, setShopperInvite] = useState<{ id: string; token: string } | null>(null)
  const [preparingInvite, setPreparingInvite] = useState(false)
  const [inviteError, setInviteError] = useState(false)

  const order = onboardingOrder({ allergiesAnswered, adults: data.adults, shopper: data.shopper, inviteOffer: inviteOffer === true })
  const position = (s: number) => order.indexOf(s) + 1
  const visibleTotal = order.length
  const isLastStep = order.indexOf(step) === order.length - 1

  // WhatsApp-first (2026-10-10): when the channel is available, the first
  // screen offers to do the first steps with Mimo in WhatsApp. Already linked
  // (e.g. from /whatsapp/conectar) → straight to "Mimo te está escribiendo".
  const whatsapp = useWhatsAppStatus()
  const linkCode = useWhatsAppLinkCode()
  const [channel, setChannel] = useState<"choose" | "whatsapp" | "web" | null>(null)
  useEffect(() => {
    if (channel !== null || whatsapp.isLoading) return
    // A web sign-up left halfway (PRO-178) goes back to its questions.
    setChannel(whatsapp.data?.available ? (whatsapp.data.linked ? "whatsapp" : draft ? "web" : "choose") : "web")
  }, [channel, whatsapp.isLoading, whatsapp.data, draft])
  const canBackToChannel = Boolean(whatsapp.data?.available)

  // «Afina tu menú» step (PRO-146): decided once from the first status, so
  // stamping it as shown doesn't hide it halfway through.
  const tasteStatus = useTasteStatus()
  const [tasteStep, setTasteStep] = useState<"pending" | "show" | "done">("pending")
  useEffect(() => {
    if (tasteStep !== "pending") return
    if (tasteStatus.isError) setTasteStep("done")
    else if (tasteStatus.data) {
      if (tasteStatus.data.offeredInOnboarding) setTasteStep("done")
      else {
        setTasteStep("show")
        postTasteOffer("onboarding").catch(() => {})
      }
    }
  }, [tasteStep, tasteStatus.data, tasteStatus.isError])

  // The invitation screen on screen = the sign-up's offer shown (never again).
  useFamilyOfferOnce("alta", channel === "web" && tasteStep === "done" && step === SHOPPER_INVITE_STEP)

  // PRO-120: each step seen and passed, for the sign-up funnel (the API keeps one per person, step and day).
  const shownStep: OnboardingStep | null =
    tasteStep === "show" ? (allergiesFirst === "ask" ? "dieta" : "afina") : tasteStep !== "done" ? null : channel === "choose" ? "canal" : channel === "web" ? onboardingStepKey(step) : null
  useEffect(() => {
    if (shownStep) trackUsage("onboarding_step", { step: shownStep, action: "visto" })
  }, [shownStep])
  const stepDone = (key: OnboardingStep | null, via?: "web" | "whatsapp") => {
    if (key) trackUsage("onboarding_step", { step: key, action: "hecho", ...(via ? { via } : {}) })
  }

  /** Leaving the allergies step: what is typed and not added yet goes in (2026-10-22). */
  function keepTyped(): OnboardingData {
    if (step !== RESTRICTIONS_STEP || !typedRestriction.trim()) return data
    const kept = { ...data, restrictions: restrictionsWithTyped }
    setData(kept)
    setTypedRestriction("")
    return kept
  }

  function next() {
    const i = order.indexOf(step)
    if (i < 0 || i >= order.length - 1) return
    const current = keepTyped()
    stepDone(onboardingStepKey(step))
    setStep(order[i + 1])
    // PRO-178: the next visit (any device) resumes here with these answers.
    if (user) api.put(`/user/${user.id}/onboarding-draft`, onboardingDraftPayload(order[i + 1], current)).catch(() => {})
  }

  function prev() {
    keepTyped()
    const i = order.indexOf(step)
    if (i > 0) setStep(order[i - 1])
    else if (canBackToChannel) setChannel("choose")
  }

  async function answerAllergiesFirst() {
    if (!user) return
    setError("")
    if (healthConsent && restrictionsWithTyped.length > 0) {
      setSavingAllergies(true)
      try {
        await api.post(`/user/${user.id}/health-consent`, { consent: true })
        const updated = await api.put<{ restrictions?: string[] }>(`/user/${user.id}`, { restrictions: restrictionsWithTyped })
        updateUser({ restrictions: updated.restrictions ?? restrictionsWithTyped })
        setData((d) => ({ ...d, restrictions: restrictionsWithTyped }))
        setTypedRestriction("")
      } catch {
        setSavingAllergies(false)
        setError("No hemos podido guardarlo. Inténtalo otra vez.")
        return
      }
      setSavingAllergies(false)
    }
    stepDone("dieta")
    setAllergiesAnswered(true)
    setAllergiesFirst("done")
    // Answered now, so the allergies step leaves the questions: never stay on it.
    setStep((s) => (s === RESTRICTIONS_STEP ? 4 : s))
  }

  /** PRO-383 «Mandar invitación»: the household invitation (`source: alta`), then «Enviar por WhatsApp» / «Copiar». */
  async function prepareShopperInvite() {
    setPreparingInvite(true)
    setInviteError(false)
    try {
      setShopperInvite(await api.post<{ id: string; token: string }>("/households/me/invites", { role: "member", source: "alta" }))
    } catch {
      setInviteError(true)
    } finally {
      setPreparingInvite(false)
    }
  }

  async function handleComplete() {
    if (!user) return
    setIsSubmitting(true)
    setError("")
    stepDone(onboardingStepKey(step))

    try {
      const payload = {
        adults: data.adults,
        kidsCount: data.kidsCount,
        // Without the box ticked, what Mimo already saved stays (PRO-1042).
        restrictions: healthConsent ? restrictionsWithTyped : known.restrictions ?? [],
        healthConsent,
        weekdayCooking: data.weekdayCooking ?? undefined,
        cookingNote: data.cookingNote.trim() || undefined,
        cookingStyle: data.cookingStyle ?? undefined,
        freezesMeatFish: data.freezesMeatFish ?? undefined,
        shopper: asksShopper(data.adults) ? (data.shopper ?? undefined) : undefined,
      }
      const { weekTypeUnderstood, ...result } = await api.post<any>(`/user/${user.id}/onboarding`, payload)
      // D-182 fase 4: what «tu caso» put in the week type, before the menu is made with it.
      if (weekTypeUnderstood?.rows?.length) {
        setUnderstood({ view: weekTypeUnderstood, result })
        setIsSubmitting(false)
        return
      }
      await finishOnboarding(result)
    } catch (err: any) {
      setError(err.message || "Error al guardar")
    } finally {
      setIsSubmitting(false)
    }
  }

  /** The first menu, then /menu (after the sign-up is saved, and «Así lo he entendido» if it showed). */
  async function finishOnboarding(result: any) {
    if (!user) return
    // Land on a real first menu built from these answers, not an empty
    // week. If generation fails, /menu still offers "Llenar con mi semana tipo".
    // Friday to Sunday (Madrid) the week is nearly over: build the next
    // one too and open it (PRO-65). One after the other, so the second
    // week's variety sees the first. The first menu starts today: the
    // days already gone are not generated (PRO-244, `fromDate`).
    // With a menu already made by Mimo (PRO-1042), that one stays: /menu.
    const { weeks, open, today } = known.hasMenu ? { weeks: [], open: "", today: "" } : firstMenuWeeks()
    if (weeks.length) setPreparingMenu(true)
    for (const weekStart of weeks) {
      await api.post("/menu/generate", { userId: user.id, weekStart, fromDate: today }).catch(() => undefined)
    }

    // Only now mark the user as onboarded (auth context + localStorage).
    // Doing it before the generate let the onboarding page's own
    // "already onboarded" redirect reach /menu first; /menu then found no
    // week (404) and auto-created an empty one on top of the real menu.
    updateUser(result)
    markOnboardedInCache(queryClient, user.id)
    router.push(weeks.length > 1 ? `/menu?week=${open}` : "/menu")
  }

  /** «Está bien»: on to the first menu, with the week type as understood. */
  async function acceptUnderstood() {
    if (!understood) return
    setIsSubmitting(true)
    setError("")
    try {
      await finishOnboarding(understood.result)
    } catch (err: any) {
      setError(err.message || "Error al preparar el menú")
      setIsSubmitting(false)
    }
  }

  /** «Corregir»: the week type as it was, and back to the text (sending it again reads it again). */
  async function correctUnderstood() {
    if (!understood) return
    setCorrecting(true)
    setError("")
    try {
      for (const u of understood.view.undo) await api.put(`/households/me/week-type/${u.day}/${u.meal}`, u.slot)
    } catch {
      // The text is what matters: they can still fix the week in Perfil.
    }
    setCorrecting(false)
    setUnderstood(null)
    setStep(NOTE_STEP)
  }

  const canAdvance = () => {
    switch (step) {
      case 1:
        return data.adults >= 1 && data.kidsCount >= 0
      case 3:
        return data.cookingStyle !== null
      case 4:
        return data.weekdayCooking !== null
      case SHOPPER_STEP:
        return data.shopper !== null
      case SHOPPER_INVITE_STEP:
      case RESTRICTIONS_STEP:
        return true
      default:
        return false
    }
  }

  const pill =
    "flex h-[52px] w-full items-center justify-center rounded-full bg-ink px-6 text-[16px] font-semibold text-cream transition-colors hover:bg-ink-mid active:scale-[0.98] disabled:opacity-40 disabled:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

  if (tasteStep === "show" && allergiesFirst === "ask") {
    return (
      <div className="min-h-[100dvh] bg-cream lg:py-8">
        <OnboardingShell photo={PHOTO}>
          <div data-testid="onboarding-allergies-first" className="flex min-h-[100dvh] flex-col px-4 pt-[calc(var(--safe-top)+12px)] lg:min-h-[calc(100dvh-4rem)] lg:px-0 lg:pt-0">
            <div className="flex-1 pb-8 pt-6 lg:pt-10">
              {error && (
                <div role="alert" className="mb-4 rounded-2xl bg-warn-bg p-3 text-[14px] text-terracotta-deep">
                  {error}
                </div>
              )}
              <OnboardingHeader eyebrow="Primeros pasos">
                Antes de nada, ¿hay algo que <Accent>no comáis</Accent>?
              </OnboardingHeader>
              <Lead>Alergias, intolerancias o cosas que no os gustan. Así, desde el primer plato, no te propongo nada que no podáis comer.</Lead>
              <RestrictionsPicker
                consent={healthConsent}
                onConsentChange={setHealthConsent}
                restrictions={data.restrictions}
                onChange={(restrictions) => setData({ ...data, restrictions })}
                onTypingChange={setTypedRestriction}
              />
            </div>
            <div className="sticky bottom-0 z-10 -mx-4 border-t border-border-soft bg-cream/95 px-4 pt-3 pb-[calc(var(--safe-bottom)+12px)] backdrop-blur-sm lg:mx-0 lg:border-t-0 lg:px-0 lg:pb-4">
              <button type="button" onClick={() => void answerAllergiesFirst()} disabled={savingAllergies} className={pill}>
                {savingAllergies ? "Guardando..." : "Siguiente"}
              </button>
            </div>
          </div>
        </OnboardingShell>
      </div>
    )
  }

  if (tasteStep !== "done") {
    return (
      <div className="min-h-[100dvh] bg-cream lg:py-8">
        <OnboardingShell photo={PHOTO}>
          <div data-testid="onboarding-taste" className="flex min-h-[100dvh] flex-col pt-[var(--safe-top)] lg:min-h-[calc(100dvh-4rem)]">
            {tasteStep === "pending" ? (
              <p role="status" className="px-4 pt-6 text-[14px] text-ink-muted">
                Cargando…
              </p>
            ) : (
              <TasteSwiper
                mode="onboarding"
                onDone={() => {
                  stepDone("afina")
                  setTasteStep("done")
                }}
              />
            )}
          </div>
        </OnboardingShell>
      </div>
    )
  }

  if (understood) {
    return (
      <div className="min-h-[100dvh] bg-cream lg:py-8">
        <OnboardingShell photo={PHOTO}>
          <div data-testid="onboarding-understood" className="flex min-h-[100dvh] flex-col px-4 pt-[calc(var(--safe-top)+12px)] lg:min-h-[calc(100dvh-4rem)] lg:px-0 lg:pt-0">
            <div className="flex-1 pb-8 pt-6 lg:pt-10">
              {error && (
                <div role="alert" className="mb-4 rounded-2xl bg-warn-bg p-3 text-[14px] text-terracotta-deep">
                  {error}
                </div>
              )}
              <OnboardingHeader eyebrow="Tu semana tipo">
                Así lo he <Accent>entendido</Accent>
              </OnboardingHeader>
              <Lead>Con esto hago tu menú cada semana. Lo demás lo elijo yo, y lo cambias cuando quieras en Perfil.</Lead>
              <ul className="mt-6 space-y-3">
                {understood.view.rows.map((row, i) => (
                  <li key={i} data-testid="understood-row" className="flex items-center gap-3 rounded-[20px] border border-border-soft bg-paper p-4">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cream-deep text-ink">
                      <DishTypeIcon type={row.icon} size={24} />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-serif-text text-[17px] font-[650] leading-tight text-ink">{row.what}</span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-ink-muted">{row.when}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="sticky bottom-0 z-10 -mx-4 border-t border-border-soft bg-cream/95 px-4 pt-3 pb-[calc(var(--safe-bottom)+12px)] backdrop-blur-sm lg:mx-0 lg:border-t-0 lg:px-0 lg:pb-4">
              <button type="button" onClick={() => void acceptUnderstood()} disabled={isSubmitting || correcting} className={pill}>
                {preparingMenu ? "Preparando tu menú..." : "Está bien"}
              </button>
              <button
                type="button"
                onClick={() => void correctUnderstood()}
                disabled={isSubmitting || correcting}
                className="mt-1 flex h-11 w-full items-center justify-center rounded-full text-[15px] font-medium text-ink-muted transition-colors hover:text-ink disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
              >
                {correcting ? "Volviendo…" : "Corregir"}
              </button>
            </div>
          </div>
        </OnboardingShell>
      </div>
    )
  }

  if (channel !== "web") {
    return (
      <div className="min-h-[100dvh] bg-cream lg:py-8">
        <OnboardingShell photo={PHOTO}>
          <div className="flex min-h-[100dvh] flex-col px-4 pt-[calc(var(--safe-top)+12px)] lg:min-h-[calc(100dvh-4rem)] lg:px-0 lg:pt-0">
            <div className="flex-1 pb-8 pt-6 lg:pt-10">
              {channel === null ? (
                <p role="status" className="text-[14px] text-ink-muted">
                  Cargando…
                </p>
              ) : channel === "choose" ? (
                <OnboardingChannelChoice
                  onWhatsApp={() => {
                    stepDone("canal", "whatsapp")
                    linkCode.mutate({ from: "onboarding" })
                    setChannel("whatsapp")
                  }}
                  onWeb={() => {
                    stepDone("canal", "web")
                    setChannel("web")
                  }}
                />
              ) : (
                <OnboardingWhatsAppLink linkCode={linkCode} onWeb={() => setChannel("web")} allergiesAsked={allergiesAnswered} />
              )}
            </div>
          </div>
        </OnboardingShell>
      </div>
    )
  }

  return (
    <div className="min-h-[100dvh] bg-cream lg:py-8">
      <OnboardingShell photo={PHOTO}>
        <div className="flex min-h-[100dvh] flex-col px-4 pt-[calc(var(--safe-top)+12px)] lg:min-h-[calc(100dvh-4rem)] lg:px-0 lg:pt-0">
          {/* Back + progress */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={prev}
              disabled={step === 1 && !canBackToChannel}
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
              aria-valuemax={visibleTotal}
              aria-valuenow={position(step)}
            >
              {Array.from({ length: visibleTotal }, (_, i) => (
                <div
                  key={i}
                  className={cn("h-1 flex-1 rounded-full transition-colors", i < position(step) ? "bg-ink" : "bg-border")}
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
                <OnboardingHeader eyebrow={`Primeros pasos · ${position(1)} de ${visibleTotal}`}>
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

            {/* Step 7: Who does the shopping (PRO-383), 2 adults or more */}
            {step === SHOPPER_STEP && (
              <section data-testid="onboarding-shopper">
                <OnboardingHeader eyebrow={`Primeros pasos · ${position(SHOPPER_STEP)} de ${visibleTotal}`}>
                  ¿Quién hace <Accent>la compra</Accent>?
                </OnboardingHeader>
                <Lead>Así sé a quién tiene que llegarle la lista.</Lead>
                <div className="mt-6 space-y-3">
                  {SHOPPERS.map((who) => (
                    <OptionCard
                      key={who}
                      selected={data.shopper === who}
                      onClick={() => setData({ ...data, shopper: who })}
                      label={SHOPPER_LABELS[who]}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Step 8: Invite whoever buys (PRO-383) */}
            {step === SHOPPER_INVITE_STEP && (
              <section data-testid="onboarding-shopper-invite">
                <OnboardingHeader eyebrow={`Primeros pasos · ${position(SHOPPER_INVITE_STEP)} de ${visibleTotal}`}>
                  Invítale y le llegará <Accent>la lista</Accent> cada semana
                </OnboardingHeader>
                <Lead>Entrará en tu casa de Mimoia con un enlace: verá el menú y la lista de la compra de cada semana.</Lead>
                {shopperInvite && (
                  <div className="mt-6 rounded-[20px] border border-border-soft bg-paper p-4">
                    <p data-testid="shopper-invite-message" className="break-words text-[14px] leading-relaxed text-ink">
                      {shopperInviteText(familyInviteUrl(shopperInvite.token))}
                    </p>
                    <FamilyInviteShare inviteId={shopperInvite.id} token={shopperInvite.token} text={shopperInviteText} className="mt-4" />
                  </div>
                )}
                {inviteError && (
                  <p role="alert" className="mt-4 text-[13px] text-terracotta-deep">
                    No he podido preparar la invitación. Puedes hacerlo luego desde Perfil → Mi casa.
                  </p>
                )}
              </section>
            )}

            {/* Step 3: How the household cooks (PRO-217) */}
            {step === 3 && (
              <section data-testid="onboarding-cooking-style">
                <OnboardingHeader eyebrow={`Primeros pasos · ${position(3)} de ${visibleTotal}`}>
                  ¿Cómo cocináis <Accent>en casa</Accent>?
                </OnboardingHeader>
                <Lead>Cada casa se organiza a su manera.</Lead>
                <div className="mt-6 space-y-3">
                  {COOKING_STYLES.map((style) => {
                    const { title, detail } = cookingStyleParts(style)
                    return (
                      <OptionCard
                        key={style}
                        stacked={Boolean(detail)}
                        selected={data.cookingStyle === style}
                        onClick={() => setData({ ...data, cookingStyle: style })}
                        label={title}
                        desc={detail}
                      />
                    )
                  })}
                </div>
                {/* PRO-221: one tap, optional; «Sí» or «A veces» turns on «hoy toca descongelar». */}
                <fieldset className="mt-7" data-testid="onboarding-freeze">
                  <legend className="text-[15px] font-semibold text-ink">{FREEZE_QUESTION}</legend>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {FREEZE_ANSWERS.map((answer) => {
                      const selected = data.freezesMeatFish === answer
                      return (
                        <button
                          key={answer}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setData({ ...data, freezesMeatFish: selected ? null : answer })}
                          className={cn(
                            "min-h-[44px] rounded-full border px-4 text-[14px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                            selected ? "border-ink bg-ink text-cream" : "border-border bg-paper text-ink hover:border-ink",
                          )}
                        >
                          {FREEZE_ANSWER_LABELS[answer]}
                        </button>
                      )
                    })}
                  </div>
                </fieldset>
              </section>
            )}

            {/* Step 4: Time to cook on weekdays (PRO-138) */}
            {step === 4 && (
              <section>
                <OnboardingHeader eyebrow={`Primeros pasos · ${position(4)} de ${visibleTotal}`}>
                  Entre semana, ¿cómo te gusta <Accent>cocinar</Accent>?
                </OnboardingHeader>
                <Lead>El fin de semana, sin prisa.</Lead>
                <div className="mt-6 space-y-3">
                  {WEEKDAY_COOKING_OPTIONS.map((opt) => (
                    <OptionCard
                      key={opt.value}
                      stacked
                      selected={data.weekdayCooking === opt.value}
                      onClick={() => setData({ ...data, weekdayCooking: opt.value })}
                      label={opt.label}
                      desc={opt.desc}
                    />
                  ))}
                </div>
                <label htmlFor="onboarding-cooking-note" className="mt-6 block text-[14px] font-semibold text-ink">
                  ¿Algo más? Cuéntanos tu caso <span className="font-normal text-ink-muted">(opcional)</span>
                </label>
                <textarea
                  id="onboarding-cooking-note"
                  value={data.cookingNote}
                  onChange={(e) => setData({ ...data, cookingNote: e.target.value })}
                  maxLength={500}
                  rows={3}
                  placeholder="P. ej. «pasta los miércoles», «pescado una semana sí y otra no», «el domingo por la noche, sándwich mixto»"
                  className="mt-2 w-full rounded-2xl border border-border bg-paper px-4 py-3 text-[15px] leading-snug text-ink placeholder:text-ink-light transition-colors focus:border-ink focus:outline-none"
                />
              </section>
            )}

            {/* Step 5: Restrictions */}
            {step === RESTRICTIONS_STEP && (
              <section>
                <OnboardingHeader eyebrow={`Primeros pasos · ${position(RESTRICTIONS_STEP)} de ${visibleTotal}`}>
                  ¿Hay algo que <Accent>no comas</Accent>?
                </OnboardingHeader>
                <Lead>Alergias, intolerancias o preferencias.</Lead>
                <RestrictionsPicker
                  consent={healthConsent}
                  onConsentChange={setHealthConsent}
                  restrictions={data.restrictions}
                  onChange={(restrictions) => setData({ ...data, restrictions })}
                  onTypingChange={setTypedRestriction}
                />
              </section>
            )}

          </div>

          {/* Ink pill pinned to the bottom of the column */}
          <div className="sticky bottom-0 z-10 -mx-4 border-t border-border-soft bg-cream/95 px-4 pt-3 pb-[calc(var(--safe-bottom)+12px)] backdrop-blur-sm lg:mx-0 lg:border-t-0 lg:px-0 lg:pb-4">
            {step === SHOPPER_INVITE_STEP && !shopperInvite ? (
              <>
                <button type="button" onClick={() => void prepareShopperInvite()} disabled={preparingInvite} className={pill}>
                  {preparingInvite ? "Preparando…" : "Mandar invitación"}
                </button>
                <button
                  type="button"
                  onClick={next}
                  className="mt-1 flex h-11 w-full items-center justify-center rounded-full text-[15px] font-medium text-ink-muted transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                >
                  Ahora no
                </button>
              </>
            ) : !isLastStep ? (
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
