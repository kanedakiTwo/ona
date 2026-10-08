"use client"

/**
 * Last-resort error boundary: the root layout itself failed, so this
 * replaces it entirely (own <html>/<body>, no app chrome, no next/font
 * variables — the display font falls back to the serif stack). The error is
 * reported to the in-house tracker (specs/errors.md).
 */

import { useEffect } from "react"
import { reportError } from "@/lib/errorReporter"
import "./globals.css"

export default function GlobalError({ error }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    reportError(error)
  }, [error])

  return (
    <html lang="es">
      <body className="bg-cream text-ink" style={{ backgroundColor: "#FAF6EE", color: "#1A1612" }}>
        <div className="flex min-h-screen flex-col items-center justify-center px-6 text-center">
          <div className="mx-auto flex max-w-[360px] flex-col items-center gap-6">
            <span className="text-5xl tracking-tight" style={{ fontFamily: "var(--font-display)" }}>
              Mimoia
            </span>

            <div className="flex flex-col gap-3">
              <h1 className="text-3xl" style={{ fontFamily: "var(--font-display)" }}>
                Algo se ha torcido
              </h1>
              <p className="text-sm leading-relaxed text-ink-soft">
                La aplicación no ha podido cargarse. Nos llega un aviso automático para arreglarlo; mientras, recarga la página.
              </p>
            </div>

            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-2 rounded-full bg-ink px-6 py-3 text-sm font-medium text-cream transition active:scale-95"
            >
              Recargar
            </button>
          </div>
        </div>
      </body>
    </html>
  )
}
