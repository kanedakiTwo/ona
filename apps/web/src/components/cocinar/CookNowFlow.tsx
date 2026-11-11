"use client"

/**
 * «Cocinar ahora» (specs/cook-now.md): four questions — time, people,
 * whether something can be bought, the pantry confirmed — and the proposal.
 * Each step fills the page with «Atrás» on top (on the first one it closes
 * the flow); the answers stay when going back.
 */
import { useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Minus, Plus } from "lucide-react"
import { useCookNowChoose, useCookNowProposal, type CookNowItem, type CookNowToday } from "@/hooks/useCookNow"
import { chooseBody, proposalBody } from "@/lib/cookNowPayload"
import { cookHref } from "@/lib/cookHref"
import { PILL_INK } from "@/components/profile/SubPage"
import { PantryConfirmStep } from "./PantryConfirmStep"
import { LOCKED_NOTICE, ProposalView } from "./ProposalView"
import { DisplaceSheet } from "./DisplaceSheet"

type Minutes = 15 | 30 | 45 | null
type Step = 1 | 2 | 3 | 4 | 5

const TIME_OPTIONS: Array<{ value: Minutes; label: string }> = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 45, label: "45 min" },
  { value: null, label: "1 h o más" },
]

const BIG_OPTION =
  "flex min-h-[64px] w-full items-center justify-center rounded-[20px] border px-5 text-[18px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"

function optionClass(pressed: boolean): string {
  return `${BIG_OPTION} ${pressed ? "border-ink bg-ink text-cream" : "border-border bg-paper text-ink hover:bg-cream-deep"}`
}

function Question({ children }: { children: React.ReactNode }) {
  return <h2 className="font-serif-text text-[28px] font-[650] leading-tight text-ink lg:text-[36px]">{children}</h2>
}

export function CookNowFlow({
  today,
  defaultDiners,
  householdDiners,
  onClose,
}: {
  today: CookNowToday
  defaultDiners: number
  householdDiners: number
  onClose: () => void
}) {
  const router = useRouter()
  const [step, setStep] = useState<Step>(1)
  const [minutes, setMinutes] = useState<Minutes | undefined>(undefined)
  const [servings, setServings] = useState(defaultDiners)
  const [canBuy, setCanBuy] = useState<boolean | undefined>(undefined)
  const [displacing, setDisplacing] = useState<CookNowItem | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const proposal = useCookNowProposal()
  const choose = useCookNowChoose()

  const plannedNames = today.planned.map((d) => d.recipeName)
  const canPlace = today.meal !== null && !today.locked

  function back() {
    if (step === 1) onClose()
    else setStep((s) => (s - 1) as Step)
  }

  function propose() {
    proposal.mutate(proposalBody({ minutes: minutes ?? null, servings, canBuy: canBuy ?? false }))
    setStep(5)
  }

  function place(item: CookNowItem, displacedTo: number | null) {
    const recipeId = item.recipe.id
    choose.mutate(chooseBody({ recipeId, servings, householdDiners, displacedTo }), {
      onSuccess: (r) => {
        if (r.placed) {
          router.push(cookHref(recipeId, servings, { menuId: r.menuId, day: r.day, meal: r.meal }))
        } else {
          if (r.reason !== "locked" && r.reason !== "no_meal") return router.push(cookHref(recipeId, servings))
          // Say it before leaving: the meal got locked (or eaten) after the page loaded.
          setNotice(LOCKED_NOTICE)
          setTimeout(() => router.push(cookHref(recipeId, servings)), 1800)
        }
      },
      // The choice is a nicety: cooking goes on without it.
      onError: () => router.push(cookHref(recipeId, servings)),
    })
  }

  function cook(item: CookNowItem) {
    if (!canPlace) {
      router.push(cookHref(item.recipe.id, servings))
      return
    }
    if (today.planned.length > 0) setDisplacing(item)
    else place(item, null)
  }

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto w-full max-w-[var(--page-max)] px-4 pb-12 pt-3 md:px-8 lg:px-12 lg:pt-6">
        <button
          type="button"
          onClick={back}
          className="-ml-2 inline-flex min-h-[44px] items-center gap-1.5 rounded-full px-2 text-[14px] font-medium text-ink-mid transition-colors hover:text-ink focus-visible:outline-2 focus-visible:outline-ink"
        >
          <ArrowLeft size={18} strokeWidth={2} aria-hidden="true" />
          Atrás
        </button>
        <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted lg:text-[12px]">
          Cocinar ahora{step <= 4 ? ` · ${step} de 4` : ""}
        </p>

        <div className="mt-3 max-w-[640px] lg:max-w-none">
          {step === 1 && (
            <div className="max-w-[640px]">
              <Question>¿Cuánto tiempo tienes?</Question>
              <div className="mt-6 grid grid-cols-2 gap-3">
                {TIME_OPTIONS.map((o) => (
                  <button
                    key={o.label}
                    type="button"
                    aria-pressed={minutes === o.value}
                    onClick={() => {
                      setMinutes(o.value)
                      setStep(2)
                    }}
                    className={optionClass(minutes === o.value)}
                  >
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="max-w-[640px]">
              <Question>¿Para cuántos?</Question>
              <div className="mt-8 flex items-center justify-center gap-6">
                <button
                  type="button"
                  aria-label="Uno menos"
                  onClick={() => setServings((n) => Math.max(1, n - 1))}
                  disabled={servings <= 1}
                  className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-paper text-ink hover:bg-cream-deep disabled:opacity-30"
                >
                  <Minus size={22} aria-hidden="true" />
                </button>
                <output aria-live="polite" aria-label="Personas" className="min-w-[3ch] text-center font-serif-text text-[48px] font-[650] tabular-nums text-ink">
                  {servings}
                </output>
                <button
                  type="button"
                  aria-label="Uno más"
                  onClick={() => setServings((n) => Math.min(20, n + 1))}
                  disabled={servings >= 20}
                  className="flex h-14 w-14 items-center justify-center rounded-full border border-border bg-paper text-ink hover:bg-cream-deep disabled:opacity-30"
                >
                  <Plus size={22} aria-hidden="true" />
                </button>
              </div>
              <button type="button" onClick={() => setStep(3)} className={`${PILL_INK} mt-8 w-full md:w-auto`}>
                Seguir
              </button>
            </div>
          )}

          {step === 3 && (
            <div className="max-w-[640px]">
              <Question>¿Puedes comprar algo?</Question>
              <div className="mt-6 grid gap-3 sm:grid-cols-2">
                {([
                  [false, "Solo lo que hay"],
                  [true, "Sí, algo"],
                ] as const).map(([value, label]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={canBuy === value}
                    onClick={() => {
                      setCanBuy(value)
                      setStep(4)
                    }}
                    className={optionClass(canBuy === value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {step === 4 && <PantryConfirmStep onPropose={propose} proposing={proposal.isPending} />}

          {step === 5 && (
            <>
              {notice && (
                <p role="status" className="mb-4 rounded-2xl bg-cream-deep px-4 py-3 text-[14px] text-ink-mid">
                  {notice}
                </p>
              )}
              <ProposalView
                proposal={proposal.data}
                loading={proposal.isPending}
                failed={proposal.isError}
                locked={today.locked}
                choosing={choose.isPending}
                onCook={cook}
                onRestart={() => setStep(1)}
              />
            </>
          )}
        </div>
      </div>

      <DisplaceSheet
        open={displacing !== null}
        plannedNames={plannedNames}
        today={today.day}
        targets={today.targets}
        onChoose={(displacedTo) => {
          const item = displacing
          setDisplacing(null)
          if (item) place(item, displacedTo)
        }}
      />
    </div>
  )
}
