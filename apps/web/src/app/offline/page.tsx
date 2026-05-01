"use client"

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-cream px-6 text-center">
      <div className="mx-auto flex max-w-[360px] flex-col items-center gap-6">
        <span
          className="text-5xl tracking-tight text-ink"
          style={{ fontFamily: "var(--font-display)" }}
        >
          ONA
        </span>

        <div className="flex flex-col gap-3">
          <h1
            className="text-3xl text-ink"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Sin conexión
          </h1>
          <p className="text-sm leading-relaxed text-ink-soft">
            Comprueba tu red e intenta de nuevo.
          </p>
        </div>

        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-2 rounded-full bg-ink px-6 py-3 text-sm font-medium text-cream transition active:scale-95"
        >
          Reintentar
        </button>
      </div>
    </div>
  )
}
