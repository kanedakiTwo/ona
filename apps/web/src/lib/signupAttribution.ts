/**
 * «Invitar a otro hogar» and campaign attribution (PRO-162, specs/auth.md):
 * `?invita=<code>`, `?ref=` and `utm_*` from the page someone landed on travel
 * to `/register`, which sends them with the sign-up. Kept in this browser
 * for 30 days so a visit today and a sign-up next week still count. Only the
 * inviter's code is kept, never anything personal.
 */
import { readWaitlistAttribution } from "@ona/shared"

const KEY = "ona.signupAttribution"
const MAX_AGE_MS = 30 * 86_400_000

export interface SignupAttribution {
  invitedBy?: string
  signupSource?: string
  utmSource?: string
  utmMedium?: string
  utmCampaign?: string
}

/** Pure: the attribution in these URL params, or null when there is none. */
export function attributionFromParams(params: URLSearchParams): SignupAttribution | null {
  const a = readWaitlistAttribution(params)
  const out: SignupAttribution = {}
  if (a.referredByCode) out.invitedBy = a.referredByCode
  if (params.get("ref") && a.source) out.signupSource = a.source
  if (a.utmSource) out.utmSource = a.utmSource
  if (a.utmMedium) out.utmMedium = a.utmMedium
  if (a.utmCampaign) out.utmCampaign = a.utmCampaign
  return Object.keys(out).length ? out : null
}

/** Remember the current URL's attribution (the landing calls this). */
export function rememberSignupAttribution(): void {
  if (typeof window === "undefined") return
  const found = attributionFromParams(new URLSearchParams(window.location.search))
  if (!found) return
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...found, savedAt: Date.now() }))
  } catch {
    // Private mode: the URL of /register itself still works.
  }
}

/** What `/register` sends: its own URL first, else what the landing remembered. */
export function signupAttributionForRegister(): SignupAttribution {
  if (typeof window === "undefined") return {}
  const fromUrl = attributionFromParams(new URLSearchParams(window.location.search))
  if (fromUrl) return fromUrl
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const { savedAt, ...rest } = JSON.parse(raw) as SignupAttribution & { savedAt?: number }
    if (!savedAt || Date.now() - savedAt > MAX_AGE_MS) return {}
    return rest
  } catch {
    return {}
  }
}
