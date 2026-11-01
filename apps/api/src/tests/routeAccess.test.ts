/**
 * One access rule for the web app (specs/auth.md → "Public vs protected
 * routes"): every page needs an account unless lib/routeAccess.ts lists it as
 * open; RootShell sends a signed-out visitor on any other page to
 * `/login?next=<path+query>`. These cases pin the lists, so a new page is
 * protected by default and the public ones stay public.
 */
import { describe, expect, it } from 'vitest'
import { isBareRoute, loginHrefFor, needsAccount, signedOutChrome } from '../../../web/src/lib/routeAccess'
import { safeNext } from '../../../web/src/lib/safeNext'

const OPEN = [
  '/',
  '/como-funciona',
  '/precios',
  '/blog',
  '/blog/un-articulo',
  '/privacidad',
  '/terminos',
  '/aviso-legal',
  '/login',
  '/register',
  '/reset',
  '/recuperar',
  '/offline',
  '/lista/abc123',
  '/lista/baja',
  '/newsletter/baja',
  '/invites/tok',
  '/entrar/tok',
  '/i/campana',
  '/c/tok',
  '/recipes',
  '/recipes/',
  '/recipes/3f1c0b8e-0000-4000-8000-000000000001',
  '/recipes/abc/cook',
  '/whatsapp/conectar',
]

const PROTECTED = [
  '/menu',
  '/menu/history',
  '/shopping',
  '/compra',
  '/compra/tiendas',
  '/profile',
  '/profile/casa',
  '/profile/pantry',
  '/advisor',
  '/recipes/new',
  '/recipes/abc/edit',
  '/cookbooks',
  '/cookbooks/abc',
  '/admin',
  '/admin/usuarios',
  '/curator',
  '/debug-advisor',
  '/onboarding',
  '/onboarding/voz',
  '/una-pagina-nueva',
]

describe('needsAccount', () => {
  it.each(OPEN)('%s opens without an account', (p) => {
    expect(needsAccount(p)).toBe(false)
  })
  it.each(PROTECTED)('%s needs an account', (p) => {
    expect(needsAccount(p)).toBe(true)
  })
})

describe('signedOutChrome', () => {
  it('the catalogue, the recipe page and WhatsApp linking get the public chrome signed out', () => {
    expect(signedOutChrome('/recipes')).toBe('page')
    expect(signedOutChrome('/whatsapp/conectar')).toBe('page')
    expect(signedOutChrome('/recipes/abc')).toBe('recipe')
    expect(signedOutChrome('/recipes/abc/cook')).toBe('fullscreen')
  })
  it('a catalogue collection (PRO-374) is a public page, not a recipe', () => {
    expect(signedOutChrome('/recipes/coleccion/otono')).toBe('page')
    expect(signedOutChrome('/recipes/coleccion/cook')).toBe('page')
    expect(needsAccount('/recipes/coleccion/otono')).toBe(false)
  })
  it('bare and private pages have no session-dependent chrome', () => {
    for (const p of ['/', '/login', '/onboarding', '/menu', '/recipes/new', '/recipes/abc/edit', '/recipes-ona']) {
      expect(signedOutChrome(p)).toBeNull()
    }
  })
})

describe('isBareRoute', () => {
  it('marketing, auth and onboarding pages are bare for everyone', () => {
    for (const p of ['/', '/como-funciona', '/login', '/register', '/onboarding', '/invites/x', '/lista/x', '/blog/x']) {
      expect(isBareRoute(p)).toBe(true)
    }
  })
  it('the catalogue is not bare: signed in it keeps the app shell', () => {
    expect(isBareRoute('/recipes')).toBe(false)
    expect(isBareRoute('/whatsapp/conectar')).toBe(false)
    expect(isBareRoute('/menu')).toBe(false)
  })
})

describe('loginHrefFor', () => {
  it('carries the path and the query, and login accepts it back as next', () => {
    const href = loginHrefFor('/compra?enlace=caducado')
    expect(href).toBe('/login?next=%2Fcompra%3Fenlace%3Dcaducado')
    const next = new URL(href, 'https://mimoia.com').searchParams.get('next')
    expect(safeNext(next)).toBe('/compra?enlace=caducado')
  })
})
