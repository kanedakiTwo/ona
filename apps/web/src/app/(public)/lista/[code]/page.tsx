"use client"

/**
 * /lista/[code] — the waitlist owner's page (specs/waitlist.md): how many
 * people signed up with their link, and the link to share again. The code is
 * the same one in the public link, so this page shows a count and nothing
 * else — never who those people are, never the owner's own status.
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import { ArrowUpRight } from "lucide-react"
import { BRAND_NAME, waitlistReferralUrl, type WaitlistStatusResponse } from "@ona/shared"
import { ApiError, apiPublic } from "@/lib/api"
import ReferralShare from "@/components/waitlist/ReferralShare"

function invitedHeadline(n: number): string {
  if (n === 0) return "Aún no has invitado a nadie."
  if (n === 1) return "Has invitado a 1 persona."
  return `Has invitado a ${n.toLocaleString("es-ES")} personas.`
}

export default function WaitlistOwnerPage() {
  const params = useParams<{ code: string }>()
  const code = String(params?.code ?? "").toLowerCase()
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ok"; data: WaitlistStatusResponse; origin: string } | { kind: "missing" } | { kind: "error" }
  >({ kind: "loading" })

  useEffect(() => {
    let alive = true
    apiPublic
      .get<WaitlistStatusResponse>(`/waitlist/${encodeURIComponent(code)}`)
      .then((data) => alive && setState({ kind: "ok", data, origin: window.location.origin }))
      .catch((err) => alive && setState({ kind: err instanceof ApiError && err.status === 404 ? "missing" : "error" }))
    return () => {
      alive = false
    }
  }, [code])

  return (
    <div className="bg-[#FAF6EE] px-6 pb-24 pt-28 text-[#1A1612] md:px-10 md:pt-36">
      <div className="mx-auto max-w-2xl">
        <div className="text-eyebrow mb-6">Tu lista de espera · {BRAND_NAME}</div>

        {state.kind === "loading" && <p className="text-[#7A7066]">Cargando…</p>}

        {state.kind === "ok" && (
          <>
            <h1 className="text-editorial-lg" data-testid="waitlist-invited-count">
              {invitedHeadline(state.data.referredCount)}
            </h1>
            <p className="mt-8 text-base leading-relaxed text-[#4A4239] md:text-lg">
              Cada persona de tu casa que se apunta con tu enlace os da prioridad: entráis antes, y juntos.
              Entramos por tandas, cada dos a cuatro semanas, porque cada hogar lo acompañamos de cerca.
            </p>
            <div className="mt-10 rounded-[28px] border border-[#DDD6C5] bg-[#FFFEFA] p-6 md:p-8">
              <h2 className="font-display text-2xl">Tu enlace</h2>
              <div className="mt-4">
                <ReferralShare url={waitlistReferralUrl(state.origin, state.data.code)} />
              </div>
            </div>
            <p className="mt-6 text-xs text-[#7A7066]">
              Esta página solo cuenta cuántas personas han usado tu enlace; no dice quiénes son.
            </p>
          </>
        )}

        {state.kind === "missing" && (
          <>
            <h1 className="text-editorial-lg">Este enlace no existe (o ya no está en la lista).</h1>
            <p className="mt-8 text-base leading-relaxed text-[#4A4239]">
              Puede que esté mal copiado o que esa persona se haya dado de baja.
            </p>
            <JoinLink />
          </>
        )}

        {state.kind === "error" && (
          <>
            <h1 className="text-editorial-lg">No hemos podido cargarlo.</h1>
            <p className="mt-8 text-base leading-relaxed text-[#4A4239]">Prueba de nuevo en un momento.</p>
          </>
        )}
      </div>
    </div>
  )
}

function JoinLink() {
  return (
    <Link
      href="/#lista-de-espera"
      className="mt-10 inline-flex items-center gap-2.5 rounded-full bg-[#1A1612] px-7 py-4 text-base font-medium text-[#FAF6EE] transition-colors hover:bg-[#2D6A4F]"
    >
      Únete a la lista de espera
      <ArrowUpRight size={18} />
    </Link>
  )
}
