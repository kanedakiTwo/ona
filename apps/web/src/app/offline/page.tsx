"use client"

/**
 * /offline — fallback the service worker serves when a page can't load.
 * Skin: "D · Luz y foto" (PRO-44) — compact header with the brand lockup and
 * one central paper card with an ink "Reintentar" pill. Single column at
 * every breakpoint (centred, max 480 px).
 */

import { MimoiaLogo } from "@/components/brand/Mimoia"

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col bg-cream pb-10">
      <header className="mx-auto flex w-full max-w-[1180px] items-center px-5 pt-4 lg:px-8 lg:pt-8">
        <MimoiaLogo size={20} />
      </header>

      <div className="flex flex-1 items-center justify-center px-5 py-10">
        <section className="w-full max-w-[480px] rounded-[24px] border border-border-soft bg-paper p-6 text-center lg:p-8">
          <h1 className="font-serif-text text-[30px] font-[650] leading-[1.1] text-ink">
            Sin <span className="font-medium italic text-terracotta-deep">conexión</span>
          </h1>
          <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
            Comprueba tu red e intenta de nuevo.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex min-h-[46px] items-center justify-center rounded-full bg-ink px-[22px] text-[15px] font-semibold text-cream transition-colors hover:bg-ink-mid focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink active:scale-95"
          >
            Reintentar
          </button>
        </section>
      </div>
    </div>
  )
}
