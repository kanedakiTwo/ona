/**
 * PRO-1041 · the link Mimo sends when someone tells it an allergy it can't
 * save (no consent, or over WhatsApp): `/profile/casa/alergias?next=/menu#marcar=sin%20gluten,marisco`
 * (`healthConsentLink` in apps/api/src/services/healthConsent.ts). The
 * allergies ride after `#`, so the browser never sends them to a server;
 * «Tus alergias y tu dieta» opens with them marked and the consent box
 * unticked.
 *
 * Signed out, the page goes to `/login?next=…` first: the fragment would be
 * lost (and must not travel in `next`), so it waits in this tab's
 * sessionStorage until the page reads it.
 */

const KEY = "ona.alergias.marcar"

/** Pure: `#marcar=a,b` → ["a", "b"] (lower case, deduped, at most 8 of up to 40 characters). */
export function markedFromHash(hash: string | null | undefined): string[] {
  const m = (hash ?? "").match(/^#?marcar=([^&]*)/)
  if (!m) return []
  return cleanList(
    m[1].split(",").map((part) => {
      try {
        return decodeURIComponent(part)
      } catch {
        return ""
      }
    }),
  )
}

function cleanList(list: readonly unknown[]): string[] {
  const out: string[] = []
  for (const value of list) {
    const r = typeof value === "string" ? value.trim().toLowerCase() : ""
    if (r && r.length <= 40 && !out.includes(r)) out.push(r)
  }
  return out.slice(0, 8)
}

/** Before the login redirect: keep what the link marked for after signing in. */
export function stashMarkedFromLocation(): void {
  if (typeof window === "undefined") return
  const marked = markedFromHash(window.location.hash)
  if (marked.length === 0) return
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(marked))
  } catch {
    // Private mode: the page opens without them marked.
  }
}

/** What the link marked: the fragment, or what waited through the login. */
export function readMarkedRestrictions(): string[] {
  if (typeof window === "undefined") return []
  const fromHash = markedFromHash(window.location.hash)
  if (fromHash.length > 0) return fromHash
  try {
    const raw = window.sessionStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : null
    return Array.isArray(list) ? cleanList(list) : []
  } catch {
    return []
  }
}

/** Once answered (saved, «No tengo ninguna»), nothing waits any more. */
export function clearMarkedRestrictions(): void {
  if (typeof window === "undefined") return
  try {
    window.sessionStorage.removeItem(KEY)
  } catch {
    // Nothing stored.
  }
}
