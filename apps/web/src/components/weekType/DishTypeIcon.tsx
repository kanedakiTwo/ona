"use client"

/**
 * «Tu semana tipo» (D-182): one simple 24 px stroke icon per dish type
 * (`DISH_TYPES`) and per wildcard, drawn for the design mock-up. They take
 * the text colour (`currentColor`) and are decorative (the label says it).
 */
import type { ReactNode } from "react"
import type { WeekTypeOption } from "@ona/shared"

const PATHS: Record<string, ReactNode> = {
  receta: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5zM9 7h7M9 10.5h5" />
    </>
  ),
  legumbres: (
    <>
      <path d="M3 12h18a9 8 0 0 1-18 0z" /><circle cx="8" cy="9" r="1.6" /><circle cx="12" cy="7.5" r="1.6" /><circle cx="16" cy="9" r="1.6" />
    </>
  ),
  cremas: (
    <>
      <path d="M3 12h18a9 8 0 0 1-18 0z" /><path d="M9 8.5c-1-1.2 1-2.2 0-3.5M13 8.5c-1-1.2 1-2.2 0-3.5M17 8.5c-1-1.2 1-2.2 0-3.5" />
    </>
  ),
  guisos: (
    <>
      <path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" /><path d="M2 12h2M20 12h2M7 7h10M12 4.5V7" />
    </>
  ),
  pescado: (
    <>
      <path d="M2.5 12c3-5 9.5-6.2 14.5-1.8L21 7v10l-4-3.2C12 18.2 5.5 17 2.5 12z" /><circle cx="7.5" cy="11" r="0.9" />
    </>
  ),
  pollo: (
    <>
      <path d="M15.5 3.5a5 5 0 0 1 3 8.5l-4.5 3-4-4 3-4.5a5 5 0 0 1 2.5-3z" /><path d="M10 13l-4 4" /><circle cx="5" cy="18.5" r="1.6" /><circle cx="7" cy="20.3" r="1.2" />
    </>
  ),
  carne: (
    <>
      <path d="M5 8c2-4 9-5 13-2s3 9-2 11-10 2-12-1 0-5 1-8z" /><circle cx="14" cy="10.5" r="2" />
    </>
  ),
  huevos: (
    <>
      <path d="M7 5c3-2 7 0 9 2s5 3 4 7-5 6-9 5-8-2-8-6 1-6 4-8z" /><circle cx="12" cy="12" r="3" />
    </>
  ),
  plancha: (
    <>
      <rect x="4" y="6" width="16" height="10" rx="2" /><path d="M8 6v10M12 6v10M16 6v10M7 20l2-4M17 20l-2-4" />
    </>
  ),
  pasta: (
    <>
      <path d="M3 12h18a9 8 0 0 1-18 0z" /><path d="M8 12c0-3 2-3 2-6M12 12c0-3 2-3 2-6M16 12c0-3-2-4-1-7" />
    </>
  ),
  arroz: (
    <>
      <ellipse cx="12" cy="13" rx="8" ry="5" /><path d="M4 13H2M22 13h-2" /><circle cx="9" cy="12" r="0.8" /><circle cx="13" cy="14.5" r="0.8" /><circle cx="15.5" cy="11.5" r="0.8" />
    </>
  ),
  pizza: (
    <>
      <path d="M12 21 3.5 6.5a17 17 0 0 1 17 0z" /><path d="M5.5 9.5a13 13 0 0 1 13 0" /><circle cx="11" cy="12" r="1" /><circle cx="13.5" cy="15.5" r="1" />
    </>
  ),
  bocadillos: (
    <>
      <path d="M4 15 12 6l8 9z" /><path d="M6.5 13h11" /><path d="M4 15h16v3H4z" />
    </>
  ),
  ensaladas: (
    <>
      <path d="M3 12h18a9 8 0 0 1-18 0z" /><path d="M8 11c0-4 3-6 7-6 0 4-3 6-7 6z" /><path d="M8 11c2-2 4-3 6-5" />
    </>
  ),
  verduras: (
    <>
      <path d="M14 10 4.5 19.5c-.8.8-2 0-1.5-1L8 9.5c1.5-2 4.5-1.5 6 .5z" /><path d="M14 10c1-3 3-4 6-4M14 10c0-3-1-5-3-6M14 10c2-1 4 0 6 1" />
    </>
  ),
  ceviche: (
    <>
      <circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="6" /><path d="M12 6v12M6 12h12M7.8 7.8l8.4 8.4M16.2 7.8l-8.4 8.4" />
    </>
  ),
  carpaccio: (
    <>
      <circle cx="12" cy="12" r="9" /><path d="M8 9c2-2 6-2 8 0M7 13c3-2 7-2 10 0M8.5 16.5c2-1.3 5-1.3 7 0" />
    </>
  ),
  asiatico: (
    <>
      <path d="M3 13h18a9 7 0 0 1-18 0z" /><path d="M13 10 20 3M16 10l5-5" />
    </>
  ),
  mexicano: (
    <>
      <path d="M3 17a9 9 0 0 1 18 0z" /><path d="M6.5 13.5c1-.8 2-.8 3 0s2 .8 3 0 2-.8 3 0 2 .8 2.5.2" />
    </>
  ),
  orienteMedio: (
    <>
      <path d="M3 12h18a9 8 0 0 1-18 0z" /><path d="M12 9.5c-2.2 0-3.5-1-3.5-2.2S10 5 12 5s3.5 1 3.5 2.4" /><path d="M12 7.4h.01" />
    </>
  ),
  tostadas: (
    <>
      <path d="M6 20v-9a4 4 0 0 1-1-7c2-1.5 5-1 7 0 2-1 5-1.5 7 0a4 4 0 0 1-1 7v9z" />
    </>
  ),
  cereales: (
    <>
      <path d="M3 12h18a9 8 0 0 1-18 0z" /><path d="M15 9 20 4" /><circle cx="8" cy="10" r="0.8" /><circle cx="11" cy="9" r="0.8" /><circle cx="13" cy="10.5" r="0.8" />
    </>
  ),
  yogur: (
    <>
      <path d="M6 9h12l-1.5 11h-9z" /><path d="M5 9h14" /><circle cx="14" cy="5.5" r="2" /><path d="M14 3.5c0-1 1-1.5 2-1.5" />
    </>
  ),
  dulce: (
    <>
      <path d="M4 10c0-1.5 3.5-2.5 8-2.5s8 1 8 2.5-3.5 2.5-8 2.5-8-1-8-2.5z" /><path d="M4 10v2.5c0 1.5 3.5 2.5 8 2.5s8-1 8-2.5V10M4 12.5V15c0 1.5 3.5 2.5 8 2.5s8-1 8-2.5v-2.5" /><path d="M12 7.5V5" />
    </>
  ),
  cualquiera: (
    <>
      <circle cx="12" cy="12" r="5.5" /><path d="M3.5 4v5a1.5 1.5 0 0 0 3 0V4M5 9.5V20M20.5 4c-1.5 0-2.5 2-2.5 5s1 3.5 2.5 3.5V20" />
    </>
  ),
  taper: (
    <>
      <rect x="3.5" y="9" width="17" height="10" rx="2" /><path d="M3 9h18M5 9V7a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1v2" />
    </>
  ),
  fijo: (
    <>
      <path d="M9 3h6l-1 5 3 3H7l3-3z" /><path d="M12 11v10" />
    </>
  ),
  sushi: (
    <>
      <circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3.5" /><path d="M12 10.5v3" />
    </>
  ),
  chile: (
    <>
      <path d="M9 8c-1 5 1 11 10 13-1-6-3-11-7-13z" /><path d="M9.5 8c0-2.5 1.5-4 3.5-4" />
    </>
  ),
  olivo: (
    <>
      <ellipse cx="9" cy="14.5" rx="3.5" ry="4.5" transform="rotate(-20 9 14.5)" /><ellipse cx="16" cy="12.5" rx="3" ry="4" transform="rotate(20 16 12.5)" /><path d="M10 9.5c1-3 3-5 6-6M15.5 8.5l1-4.5" />
    </>
  ),
  maiz: (
    <>
      <path d="M12 3c-3 3-4 8-3 13l3 5 3-5c1-5 0-10-3-13z" /><path d="M10 9h4M9.5 12.5h5M10 16h4" /><path d="M8.5 16.5C5.5 15.5 4 13 4 10c3 0 5 2 6 4.5M15.5 16.5c3-1 4.5-3.5 4.5-6.5-3 0-5 2-6 4.5" />
    </>
  ),
}

/** `DISH_TYPES` key → icon (the mock-up names a few after what they draw). */
const TYPE_ICON: Record<string, string> = {
  "legumbres": "legumbres",
  "cremas-sopas": "cremas",
  "guisos": "guisos",
  "pescado": "pescado",
  "pollo": "pollo",
  "carne": "carne",
  "huevos": "huevos",
  "plancha-brasa": "plancha",
  "pasta": "pasta",
  "arroz": "arroz",
  "pizza": "pizza",
  "bocadillos": "bocadillos",
  "ensaladas": "ensaladas",
  "verduras": "verduras",
  "ceviche": "ceviche",
  "carpaccio-tartar": "carpaccio",
  "italiano": "olivo",
  "japones": "sushi",
  "chino-wok": "asiatico",
  "indio": "chile",
  "mexicano": "mexicano",
  "sudamericano": "maiz",
  "oriente-medio": "orienteMedio",
  "tostadas": "tostadas",
  "cereales-avena": "cereales",
  "yogur-fruta": "yogur",
  "dulce-finde": "dulce",
}

/** The icon of a dish type, or of a wildcard (`any`, `taper`, `fixed`, `recipe`). */
export function DishTypeIcon({ type, size = 24, className = "" }: { type: string; size?: number; className?: string }) {
  const name = TYPE_ICON[type] ?? WILDCARD_ICON[type] ?? "cualquiera"
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 ${className}`}
    >
      {PATHS[name]}
    </svg>
  )
}

const WILDCARD_ICON: Record<string, string> = { any: "cualquiera", taper: "taper", fixed: "fijo", recipe: "receta" }

/** The icon of a week type option. */
export function iconOfOption(o: WeekTypeOption): string {
  return o.kind === "type" ? o.type : o.kind
}