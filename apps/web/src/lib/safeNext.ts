import { useEffect, useState } from 'react'

/**
 * `?next=` support for /login and /register: only same-origin relative paths
 * ("/whatsapp/conectar?t=…", "/invites/…") — never "//evil.com" or
 * "https://…", which would turn the login form into an open redirect.
 */
export function safeNext(raw: string | null | undefined): string | null {
  if (!raw) return null
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return null
  if (/[\r\n]/.test(raw)) return null
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
