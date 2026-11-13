/**
 * `mimoia.com/i/<code>`, two kinds of code:
 *   - a household's personal code (PRO-162; the «Hecho con Mimo ·
 *     mimoia.com/i/<code>» foot of what people forward, PRO-1016) → the
 *     landing with `?invita=<code>`, which remembers it for the sign-up (it
 *     counts as a referral, D-121) and follows the registration mode;
 *   - a campaign invitation (PRO-27) → /register with the code, which the
 *     form sends as `inviteCode`; the API checks it (expiry, uses) when the
 *     account is created.
 * Which one: `GET /waitlist/:code` answers for a household's or a list
 * person's code, 404 otherwise. If that call fails, the campaign path.
 */
import type { NextRequest } from "next/server"
import { normalizeReferralCode } from "@ona/shared"

const API = (process.env.INTERNAL_API_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000").replace(/\/+$/, "")

async function isPersonalCode(code: string, req: NextRequest): Promise<boolean> {
  if (!normalizeReferralCode(code)) return false
  try {
    // The visitor's address, so the API's per-IP limit counts them, not this server.
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    const r = await fetch(`${API}/waitlist/${code}`, {
      cache: "no-store",
      headers: ip ? { "x-forwarded-for": ip } : undefined,
      signal: AbortSignal.timeout(3000),
    })
    return r.ok
  } catch {
    return false
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const clean = code.toLowerCase().replace(/[^0-9a-z]/g, "").slice(0, 32)
  // Relative Location: behind Railway's proxy `req.url` is the internal host.
  const location = (await isPersonalCode(clean, req)) ? `/?invita=${clean}` : `/register?campana=${clean}`
  return new Response(null, { status: 302, headers: { Location: location } })
}
