"use client"

/**
 * «Que Mimoia se pague sola» (PRO-389, D-160; specs/billing.md): which of the
 * two offers being prepared the household would use. In Perfil → Suscripción
 * and in /precios with a session, never on /menu. Once per household: the
 * server says whether it still shows (`GET /usage/offer-interest`); a tap
 * records `offer_interest` and leaves only the thanks, until the page is left.
 * Texts for Legal to review: no date or figure beyond these.
 */

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { SUB_CARD } from "@/components/profile/SubPage"

export type OfferInterestWhere = "suscripcion" | "precios"

const OPTIONS = [
  { option: "tiendas", label: "Un 5 % de descuento en mis tiendas del barrio al pedir con Mimoia" },
  { option: "carrefour", label: "Mimoia gratis el mes que compre más de 100 € en Carrefour con Mimoia" },
  { option: "ninguna", label: "Ninguna de las dos" },
] as const

const KEY = ["offer-interest"]

export function OfferInterestCard({ where, className = "" }: { where: OfferInterestWhere; className?: string }) {
  const qc = useQueryClient()
  const [answered, setAnswered] = useState(false)
  const status = useQuery({
    queryKey: KEY,
    queryFn: () => api.get<{ show: boolean }>("/usage/offer-interest"),
    staleTime: 60_000,
  })
  const answer = useMutation({
    mutationFn: (option: (typeof OPTIONS)[number]["option"]) => api.post("/usage/offer-interest", { option, where }),
    onSuccess: () => {
      setAnswered(true)
      qc.setQueryData(KEY, { show: false })
    },
  })

  if (answered) {
    return (
      <p role="status" className={`${SUB_CARD} px-5 py-4 text-[15px] leading-relaxed text-ink ${className}`} data-testid="offer-interest-thanks">
        Gracias, te avisamos en cuanto esté.
      </p>
    )
  }
  if (!status.data?.show) return null

  return (
    <section className={`${SUB_CARD} p-5 ${className}`} aria-labelledby="offer-interest-title" data-testid="offer-interest">
      <h2 id="offer-interest-title" className="font-serif-text text-[18px] font-[650] leading-snug text-ink">
        Que Mimoia se pague sola
      </h2>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink-mid">
        Estamos preparando dos formas de que tus compras paguen la suscripción. ¿Cuál usarías?
      </p>
      <div className="mt-4 flex flex-col gap-2">
        {OPTIONS.map((o) => (
          <button
            key={o.option}
            type="button"
            disabled={answer.isPending}
            onClick={() => answer.mutate(o.option)}
            className="min-h-[44px] w-full rounded-2xl border border-border bg-paper px-4 py-2.5 text-left text-[14px] font-medium leading-snug text-ink transition-colors hover:bg-cream-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink disabled:opacity-40"
            data-testid={`offer-interest-${o.option}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      {answer.isError && (
        <p role="alert" className="mt-3 text-[13px] text-terracotta-deep">
          No se ha podido guardar. Prueba otra vez.
        </p>
      )}
    </section>
  )
}
