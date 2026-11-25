/**
 * 23-nov (a friend of Miguel's on iPhone): «me pregunta si quiero hablar por
 * WhatsApp pero me dirige a descargar». On iOS a `wa.me` link only jumps to
 * the app from Safari itself; inside another app's browser (Instagram, Gmail,
 * LinkedIn…) or from Mimoia installed on the home screen it lands on
 * WhatsApp's web page, «Looks like you don't have WhatsApp installed» with a
 * big «Download». So on iPhone/iPad the button opens the app by its own
 * scheme (`whatsapp://send`), and only if the page is still in front after a
 * moment (no app) does it go to the `wa.me` page as before. Pure but for
 * `openWhatsApp`'s injected browser bits.
 */

/** iPhone / iPad, also iPadOS asking for the desktop site (a «Mac» with touch). */
export function isAppleMobile(userAgent: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return true
  return /Macintosh/i.test(userAgent) && maxTouchPoints > 1
}

/** `https://wa.me/<digits>[?text=…]` → `whatsapp://send?phone=<digits>[&text=…]`; anything else → null. */
export function whatsappAppUrl(href: string): string | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.hostname !== 'wa.me') return null
  const phone = url.pathname.replace(/^\/+|\/+$/g, '')
  const text = url.searchParams.get('text')
  const params: string[] = []
  if (phone) {
    if (!/^\d{6,15}$/.test(phone)) return null
    params.push(`phone=${phone}`)
  }
  if (text) params.push(`text=${encodeURIComponent(text)}`)
  if (params.length === 0) return null
  return `whatsapp://send?${params.join('&')}`
}

/** How long the page waits for WhatsApp to take over before showing the `wa.me` page. */
export const WHATSAPP_FALLBACK_MS = 1500

export interface OpenWhatsAppEnv {
  userAgent: string
  maxTouchPoints: number
  /** Navigates this page (`location.href = …`). */
  go: (url: string) => void
  /** The page is still in front (`document.visibilityState === 'visible'`). */
  visible: () => boolean
  later: (fn: () => void, ms: number) => void
}

/**
 * On iPhone/iPad, opens WhatsApp by its scheme and falls back to `href` if it
 * didn't open; returns true (the click is handled: prevent the link). Anywhere
 * else, or a link that isn't `wa.me`, returns false and the link works as is.
 */
export function openWhatsApp(href: string, env: OpenWhatsAppEnv): boolean {
  if (!isAppleMobile(env.userAgent, env.maxTouchPoints)) return false
  const app = whatsappAppUrl(href)
  if (!app) return false
  env.go(app)
  env.later(() => {
    if (env.visible()) env.go(href)
  }, WHATSAPP_FALLBACK_MS)
  return true
}
