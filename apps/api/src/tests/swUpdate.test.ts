/**
 * The installed app on a desktop (2026-10-21): no reload button, open for
 * days, and no browser back button.
 *
 *   - lib/pwa/swUpdate.ts: a new service worker reloads an already-controlled
 *     page once (never on the first install, never in a loop) and coming back
 *     to the app checks for an update at most once a minute.
 *   - lib/navHistory.ts: «Afina tu menú» goes back to the app page it came
 *     from, with that section's name, or to «Menú».
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  SW_RELOAD_COOLDOWN_MS,
  SW_RELOAD_KEY,
  SW_UPDATE_CHECK_MS,
  readLastReload,
  shouldCheckForUpdate,
  shouldReloadOnControllerChange,
  shouldReloadOnNavigation,
} from '../../../web/src/lib/pwa/swUpdate'
import { backTarget, previousPathBefore, rememberPath, resetNavHistory } from '../../../web/src/lib/navHistory'

const now = 1_800_000_000_000

describe('the new version loads on the next page change, never under the person\'s typing', () => {
  it('only with a version waiting and a real move to another page', () => {
    expect(shouldReloadOnNavigation({ updatePending: true, reloading: false, fromPath: '/recipes/new', toPath: '/recipes' })).toBe(true)
    expect(shouldReloadOnNavigation({ updatePending: false, reloading: false, fromPath: '/menu', toPath: '/recipes' })).toBe(false)
    // The page the person is on (first render, or the same path again): wait.
    expect(shouldReloadOnNavigation({ updatePending: true, reloading: false, fromPath: null, toPath: '/onboarding' })).toBe(false)
    expect(shouldReloadOnNavigation({ updatePending: true, reloading: false, fromPath: '/onboarding', toPath: '/onboarding' })).toBe(false)
    expect(shouldReloadOnNavigation({ updatePending: true, reloading: true, fromPath: '/menu', toPath: '/recipes' })).toBe(false)
  })
})

describe('a new service worker reloads the page once', () => {
  it('reloads a page that already had a worker', () => {
    expect(shouldReloadOnControllerChange({ hadController: true, reloading: false, lastReloadAt: null, now })).toBe(true)
  })
  it('never on the first install (the page had no worker yet)', () => {
    expect(shouldReloadOnControllerChange({ hadController: false, reloading: false, lastReloadAt: null, now })).toBe(false)
  })
  it('never twice in the same page', () => {
    expect(shouldReloadOnControllerChange({ hadController: true, reloading: true, lastReloadAt: null, now })).toBe(false)
  })
  it('not again right after a reload for a worker (no loop), but yes later', () => {
    expect(shouldReloadOnControllerChange({ hadController: true, reloading: false, lastReloadAt: now - 1_000, now })).toBe(false)
    expect(shouldReloadOnControllerChange({ hadController: true, reloading: false, lastReloadAt: now - SW_RELOAD_COOLDOWN_MS, now })).toBe(true)
    // A clock that went backwards doesn't block forever.
    expect(shouldReloadOnControllerChange({ hadController: true, reloading: false, lastReloadAt: now + 60_000, now })).toBe(true)
  })
  it('reads the last reload from storage, tolerating junk and blocked storage', () => {
    expect(readLastReload({ getItem: (k: string) => (k === SW_RELOAD_KEY ? String(now) : null) })).toBe(now)
    expect(readLastReload({ getItem: () => 'nope' })).toBeNull()
    expect(readLastReload({ getItem: () => null })).toBeNull()
    expect(readLastReload({ getItem: () => { throw new Error('SecurityError') } })).toBeNull()
    expect(readLastReload(null)).toBeNull()
  })
})

describe('coming back to the app checks for an update', () => {
  it('only when visible, at most once a minute', () => {
    expect(shouldCheckForUpdate('hidden', now, null)).toBe(false)
    expect(shouldCheckForUpdate('visible', now, null)).toBe(true)
    expect(shouldCheckForUpdate('visible', now, now - 5_000)).toBe(false)
    expect(shouldCheckForUpdate('visible', now, now - SW_UPDATE_CHECK_MS)).toBe(true)
  })
})

describe('«‹ Perfil» without the browser back button', () => {
  beforeEach(() => resetNavHistory())

  it('goes back to the exact app page it came from, named by its section', () => {
    rememberPath('/menu')
    rememberPath('/profile')
    rememberPath('/afinar')
    expect(previousPathBefore('/afinar')).toBe('/profile')
    expect(backTarget(previousPathBefore('/afinar'))).toEqual({ href: '/profile', label: 'Perfil' })
    expect(backTarget('/profile/ficha')).toEqual({ href: '/profile/ficha', label: 'Perfil' })
    expect(backTarget('/menu')).toEqual({ href: '/menu', label: 'Menú' })
    expect(backTarget('/compra/tiendas')).toEqual({ href: '/compra/tiendas', label: 'Compra' })
  })
  it('works before the new page is remembered too (children render before the shell’s effect)', () => {
    rememberPath('/profile')
    expect(previousPathBefore('/afinar')).toBe('/profile')
  })
  it('the same page twice counts once', () => {
    rememberPath('/menu')
    rememberPath('/afinar')
    rememberPath('/afinar')
    expect(previousPathBefore('/afinar')).toBe('/menu')
  })
  it('a fresh load (nothing visited) or an unknown page goes to the menu', () => {
    expect(previousPathBefore('/afinar')).toBeNull()
    expect(backTarget(null)).toEqual({ href: '/menu', label: 'Menú' })
    expect(backTarget('/admin')).toEqual({ href: '/menu', label: 'Menú' })
  })
})
