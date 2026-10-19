/**
 * PRO-167 (D-057): the web follows `REGISTRATION_MODE` through
 * `GET /public/config`; with `open`, every public call to action goes to
 * `/register` keeping `?ref`, `?invita` and `utm_*`.
 */
import { describe, expect, it } from 'vitest'
import { OPEN_SIGNUP_CTA_LABEL, openRegistrationHref } from '@ona/shared'
import { buildPublicConfig } from '../routes/publicConfig.js'

describe('buildPublicConfig', () => {
  it('says the mode, invite unless it is exactly open', () => {
    expect(buildPublicConfig('open')).toEqual({ registration: 'open' })
    expect(buildPublicConfig('invite')).toEqual({ registration: 'invite' })
    expect(buildPublicConfig('whatever' as never)).toEqual({ registration: 'invite' })
  })
})

describe('openRegistrationHref', () => {
  it('uses the placement as ref when the page has none', () => {
    expect(openRegistrationHref('receta', '')).toBe('/register?ref=receta')
    expect(openRegistrationHref(null, '')).toBe('/register')
  })

  it('keeps the ref the visitor came with over the placement', () => {
    expect(openRegistrationHref('blog', '?ref=circulo-miguel')).toBe('/register?ref=circulo-miguel')
  })

  it('carries ?invita and the utm_* params, and drops anything else', () => {
    const href = openRegistrationHref(
      'como-funciona',
      '?invita=ABC234&utm_source=ig&utm_medium=story&utm_campaign=nov&email=x%40y.com',
    )
    const url = new URL(href, 'https://mimoia.com')
    expect(url.pathname).toBe('/register')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ref: 'como-funciona',
      invita: 'ABC234',
      utm_source: 'ig',
      utm_medium: 'story',
      utm_campaign: 'nov',
    })
  })

  it('the label is Miguel’s', () => {
    expect(OPEN_SIGNUP_CTA_LABEL).toBe('Crea tu cuenta gratis')
  })
})
