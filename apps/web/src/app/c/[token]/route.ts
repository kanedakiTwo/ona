/**
 * Short link for shop orders (specs/shop-orders.md): /c/<token> → the
 * wa.me / mailto link with the order (or, with ?m=ok, the confirmation)
 * already written. ONA's WhatsApp replies carry these so the model never
 * has to copy a long URL-encoded text. No side effects: WhatsApp's link
 * preview fetches it too.
 */
import { NextResponse, type NextRequest } from "next/server"

const API = (process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "")

export async function GET(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const m = req.nextUrl.searchParams.get("m") === "ok" ? "?m=ok" : ""
  try {
    const r = await fetch(`${API}/shop-orders/link/${encodeURIComponent(token)}${m}`, { cache: "no-store" })
    if (r.ok) {
      const { url } = (await r.json()) as { url?: string }
      // Only WhatsApp / mail: never an open redirect to an arbitrary site.
      if (url && /^(https:\/\/wa\.me\/|mailto:)/.test(url)) {
        return NextResponse.redirect(url, 302)
      }
    }
  } catch {
    // fall through to the friendly page
  }
  // Relative Location: behind Railway's proxy `req.url` is the internal
  // http://0.0.0.0:3000, so an absolute URL built from it sends users nowhere.
  return new Response(null, { status: 302, headers: { Location: "/compra?enlace=caducado" } })
}
