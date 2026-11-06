/**
 * Newsletter link (PRO-191, specs/newsletter.md): mimoia.com/n/<issue>/<n> →
 * the destination saved when that issue was sent. The API adds one click
 * (never for HEAD, proofs `?prueba=1` or mail scanners, read from the
 * user-agent we pass on) and answers with the saved URL: the destination
 * never comes from this request, so this is not an open redirect. Unknown
 * issue or link → 404, no redirect. No IP, browser or recipient is stored.
 * The «Corre la voz» buttons (PRO-1019) add `?c=<code>&k=lista|hogar`,
 * passed on; the API builds WhatsApp or the copy page from that code. The
 * person's recipe and tip (PRO-1020) add `?r=<recipe id>` and `?t=<tip id>`.
 */
import type { NextRequest } from "next/server"

const API = (process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "")

async function resolve(req: NextRequest, issue: string, n: string, method: "GET" | "HEAD"): Promise<Response> {
  const q = new URLSearchParams()
  if (req.nextUrl.searchParams.get("prueba") === "1") q.set("prueba", "1")
  // «Corre la voz» (PRO-1019): the recipient's code and kind; the person's recipe
  // and tip (PRO-1020): their ids. The API checks them and builds the destination.
  for (const k of ["c", "k", "r", "t"]) {
    const v = req.nextUrl.searchParams.get(k)
    if (v) q.set(k, v.slice(0, 64))
  }
  const query = q.toString() ? `?${q.toString()}` : ""
  try {
    const r = await fetch(`${API}/newsletter/click/${encodeURIComponent(issue)}/${encodeURIComponent(n)}${query}`, {
      method: "GET",
      cache: "no-store",
      headers: {
        "user-agent": req.headers.get("user-agent") ?? "",
        // HEAD (scanners, previews) only resolves: the API never counts it.
        ...(method === "HEAD" ? { "x-newsletter-head": "1" } : {}),
      },
    })
    if (r.ok) {
      const { url } = (await r.json()) as { url?: string }
      if (url && /^https?:\/\//.test(url)) {
        return new Response(null, { status: 302, headers: { Location: url, "Cache-Control": "no-store" } })
      }
    }
  } catch {
    // fall through to the 404
  }
  return new Response("Este enlace no existe.", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } })
}

type Params = { params: Promise<{ issue: string; n: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { issue, n } = await params
  return resolve(req, issue, n, "GET")
}

export async function HEAD(req: NextRequest, { params }: Params) {
  const { issue, n } = await params
  return resolve(req, issue, n, "HEAD")
}
