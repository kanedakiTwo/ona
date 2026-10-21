/**
 * PRO-83 — installed app and push notifications, in aggregate
 * (specs/metrics.md "App instalada y avisos").
 */
import { describe, expect, it } from 'vitest'
import {
  buildInstalledOpens,
  buildPushEnabled,
  deviceCountsFor,
  deviceFromUserAgent,
  systemFromUserAgent,
  withScreenDevice,
  type HouseholdDeviceDay,
} from '../services/appInstalls.js'
import { PASSIVE_USAGE_EVENTS, USAGE_EVENTS, clientEventProps, sanitizeProps } from '../services/usageEvents.js'
import { buildHouseholdSystems } from '../services/usageReport.js'

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36'
const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const MAC_CHROME =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'

describe('deviceFromUserAgent', () => {
  it('deduces android / ios / desktop from three example browsers', () => {
    expect(deviceFromUserAgent(ANDROID_CHROME)).toBe('android')
    expect(deviceFromUserAgent(IPHONE_SAFARI)).toBe('ios')
    expect(deviceFromUserAgent(MAC_CHROME)).toBe('desktop')
  })
  it('falls back to desktop with no browser string', () => {
    expect(deviceFromUserAgent(undefined)).toBe('desktop')
    expect(deviceFromUserAgent('')).toBe('desktop')
  })
  it('only the device word reaches usage_events props', () => {
    expect(sanitizeProps({ device: deviceFromUserAgent(IPHONE_SAFARI) })).toEqual({ device: 'ios' })
    // The whole browser string would never pass the props filter anyway.
    expect(sanitizeProps({ device: IPHONE_SAFARI })).toBeNull()
  })
})

describe('households by system (PRO-307)', () => {
  it('systemFromUserAgent: android / ios / desktop, null with no browser string (never the string itself)', () => {
    expect(systemFromUserAgent(ANDROID_CHROME)).toBe('android')
    expect(systemFromUserAgent(IPHONE_SAFARI)).toBe('ios')
    expect(systemFromUserAgent(MAC_CHROME)).toBe('desktop')
    expect(systemFromUserAgent(undefined)).toBeNull()
    expect(systemFromUserAgent('  ')).toBeNull()
  })
  it('a screen view from the web carries only the device word; other events stay as they came', () => {
    const screen = clientEventProps('screen_viewed', { screen: 'menu' })!
    expect(withScreenDevice(screen, ANDROID_CHROME)).toEqual({ name: 'screen_viewed', props: { screen: 'menu', device: 'android' } })
    expect(withScreenDevice(screen, undefined)).toEqual({ name: 'screen_viewed', props: { screen: 'menu' } })
    const recipe = clientEventProps('recipe_viewed', { from: 'menu' })!
    expect(withScreenDevice(recipe, IPHONE_SAFARI)).toEqual(recipe)
    expect(JSON.stringify(withScreenDevice(screen, IPHONE_SAFARI))).not.toMatch(/Mozilla|iPhone OS/)
    expect(sanitizeProps(withScreenDevice(screen, IPHONE_SAFARI).props)).toEqual({ screen: 'menu', device: 'ios' })
  })
  it('active households by the last device seen; none → unknown; each household once', () => {
    const active = ['h1', 'h2', 'h3', 'h4', 'h5', 'h1']
    const last = [
      { householdId: 'h1', device: 'android' },
      { householdId: 'h2', device: 'ios' },
      { householdId: 'h3', device: 'desktop' },
      { householdId: 'h4', device: 'algo-raro' },
      // Not active in the window: not counted.
      { householdId: 'h9', device: 'android' },
    ]
    expect(buildHouseholdSystems(active, last)).toEqual({ android: 1, ios: 1, desktop: 1, unknown: 2, total: 5 })
    expect(buildHouseholdSystems([], last)).toEqual({ android: 0, ios: 0, desktop: 0, unknown: 0, total: 0 })
  })
})

describe('buildInstalledOpens', () => {
  const weeks = ['2026-10-05', '2026-10-12']

  it('a household that opens the installed app three times the same day counts once', () => {
    const opens: HouseholdDeviceDay[] = [
      { householdId: 'h1', day: '2026-10-14', device: 'android' },
      { householdId: 'h1', day: '2026-10-14', device: 'android' },
      { householdId: 'h1', day: '2026-10-14', device: 'android' },
    ]
    const w = deviceCountsFor(buildInstalledOpens(weeks, opens), '2026-10-12')
    expect(w).toEqual({ android: 1, ios: 0, desktop: 0, total: 1 })
  })

  it('counts per week and device, a household on two devices once in the total', () => {
    const opens: HouseholdDeviceDay[] = [
      { householdId: 'h1', day: '2026-10-06', device: 'android' },
      { householdId: 'h1', day: '2026-10-13', device: 'android' },
      { householdId: 'h1', day: '2026-10-14', device: 'ios' },
      { householdId: 'h2', day: '2026-10-18', device: 'ios' }, // Sunday: same ISO week
      { householdId: 'h3', day: '2026-10-19', device: 'desktop' }, // next week, outside the window
    ]
    const m = buildInstalledOpens(weeks, opens)
    expect(deviceCountsFor(m, '2026-10-05')).toEqual({ android: 1, ios: 0, desktop: 0, total: 1 })
    expect(deviceCountsFor(m, '2026-10-12')).toEqual({ android: 1, ios: 2, desktop: 0, total: 2 })
  })
})

describe('buildPushEnabled', () => {
  it('counts households with a live subscription created by the end of each week', () => {
    const subs: HouseholdDeviceDay[] = [
      { householdId: 'h1', day: '2026-10-01', device: 'android' },
      { householdId: 'h1', day: '2026-10-01', device: 'android' }, // second phone, same household
      { householdId: 'h2', day: '2026-10-15', device: 'ios' },
    ]
    const m = buildPushEnabled(['2026-10-05', '2026-10-12'], subs)
    expect(deviceCountsFor(m, '2026-10-05')).toEqual({ android: 1, ios: 0, desktop: 0, total: 1 })
    expect(deviceCountsFor(m, '2026-10-12')).toEqual({ android: 1, ios: 1, desktop: 0, total: 2 })
  })
})

describe('app_opened_installed usage event', () => {
  it('is in the catalogue and is passive (never makes a household active)', () => {
    expect(USAGE_EVENTS).toContain('app_opened_installed')
    expect(PASSIVE_USAGE_EVENTS.has('app_opened_installed')).toBe(true)
    expect(PASSIVE_USAGE_EVENTS.has('menu_generated')).toBe(false)
  })
})
