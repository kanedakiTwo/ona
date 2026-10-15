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
  type HouseholdDeviceDay,
} from '../services/appInstalls.js'
import { PASSIVE_USAGE_EVENTS, USAGE_EVENTS, sanitizeProps } from '../services/usageEvents.js'

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
