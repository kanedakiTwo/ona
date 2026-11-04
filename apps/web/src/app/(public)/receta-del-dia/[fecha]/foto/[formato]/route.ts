/**
 * The photo of the recipe of a given day, cut for the networks (PRO-1099,
 * specs/recipe-of-the-day.md): `/receta-del-dia/<fecha>/foto/vertical`
 * (1080×1350) and `/foto/horizontal` (1200×630, the page's link preview).
 * The API cuts it (`GET /recipe-of-the-day/:date/photo/:format`); this only
 * serves it on the site's own domain. Only those two names and real days go
 * through: nothing here fetches an address the visitor chose.
 */
import { isIsoDay, RECIPE_OF_THE_DAY_PHOTO_SIZES } from "@ona/shared"

const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "")

export async function GET(_req: Request, { params }: { params: Promise<{ fecha: string; formato: string }> }) {
  const { fecha, formato } = await params
  if (!isIsoDay(fecha) || !(formato in RECIPE_OF_THE_DAY_PHOTO_SIZES)) return new Response("No encontrada", { status: 404 })
  try {
    const r = await fetch(`${API_URL}/recipe-of-the-day/${fecha}/photo/${formato}`, {
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    })
    if (!r.ok) return new Response("No encontrada", { status: 404 })
    return new Response(await r.arrayBuffer(), {
      headers: {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=3600",
        "Content-Disposition": `inline; filename="receta-del-dia-${fecha}-${formato}.jpg"`,
      },
    })
  } catch {
    return new Response("No disponible", { status: 502 })
  }
}
