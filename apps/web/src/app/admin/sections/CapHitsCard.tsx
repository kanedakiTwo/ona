"use client"

/**
 * CapHitsCard — «Han llegado al tope este mes» (PRO-1090, D-148).
 *
 * From GET /admin/metrics → `capHits`: households whose user hit Mimo's own
 * budget (`asistente`) or the whole-AI cap (`ia`) for the first time this
 * Madrid month, in the app or by WhatsApp. Admins don't count. Only the first
 * 8 characters of the household id (no names). Spec: specs/metrics.md.
 */

import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { DISPLAY_UI } from "@/components/recipes/RecipeCard"

interface CapHits {
  mes: string
  total: number
  porTope: { asistente: number; ia: number }
  porCanal: { app: number; whatsapp: number }
  ultimos7d: number
  lista: Array<{
    hogar: string
    plan: string
    tope: "asistente" | "ia"
    gastadoEur: number
    topeEur: number
    canal: "app" | "whatsapp"
    en: string
  }>
}

const TOPE = { asistente: "Mimo", ia: "Toda la IA" } as const
const CANAL = { app: "App", whatsapp: "WhatsApp" } as const
const eur = (n: number) => `${n.toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

export function CapHitsCard() {
  const q = useQuery({
    queryKey: ["admin", "metrics", "capHits"],
    queryFn: () => api.get<{ capHits: CapHits }>("/admin/metrics?weeks=1"),
  })
  const hits = q.data?.capHits

  return (
    <section data-testid="cap-hits-card" className="mb-4 rounded-2xl border border-border-soft bg-paper p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-[11px] uppercase tracking-[0.15em] text-ink-mid">Han llegado al tope este mes</h2>
        {hits && <span className="text-[11px] text-ink-light">{hits.ultimos7d} en los últimos 7 días</span>}
      </div>
      {q.isLoading ? (
        <p className="mt-2 text-[12px] text-ink-muted">Cargando…</p>
      ) : q.isError || !hits ? (
        <p className="mt-2 text-[12px] text-ink-muted">No se ha podido cargar.</p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-5 gap-y-1">
            <span data-testid="cap-hits-total" className={`${DISPLAY_UI} text-[2rem] leading-none text-ink`}>
              {hits.total}
            </span>
            <span className="text-[12px] text-ink-mid">
              Mimo {hits.porTope.asistente} · Toda la IA {hits.porTope.ia}
            </span>
            <span className="text-[12px] text-ink-mid">
              App {hits.porCanal.app} · WhatsApp {hits.porCanal.whatsapp}
            </span>
          </div>
          {hits.lista.length === 0 ? (
            <p className="mt-3 text-[12px] italic text-ink-muted">Nadie ha llegado al tope este mes.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border-soft">
              {hits.lista.map((h) => (
                <li key={`${h.hogar}-${h.en}`} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-[12px] text-ink">
                  <span className="font-mono text-ink-mid">{h.hogar}</span>
                  <span>{TOPE[h.tope]}</span>
                  <span className="text-ink-mid">
                    {eur(h.gastadoEur)} de {eur(h.topeEur)}
                  </span>
                  <span className="text-ink-mid">{CANAL[h.canal]}</span>
                  <span className="text-ink-light">plan {h.plan}</span>
                  <span className="ml-auto text-ink-light">
                    {new Date(h.en).toLocaleString("es-ES", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}
