"use client"

/**
 * «Cocinar ahora», the answer (specs/cook-now.md): the preferred recipe
 * big, with Mimo's line when it arrives, and two alternatives below. Tapping
 * an alternative makes it the preferred one.
 */
import { useState } from "react"
import { cookNowHitLine } from "@ona/shared"
import { useCookNowPhrase, type CookNowItem, type CookNowProposal } from "@/hooks/useCookNow"
import { PILL_INK, PILL_OUTLINE, SUB_LIST, SubNotice } from "@/components/profile/SubPage"

export const LOCKED_NOTICE = "Esa comida está bloqueada en tu menú: la cocinas igual, pero no la apunto."

function minutesLine(item: CookNowItem): string | null {
  if (item.recipe.totalTime == null) return null
  return `${item.recipe.totalTime} min${item.fit === "margin" ? " · unos minutos más" : ""}`
}

export function ProposalView({
  proposal,
  loading,
  failed,
  locked,
  choosing,
  onCook,
  onRestart,
}: {
  proposal: CookNowProposal | undefined
  loading: boolean
  failed: boolean
  locked: boolean
  choosing: boolean
  onCook: (item: CookNowItem) => void
  onRestart: () => void
}) {
  const [preferredId, setPreferredId] = useState<string | null>(null)
  const items = proposal?.items ?? []
  const preferred = items.find((i) => i.recipe.id === preferredId) ?? items[0]
  const others = items.filter((i) => i !== preferred).slice(0, 2)
  const phrase = useCookNowPhrase(preferred?.recipe.id ?? null)

  const restart = (
    <button type="button" onClick={onRestart} className={`${PILL_OUTLINE} mt-6 w-full md:w-auto`}>
      Cambiar respuestas
    </button>
  )

  if (loading) {
    return (
      <SubNotice>
        <p className="font-serif-text text-[18px] italic text-ink-mid">Buscando…</p>
      </SubNotice>
    )
  }
  if (failed || !proposal || !preferred) {
    return (
      <div>
        <SubNotice dashed>
          <p className="font-serif-text text-[18px] italic text-ink-mid">
            {failed ? "No hemos podido buscar ahora." : "Con esto no encuentro nada"}
          </p>
        </SubNotice>
        {restart}
      </div>
    )
  }

  return (
    <div data-testid="cook-now-proposal">
      {proposal.meal === null && (
        <p role="status" className="mb-4 rounded-2xl bg-cream-deep px-4 py-3 text-[14px] text-ink-mid">
          Hoy ya habéis comido y cenado: la cocinas igual, pero no la apunto en el menú.
        </p>
      )}
      {proposal.meal !== null && locked && (
        <p role="status" className="mb-4 rounded-2xl bg-cream-deep px-4 py-3 text-[14px] text-ink-mid">
          {LOCKED_NOTICE}
        </p>
      )}
      {proposal.fallback && (
        <p className="mb-4 text-[14px] text-ink-soft">Con lo que hay justo no sale ninguna; a estas les falta una cosa</p>
      )}

      <article className="overflow-hidden rounded-[20px] border border-border-soft bg-paper lg:flex lg:max-w-[860px]">
        {preferred.recipe.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preferred.recipe.imageUrl} alt="" className="aspect-[4/3] w-full object-cover lg:aspect-auto lg:w-[360px]" />
        )}
        <div className="p-4 lg:flex lg:flex-1 lg:flex-col lg:justify-center lg:p-6">
          <h2 className="font-serif-text text-[24px] font-[650] leading-tight text-ink">{preferred.recipe.name}</h2>
          {minutesLine(preferred) && <p className="mt-1 font-mono text-[13px] tabular-nums text-ink-muted">{minutesLine(preferred)}</p>}
          <p className="mt-2 text-[15px] text-ink-mid">{cookNowHitLine(preferred)}</p>
          {phrase.data?.text && <p className="mt-2 font-serif-text text-[16px] italic text-ink-soft">{phrase.data.text}</p>}
          <button type="button" onClick={() => onCook(preferred)} disabled={choosing} className={`${PILL_INK} mt-4 w-full lg:w-auto lg:self-start`}>
            Cocinar esta
          </button>
        </div>
      </article>

      {others.length > 0 && (
        <ul className={`${SUB_LIST} mt-4 lg:max-w-[860px]`} aria-label="Otras opciones">
          {others.map((item) => (
            <li key={item.recipe.id}>
              <button
                type="button"
                onClick={() => setPreferredId(item.recipe.id)}
                className="flex min-h-[64px] w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-cream-deep"
              >
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-cream-deep">
                  {item.recipe.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={item.recipe.imageUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[15px] text-ink">{item.recipe.name}</div>
                  <div className="mt-0.5 truncate text-[13px] text-ink-soft">{cookNowHitLine(item)}</div>
                </div>
                {item.recipe.totalTime != null && (
                  <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink-muted">{item.recipe.totalTime} min</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
      {restart}
    </div>
  )
}
