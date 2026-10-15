/**
 * One-time waitlist invitation link (PRO-97): mimoia.com/entrar/<token> →
 * /register?entrada=<token>. The register page asks the API who the link is
 * for, fixes that email and sends the token with the account. Opening the
 * link never uses it up (mail scanners open links); creating the account does.
 */
import type { NextRequest } from "next/server"

export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const clean = token.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 128)
  // Relative Location: behind Railway's proxy `req.url` is the internal host.
  return new Response(null, { status: 302, headers: { Location: `/register?entrada=${clean}` } })
}
