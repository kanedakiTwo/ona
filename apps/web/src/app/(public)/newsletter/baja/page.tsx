"use client"

/**
 * /newsletter/baja?t=<token> — stop the Friday menu email only (PRO-94,
 * specs/newsletter.md). The place on the waitlist stays. One click, on a
 * button rather than on page load, so mail scanners and prefetchers can't
 * unsubscribe anyone (inboxes use the List-Unsubscribe-Post one-click).
 */

import { useEffect, useState } from "react"
import Link from "next/link"
import { BRAND_NAME } from "@ona/shared"
import { ApiError, apiPublic } from "@/lib/api"

type State = "ready" | "sending" | "done" | "already" | "invalid" | "error"

export default function NewsletterUnsubscribePage() {
  const [token, setToken] = useState<string | null>(null)
  const [state, setState] = useState<State>("ready")

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("t")
    setToken(t)
    if (!t) setState("invalid")
  }, [])

  async function stop() {
    if (!token) return
    setState("sending")
    try {
      const res = await apiPublic.post<{ ok: boolean; alreadyUnsubscribed: boolean }>("/newsletter/unsubscribe", { token })
      setState(res.alreadyUnsubscribed ? "already" : "done")
    } catch (err) {
      setState(err instanceof ApiError && err.status === 404 ? "invalid" : "error")
    }
  }

  return (
    <div className="bg-[#FAF6EE] px-6 pb-24 pt-28 text-[#1A1612] md:px-10 md:pt-36">
      <div className="mx-auto max-w-2xl" aria-live="polite">
        <div className="text-eyebrow mb-6">El menú de los viernes · {BRAND_NAME}</div>

        {(state === "ready" || state === "sending" || state === "error") && (
          <>
            <h1 className="text-editorial-lg">¿Dejamos de mandarte el menú de los viernes?</h1>
            <p className="mt-8 text-base leading-relaxed text-[#4A4239] md:text-lg">
              Solo dejas de recibir este email. Tu sitio en la lista de espera sigue igual y te avisaremos cuando
              te toque entrar.
            </p>
            {state === "error" && (
              <p role="alert" className="mt-6 text-sm text-[#8A3B22]">
                No hemos podido darte de baja. Prueba de nuevo en un momento.
              </p>
            )}
            <button
              type="button"
              onClick={stop}
              disabled={state === "sending" || !token}
              className="mt-10 inline-flex items-center gap-2.5 rounded-full bg-[#1A1612] px-7 py-4 text-base font-medium text-[#FAF6EE] transition-colors hover:bg-[#C65D38] disabled:opacity-40"
            >
              {state === "sending" ? "Dándote de baja…" : "No quiero recibirlo más"}
            </button>
          </>
        )}

        {state === "done" && (
          <>
            <h1 className="text-editorial-lg">Hecho. Ya no te mandaremos el menú de los viernes.</h1>
            <p className="mt-8 text-base leading-relaxed text-[#4A4239]">
              Sigues en la lista de espera. Si cambias de idea, escríbenos y te lo volvemos a mandar.
            </p>
            <BackHome />
          </>
        )}

        {state === "already" && (
          <>
            <h1 className="text-editorial-lg">Ya no recibías el menú de los viernes.</h1>
            <p className="mt-8 text-base leading-relaxed text-[#4A4239]">No tienes que hacer nada más.</p>
            <BackHome />
          </>
        )}

        {state === "invalid" && (
          <>
            <h1 className="text-editorial-lg">Este enlace de baja no es válido.</h1>
            <p className="mt-8 text-base leading-relaxed text-[#4A4239]">
              Usa el enlace completo del email. Si no lo encuentras, escríbenos (el contacto está en la{" "}
              <Link href="/privacidad" className="underline underline-offset-4">
                política de privacidad
              </Link>
              ) y lo quitamos a mano.
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
