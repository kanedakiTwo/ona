import type { Metadata } from "next"
import { BRAND_NAME, RECIPE_OF_THE_DAY_PATH, type RecipeOfTheDayView } from "@ona/shared"
import { absoluteImageUrl } from "./recipeMetadata"
import { SITE_URL } from "./site"

/**
 * «La receta del día» on the web (PRO-1099, specs/recipe-of-the-day.md):
 * the server fetch of `GET /recipe-of-the-day[/:date]` (no token: it is
 * public) and the page's link preview. Fails soft: a slow or broken API
 * shows «todavía no hay» instead of an error page.
 */

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "")

export async function fetchRecipeOfTheDay(date?: string): Promise<RecipeOfTheDayView | null> {
  try {
    const res = await fetch(`${API_URL}/recipe-of-the-day${date ? `/${encodeURIComponent(date)}` : ""}`, {
      signal: AbortSignal.timeout(2500),
      // «Today» changes at Madrid's midnight; the page and its metadata share this one call per render.
      cache: "no-store",
    })
    if (!res.ok) return null
    const data = (await res.json()) as RecipeOfTheDayView
    return data?.recipeId && data?.title ? data : null
  } catch {
    return null
  }
}

const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"]

/** «Miércoles, 4 de noviembre» */
export function formatDayEs(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  const day = DAYS[d.getUTCDay()]
  return `${day.charAt(0).toUpperCase()}${day.slice(1)}, ${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`
}

/** The photo cut for link previews (1200×630) on this site, relative to `metadataBase`. */
export function horizontalPhotoPath(date: string): string {
  return `${RECIPE_OF_THE_DAY_PATH}/${date}/foto/horizontal`
}

/** Pure: the link preview of `/receta-del-dia` (or of a given day). */
export function recipeOfTheDayMetadata(view: RecipeOfTheDayView | null, path: string = RECIPE_OF_THE_DAY_PATH): Metadata {
  const base = { metadataBase: new URL(SITE_URL), alternates: { canonical: path } }
  if (!view) {
    return {
      ...base,
      title: `La receta del día · ${BRAND_NAME}`,
      description: `Cada día, una receta del catálogo de ${BRAND_NAME}.`,
    }
  }
  const title = `${view.title} · La receta del día · ${BRAND_NAME}`
  const image = view.photos ? horizontalPhotoPath(view.date) : absoluteImageUrl(view.imageUrl)
  const images = image ? [{ url: image, width: view.photos ? 1200 : undefined, height: view.photos ? 630 : undefined, alt: view.title }] : undefined
  return {
    ...base,
    title,
    description: view.text,
    openGraph: {
      type: "article",
      url: path,
      siteName: BRAND_NAME,
      locale: "es_ES",
      title: view.title,
      description: view.text,
      ...(images ? { images } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: view.title,
      description: view.text,
      ...(image ? { images: [image] } : {}),
    },
  }
}
