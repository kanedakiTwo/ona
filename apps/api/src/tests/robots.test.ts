/**
 * /robots.txt (apps/web/src/lib/robots.ts, PRO-1077): everything open but
 * the private or account zones, and the sitemap on the same base as
 * sitemap.xml. Also the site's default meta description (lib/site.ts): from
 * the landing, short and without health claims.
 */
import { describe, expect, it } from 'vitest'
import { PRIVATE_PATHS, robotsRules } from '../../../web/src/lib/robots'
import { SITE_DESCRIPTION, SITE_URL } from '../../../web/src/lib/site'

/** Google's matching: prefix, `*` = anything. */
function blocked(path: string): boolean {
  return PRIVATE_PATHS.some((rule) => new RegExp('^' + rule.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')).test(path))
}

describe('robots.txt', () => {
  it('points to the sitemap on the site base', () => {
    const r = robotsRules()
    expect(r.sitemap).toBe(`${SITE_URL}/sitemap.xml`)
    expect(r.sitemap).toBe('https://mimoia.com/sitemap.xml')
  })

  it('allows everything to every crawler but the private paths', () => {
    const rules = robotsRules().rules
    const rule = Array.isArray(rules) ? rules[0] : rules
    expect(rule.userAgent).toBe('*')
    expect(rule.allow).toBe('/')
    expect(rule.disallow).toEqual(PRIVATE_PATHS)
  })

  it('leaves the public pages and the recipes open', () => {
    for (const p of ['/', '/como-funciona', '/precios', '/recipes', '/recipes/3f1c0b8e-0000-4000-8000-000000000001', '/recipes/3f1c0b8e-0000-4000-8000-000000000001/cook', '/recipes/coleccion/otono', '/receta-del-dia', '/blog/menu-semanal', '/privacidad', '/sitemap.xml']) {
      expect(blocked(p), p).toBe(false)
    }
  })

  it('blocks the account, admin and personal-link zones', () => {
    for (const p of ['/admin', '/admin/usage', '/api/x', '/profile', '/profile/casa', '/menu', '/menu/history', '/shopping', '/compra', '/onboarding', '/login', '/register', '/invites/abc', '/c/tok', '/i/code', '/n/1/2', '/entrar/tok', '/lista/abc', '/newsletter/baja', '/recipes/new', '/recipes/3f1c0b8e-0000-4000-8000-000000000001/edit']) {
      expect(blocked(p), p).toBe(true)
    }
  })
})

describe('default meta description', () => {
  it('is short and makes no health claim', () => {
    expect(SITE_DESCRIPTION.length).toBeLessThanOrEqual(155)
    expect(SITE_DESCRIPTION).not.toMatch(/san[oa]s?\b|saludable|liger[oa]|nutricion|salud|cuerpo/i)
    expect(SITE_DESCRIPTION).toContain('Mimoia')
  })
})
