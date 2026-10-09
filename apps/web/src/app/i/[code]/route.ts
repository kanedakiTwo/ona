/**
 * Campaign invitation link (PRO-27): mimoia.com/i/<code> → /register with the
 * code, which the form sends as `inviteCode`. No lookup here: the API checks
 * the code (expiry, uses) when the account is created.
 */
import type { NextRequest } from "next/server"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params
  const clean = code.toLowerCase().replace(/[^0-9a-z]/g, "").slice(0, 32)
  // Relative Location: behind Railway's proxy `req.url` is the internal host.
  return new Response(null, { status: 302, headers: { Location: `/register?campana=${clean}` } })
}
