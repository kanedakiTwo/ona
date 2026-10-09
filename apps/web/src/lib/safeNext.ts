import { useEffect, useState } from 'react'

/**
 * `?next=` support for /login and /register: only same-origin relative paths
 * ("/whatsapp/conectar?t=…", "/invites/…") — never "//evil.com" or
 * "https://…", which would turn the login form into an open redirect.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null
  // Browsers strip tabs/newlines in URLs, so "/\t/evil.com" would become
  // "//evil.com" — reject every control character, not just \r\n.
  if (/[\x00-\x1f\x7f]/.test(raw)) return null
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null
  // Belt and braces: whatever the string, it must resolve to our own origin.
  try {
    const base = 'https://ona.invalid'
    if (new URL(raw, base).origin !== base) return null
  } catch {
    return null
  }
  return raw
}

/** Reads `next` from the current URL (client only). */
export function nextFromLocation(): string | null {
  if (typeof window === 'undefined') return null
  return safeNext(new URLSearchParams(window.location.search).get('next'))
}

/**
 * `?next=…` suffix to carry the destination across /login ↔ /register.
 * Resolved after mount (no useSearchParams → no Suspense boundary needed).
 */
export function useNextSuffix(): string {
  const [suffix, setSuffix] = useState('')
  useEffect(() => {
    const next = nextFromLocation()
    setSuffix(next ? `?next=${encodeURIComponent(next)}` : '')
  }, [])
  return suffix
}

/** Household invitation token when `next` is `/invites/<token>` (PRO-27: lets them through the closed beta). */
export function householdInviteTokenFromNext(next: string | null): string | undefined {
  const m = next?.match(/^\/invites\/([^/?#]+)/)
  return m ? decodeURIComponent(m[1]) : undefined
}

/** Campaign code from `/register?campana=<code>` (the `/i/<code>` links, PRO-27). */
export function campaignCodeFromLocation(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const ok = (v: string | null | undefined) => (v && /^[0-9a-z]{1,32}$/.test(v) ? v : undefined)
  const fromUrl = ok(new URLSearchParams(window.location.search).get('campana'))
  // Kept for the tab's session so a detour (/login and back) doesn't lose it.
  try {
    if (fromUrl) sessionStorage.setItem('ona.campana', fromUrl)
    return fromUrl ?? ok(sessionStorage.getItem('ona.campana'))
  } catch {
    return fromUrl
  }
}
