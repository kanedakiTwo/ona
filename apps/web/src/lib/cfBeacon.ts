/**
 * Cloudflare Web Analytics (cookieless, aggregated visit counts — see
 * specs/privacy.md). The beacon is loaded on every page only when
 * `NEXT_PUBLIC_CF_BEACON_TOKEN` is set at build time; without it there is no
 * script at all.
 */
export const CF_BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js"

/** The `data-cf-beacon` attribute for a token, or null (no beacon) when unset or malformed. */
export function cfBeaconAttr(token: string | undefined | null): string | null {
  const t = (token ?? "").trim()
  // Cloudflare tokens are 32 hex chars; anything else would only break the page's JSON.
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(t)) return null
  return JSON.stringify({ token: t })
}
