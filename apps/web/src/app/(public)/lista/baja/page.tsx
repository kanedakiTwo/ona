"use client"

/**
 * /lista/baja?t=<token> — leave the waitlist (specs/waitlist.md). One click,
 * on a button rather than on page load, so email link scanners and
 * prefetchers can't unsubscribe anyone. Leaving also turns off the weekly
 * menu email, and the entry is anonymised (email and name deleted).
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { BRAND_NAME } from "@ona/shared"
import { ApiError, apiPublic } from "@/lib/api"

type State = "ready" | "sending" | "done" | "already" | "invalid" | "error"

export default function WaitlistUnsubscribePage() {
  const [token, setToken] = useState<string | null>(null)
  const [state, setState] = useState<State>("ready")

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t")
    setToken(t)
    if (!t) setState("invalid")
  }, [])

  async function leave() {
    if (!token) return
    setState("sending")
    try {
      const res = await apiPublic.post<{ ok: boolean; alreadyUnsubscribed: boolean }>("/waitlist/unsubscribe", { token })
      setState(res.alreadyUnsubscribed ? "already" : "done")
    } catch (err) {
      setState(err instanceof ApiError && err.status === 404 ? "invalid" : "error")
    }
  }

  return (
    <div className="bg-[#FAF6EE] px-6 pb-24 pt-28 text-[#1A1612] md:px-10 md:pt-36">
      <div className="mx-auto max-w-2xl" aria-live="polite">
        <div className="text-eyebrow mb-6">Lista de espera · {BRAND_NAME}</div>

        {(state === "ready" || state === "sending" || state === "error") && (
          <>
            <h1 className="text-editorial-lg">¿Te bajas de la lista?</h1>
            <p className="mt-8 text-base leading-relaxed text-[#4A4239] md:text-lg">
              Sin rencores. Borramos tu email y tu nombre, dejamos de escribirte (también el menú de los viernes,
              si lo tenías) y tu enlace de invitación deja de funcionar.
            </p>
            {state === "error" && (
              <p role="alert" className="mt-6 text-sm text-[#8A3B22]">
                No hemos podido darte de baja. Prueba de nuevo en un momento.
              </p>
            )}
            <button
              type="button"
              onClick={leave}
              disabled={state === "sending" || !token}
              className="mt-10 inline-flex items-center gap-2.5 rounded-full bg-[#1A1612] px-7 py-4 text-base font-medium text-[#FAF6EE] transition-colors hover:bg-[#C65D38] disabled:opacity-40"
            >
              {state === "sending" ? "Dándote de baja…" : "Darme de baja"}
            </button>
          </>
        )}

        {state === "done" && (
          <>
            <h1 className="text-editorial-lg">Hecho. Ya no estás en la lista.</h1>
            <p className="mt-8 text-base leading-relaxed text-[#4A4239]">
              Hemos borrado tu email y tu nombre. Si algún día te apetece volver, la puerta sigue abierta.
            </p>
            <BackHome />
          </>
        )}

        {state === "already" && (
          <>
            <h1 className="text-editorial-lg">Ya estabas fuera de la lista.</h1>
            <p className="mt-8 text-base leading-relaxed text-[#4A4239]">No tienes que hacer nada más.</p>
            <BackHome />
          </>
        )}

        {state === "invalid" && (
          <>
            <h1 className="text-editorial-lg">Este enlace de baja no es válido.</h1>
            <p className="mt-8 text-base leading-relaxed text-[#4A4239]">
              Usa el enlace completo del email que te mandamos o el de la pantalla en la que te apuntaste. Si no lo
              encuentras, escríbenos (el contacto está en la{" "}
              <Link href="/privacidad" className="underline underline-offset-4">
                política de privacidad
              </Link>
              ) y te borramos a mano.
            </p>
            <BackHome />
          </>
        )}
      </div>
    </div>
  )
}

function BackHome() {
  return (
    <Link href="/" className="link-reveal mt-10 inline-block text-sm font-medium">
      Volver al inicio
    </Link>
  )
}
