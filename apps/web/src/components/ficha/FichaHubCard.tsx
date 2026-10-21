"use client"

/**
 * «Tu ficha» on /profile (PRO-318): the first card of «Tu casa y Mimo»,
 * full width — when it was last updated, how the portrait starts (Cormorant
 * italic), how many things Mimo knows and whether a question waits. A
 * `child` member (403) or a user without a household (404) doesn't get it.
 */
import Link from "next/link"
import type { ApiError } from "@/lib/api"
import { useFicha } from "@/hooks/useFicha"
import { factsCountLabel, lastUpdate, portraitOpening, updatedLabel, visibleQuestion } from "@/lib/ficha"
import { CARD } from "@/app/profile/sections/ProfileCards"

export function FichaHubCard() {
  const ficha = useFicha()
  const status = (ficha.error as ApiError | null)?.status
  if (status === 403 || status === 404) return null
  const view = ficha.data
  const updated = view ? lastUpdate(view) : null
  const question = view ? visibleQuestion(view) : null

  return (
    <Link
      href="/profile/ficha"
      draggable={false}
      data-testid="profile-ficha"
      className={`${CARD} flex flex-col gap-3 p-[18px] transition-colors hover:border-border hover:bg-cream-deep/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink lg:p-5`}
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="font-serif-text text-[20px] font-[650] leading-tight text-ink">Tu ficha</span>
        {updated && <span className="text-[12.5px] text-ink-soft">{updatedLabel(updated)}</span>}
      </span>
      {view ? (
        <>
          <span className="block text-[20px] font-medium italic leading-[1.3] text-ink-mid [font-family:var(--font-italic)]">
            {view.portrait ? `«${portraitOpening(view.portrait.text)}»` : "Todavía os conozco poco"}
          </span>
          {(view.facts.length > 0 || question) && (
            <span className="flex flex-wrap items-center gap-1.5">
              {view.facts.length > 0 && <span className="text-[13px] text-ink-mid">{factsCountLabel(view.facts.length)}</span>}
              {view.facts.length > 0 && question && (
                <span aria-hidden="true" className="text-ink-light">
                  ·
                </span>
              )}
              {question && <span className="text-[13px] font-medium text-terracotta-deep">1 pregunta para ti</span>}
            </span>
          )}
        </>
      ) : ficha.isPending ? (
        <span aria-hidden="true" className="flex animate-pulse flex-col gap-2">
          <span className="block h-5 w-11/12 rounded-full bg-bone" />
          <span className="block h-3.5 w-1/3 rounded-full bg-bone" />
        </span>
      ) : null}
    </Link>
  )
}
