"use client"

/**
 * How «Afina tu menú» is offered to accounts that finished the sign-up
 * before it existed (PRO-146, specs/taste.md): the API decides
 * (`GET /taste/status`).
 *
 * - `TasteIntroScreen`: once, full screen over /menu, «Novedad: afina tu
 *   menú en un minuto» with «Empezar» (→ /afinar, straight to the cards)
 *   and «Ahora no». Either answer is stamped, so it never comes back.
 * - `TasteMenuCard`: after «Ahora no», the card above the menu (artboard
 *   «Cómo se ofrece tras el primer menú») until the user rates a recipe or
 *   closes it with its own «Ahora no», which removes it for good.
 */
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { fetchTasteNext, useTasteOffer, useTasteStatus } from "@/hooks/useTaste"

export function TasteIntroScreen() {
  const status = useTasteStatus()
  const offer = useTasteOffer()
  const router = useRouter()
  if (!status.data?.showIntro || offer.isPending || offer.isSuccess) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="taste-intro-title"
      data-testid="taste-intro"
      className="fixed inset-0 z-[90] overflow-y-auto bg-cream text-ink"
    >
      <div className="mx-auto flex min-h-[100dvh] w-full max-w-[480px] flex-col gap-6 px-6 pt-[calc(var(--safe-top)+56px)] pb-[calc(var(--safe-bottom)+32px)]">
        <p className="m-0 text-[11.2px] font-medium uppercase tracking-[0.18em] text-ink-muted">Novedad</p>
        <h1 id="taste-intro-title" className="m-0 font-display text-[44px] font-normal leading-[0.98] tracking-[-0.025em]">
          Afina tu menú en un <span className="font-italic italic text-terracotta">minuto.</span>
        </h1>
        <p className="m-0 text-[16px] leading-[1.5] text-ink-mid">
          Te enseño 10 recetas y me dices si te apetecen. Así el menú de la semana que viene ya se parece a tu casa.
        </p>
        <div className="flex-1" />
        <button
          type="button"
          onClick={() => {
            offer.mutate("intro_start")
            router.push("/afinar?empezar=1")
          }}
          className="min-h-[52px] w-full rounded-full bg-ink text-[16px] font-medium text-cream"
        >
          Empezar
        </button>
        <button type="button" onClick={() => offer.mutate("intro_later")} className="min-h-[44px] text-[14px] font-medium text-ink">
          Ahora no
        </button>
      </div>
    </div>
  )
}

export function TasteMenuCard() {
  const status = useTasteStatus()
  const offer = useTasteOffer()
  const show = Boolean(status.data?.showCard) && !offer.isPending && !offer.isSuccess
  const preview = useQuery({
    queryKey: ["taste", "preview"],
    queryFn: () => fetchTasteNext({ limit: 3 }),
    enabled: show,
    staleTime: 5 * 60_000,
  })
  if (!show) return null
  const photos = (preview.data?.cards ?? []).map((c) => c.imageUrl).filter((u): u is string => Boolean(u)).slice(0, 3)
  return (
    <section
      data-testid="taste-card-offer"
      aria-labelledby="taste-card-title"
      className="mx-5 mt-3 flex flex-col gap-3.5 rounded-[18px] border border-border-soft bg-paper p-[18px] lg:mx-0"
    >
      {photos.length > 0 && (
        <div className="flex items-center" aria-hidden="true">
          {photos.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={src}
              src={src}
              alt=""
              className={`h-14 w-14 rounded-[10px] object-cover ${i > 0 ? "-ml-[18px] border-2 border-paper" : ""}`}
            />
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <h2 id="taste-card-title" className="m-0 font-display text-[20px] font-[650] leading-[1.15] text-ink">
          Afina tu menú en un minuto
        </h2>
        <p className="m-0 text-[14px] leading-[1.45] text-ink-mid">
          Te enseño 10 recetas y me dices si te apetecen. Así el menú de la semana que viene ya se parece a tu casa.
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Link
          href="/afinar?empezar=1"
          className="flex min-h-[48px] flex-1 items-center justify-center rounded-full bg-ink text-[15px] font-medium text-cream"
        >
          Empezar
        </Link>
        <button
          type="button"
          onClick={() => offer.mutate("card_dismiss")}
          className="min-h-[48px] rounded-full border border-border px-[18px] text-[15px] text-ink"
        >
          Ahora no
        </button>
      </div>
    </section>
  )
}
