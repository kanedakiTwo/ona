"use client"

/**
 * Route-level error boundary: a page that throws while rendering lands here
 * instead of a blank screen, inside the normal app chrome (nav, sidebar).
 * The error is reported to the in-house tracker (specs/errors.md).
 */

import { useEffect } from "react"
import Link from "next/link"
import { reportError } from "@/lib/errorReporter"

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error)
  }, [error])

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center bg-cream px-6 text-center">
      <div className="mx-auto flex max-w-[360px] flex-col items-center gap-6">
        <span className="text-lg italic text-terracotta" style={{ fontFamily: "var(--font-italic)" }}>
          Vaya
        </span>

        <div className="flex flex-col gap-3">
          <h1 className="text-3xl text-ink" style={{ fontFamily: "var(--font-display)" }}>
            Algo se ha torcido
          </h1>
          <p className="text-sm leading-relaxed text-ink-soft">
            Esta pantalla no ha podido cargarse. Nos llega un aviso automático para arreglarlo; mientras, prueba otra vez.
          </p>
        </div>

        <div className="mt-2 flex flex-wrap items-center justify-center gap-3">
          <button
            type="button"
            onClick={reset}
            className="rounded-full bg-ink px-6 py-3 text-sm font-medium text-cream transition active:scale-95"
          >
            Reintentar
          </button>
          <Link
            href="/"
            className="rounded-full border border-border px-6 py-3 text-sm font-medium text-ink transition active:scale-95"
          >
            Ir al inicio
          </Link>
        </div>
      </div>
    </div>
  )
}
