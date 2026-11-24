/**
 * 23-nov: on iPhone a `wa.me` link opened outside Safari (another app's
 * browser, Mimoia on the home screen) lands on WhatsApp's «Download» page.
 * The WhatsApp buttons open the app by its scheme there, and fall back to
 * `wa.me` only if it didn't open (apps/web/src/lib/whatsappOpen.ts).
 */
import { describe, expect, it } from 'vitest'
import { isAppleMobile, openWhatsApp, whatsappAppUrl, WHATSAPP_FALLBACK_MS } from '../../../web/src/lib/whatsappOpen'

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0'
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36'
const LINK = 'https://wa.me/34626685511?text=Vincular%20Mimoia%3A%20123456'

function env(userAgent: string, maxTouchPoints = 5, stillVisible = true) {
  const went: string[] = []
  let pending: (() => void) | null = null
  let wait = 0
  return {
    went,
    wait: () => wait,
    fire: () => pending?.(),
    env: {
      userAgent,
      maxTouchPoints,
      go: (u: string) => went.push(u),
      visible: () => stillVisible,
      later: (fn: () => void, ms: number) => {
        pending = fn
        wait = ms
      },
    },
  }
}

describe('whatsappAppUrl', () => {
  it('the chat link and the link-code link become the app scheme, text re-encoded', () => {
    expect(whatsappAppUrl('https://wa.me/34626685511')).toBe('whatsapp://send?phone=34626685511')
    expect(whatsappAppUrl(LINK)).toBe('whatsapp://send?phone=34626685511&text=Vincular%20Mimoia%3A%20123456')
    expect(whatsappAppUrl('https://wa.me/?text=hola%20%26%20adi%C3%B3s')).toBe('whatsapp://send?text=hola%20%26%20adi%C3%B3s')
  })
  it('anything that is not wa.me stays a plain link', () => {
    expect(whatsappAppUrl('https://mimoia.com/menu')).toBeNull()
    expect(whatsappAppUrl('http://wa.me/34626685511')).toBeNull()
    expect(whatsappAppUrl('https://wa.me/abc')).toBeNull()
    expect(whatsappAppUrl('https://wa.me/')).toBeNull()
    expect(whatsappAppUrl('no es un enlace')).toBeNull()
  })
})

describe('isAppleMobile', () => {
  it('iPhone (also in Instagram\'s browser) and an iPad asking for the desktop site; not a Mac nor Android', () => {
    expect(isAppleMobile(IPHONE)).toBe(true)
    expect(isAppleMobile(IPAD_DESKTOP, 5)).toBe(true)
    expect(isAppleMobile(IPAD_DESKTOP, 0)).toBe(false)
    expect(isAppleMobile(ANDROID, 5)).toBe(false)
  })
})

describe('openWhatsApp', () => {
  it('iPhone: opens the app, and wa.me only if the page is still in front after the wait', () => {
    const t = env(IPHONE)
    expect(openWhatsApp(LINK, t.env)).toBe(true)
    expect(t.went).toEqual(['whatsapp://send?phone=34626685511&text=Vincular%20Mimoia%3A%20123456'])
    expect(t.wait()).toBe(WHATSAPP_FALLBACK_MS)
    t.fire()
    expect(t.went[1]).toBe(LINK)
  })
  it('iPhone with WhatsApp: the page went to the background, so no «Download» page after', () => {
    const t = env(IPHONE, 5, false)
    openWhatsApp(LINK, t.env)
    t.fire()
    expect(t.went).toHaveLength(1)
  })
  it('Android and desktop: not handled, the link works as always', () => {
    const t = env(ANDROID)
    expect(openWhatsApp(LINK, t.env)).toBe(false)
    expect(t.went).toEqual([])
  })
})
