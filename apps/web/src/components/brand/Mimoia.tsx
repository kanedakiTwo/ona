/**
 * Mimoia's imagotipo (2026-10-09, direction A3 "cuchara calada"): a wooden
 * spoon with a heart cut out of the bowl — "comida con cariño". The same
 * symbol is Mimo's face (floating button, panel, WhatsApp profile photo).
 *
 * MIMOIA_SYMBOL_PATH is the single source of truth: one path, fill-rule
 * nonzero (bowl and handle clockwise, heart counter-clockwise, so the heart
 * is a hole), in a 0 0 100 100 box. `scripts/generate-brand-icons.mjs`
 * reads it from this file to build the PWA icons, favicon and profile photo.
 */

export const MIMOIA_SYMBOL_PATH =
  "M20.21 5.18C29.64 -1.42 43.83 2.59 51.92 14.14C60.01 25.70 58.93 40.41 49.50 47.01C40.08 53.60 25.88 49.59 17.80 38.04C9.71 26.49 10.79 11.77 20.21 5.18ZM50.27 39.91L86.17 85.31A8.06 8.06 0 0 1 72.96 94.56L42.57 45.30ZM32.72 23.03C30.68 20.12 26.98 19.47 24.43 21.25C21.16 23.54 20.76 27.61 22.80 30.52C25.85 34.88 33.23 34.58 41.11 35.02C43.40 27.46 46.19 20.63 43.14 16.27C41.11 13.37 37.15 12.35 33.88 14.64C31.33 16.42 30.68 20.12 32.72 23.03Z"

/** The spoon alone, in `currentColor`. Decorative: the caller names it. */
export function MimoiaSymbol({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg
      data-testid="mimoia-symbol"
      viewBox="0 0 100 100"
      width={size}
      height={size}
      className={className}
      aria-hidden
      focusable="false"
    >
      <path d={MIMOIA_SYMBOL_PATH} fill="currentColor" />
    </svg>
  )
}

/**
 * Lockup: terracotta spoon + "mimoia" in Fraunces 650 (lowercase is the
 * logo; in running text the brand stays "Mimoia"). `size` is the wordmark's
 * font size in px; the spoon scales with it.
 */
export function MimoiaLogo({ size = 24, className, testId }: { size?: number; className?: string; testId?: string }) {
  return (
    <span
      data-testid={testId}
      className={`inline-flex items-center text-[#1A1612] ${className ?? ""}`}
      style={{ gap: Math.round(size * 0.1) }}
    >
      <MimoiaSymbol size={Math.round(size * 1.15)} className="flex-none text-[#C65D38]" />
      <span
        style={{
          fontFamily: "var(--font-display)",
          fontWeight: 650,
          fontSize: size,
          lineHeight: 1,
          letterSpacing: "-0.02em",
          fontVariationSettings: '"opsz" 144, "SOFT" 0',
        }}
      >
        mimoia
      </span>
    </span>
  )
}

/** Mimo's face: cream spoon on a terracotta circle (button, panel, WhatsApp photo). */
export function MimoAvatar({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <span
      data-testid="mimo-avatar"
      className={`inline-flex flex-none items-center justify-center rounded-full bg-[#C65D38] text-[#FAF6EE] ${className ?? ""}`}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <MimoiaSymbol size={Math.round(size * 0.62)} />
    </span>
  )
}
