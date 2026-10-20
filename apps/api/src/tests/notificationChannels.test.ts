/**
 * PRO-234 (D-080): un aviso, un canal. Each alert kind goes by ONE channel
 * (WhatsApp when linked with «avisos» on; without it, only prep alerts go by
 * the phone notification) and the phone notification is only a fallback when
 * WhatsApp fails. specs/notifications.md «Channels».
 */
import { describe, expect, it, vi } from 'vitest'
import {
  channelsFor,
  deliverInOrder,
  fallbackKey,
  pushOutcome,
  pushPayloadForProactive,
} from '../services/notifications/channels.js'
import { PushNotConfiguredError } from '../services/pushNotifier.js'
import { PROACTIVE_KINDS } from '../services/whatsapp/proactive.js'

describe('channelsFor — one channel per kind', () => {
  it('with WhatsApp ready, every day-to-day kind goes by WhatsApp, push only behind it', () => {
    for (const k of PROACTIVE_KINDS) expect(channelsFor(k, 'ready')).toEqual(['whatsapp', 'push'])
  })
  it('without WhatsApp, only the prep alerts go by the phone notification; the rest does not go out', () => {
    expect(channelsFor('prep_alerts', 'none')).toEqual(['push'])
    for (const k of PROACTIVE_KINDS.filter((k) => k !== 'prep_alerts')) expect(channelsFor(k, 'none')).toEqual([])
  })
  it('a kind the person switched off goes out nowhere', () => {
    expect(channelsFor('prep_alerts', 'kind_off')).toEqual([])
  })
})

describe('deliverInOrder — fallback only if the first channel fails', () => {
  it('WhatsApp delivers → push is never called (no duplicate)', async () => {
    const push = vi.fn(async () => ({ status: 'ok' as const }))
    const r = await deliverInOrder(['whatsapp', 'push'], { whatsapp: async () => ({ status: 'ok' }), push })
    expect(r).toEqual({ status: 'sent', channel: 'whatsapp', errorMessage: null })
    expect(push).not.toHaveBeenCalled()
  })
  it('outside the 24 h window without template → the phone notification', async () => {
    const r = await deliverInOrder(['whatsapp', 'push'], {
      whatsapp: async () => ({ status: 'skipped', error: 'outside-24h-window' }),
      push: async () => ({ status: 'ok' }),
    })
    expect(r).toEqual({ status: 'sent', channel: 'push', errorMessage: null })
  })
  it('a Meta error (or a throw) → the phone notification', async () => {
    const r = await deliverInOrder(['whatsapp', 'push'], {
      whatsapp: async () => {
        throw new Error('graph 500')
      },
      push: async () => ({ status: 'ok' }),
    })
    expect(r.channel).toBe('push')
  })
  it('neither → stays as not sent, with both reasons', async () => {
    const r = await deliverInOrder(['whatsapp', 'push'], {
      whatsapp: async () => ({ status: 'skipped', error: 'outside-24h-window' }),
      push: async () => ({ status: 'skipped', error: 'no-push-subscription' }),
    })
    expect(r).toEqual({ status: 'failed', channel: null, errorMessage: 'whatsapp: outside-24h-window · push: no-push-subscription' })
  })
  it('no channel at all → failed «no-channel»', async () => {
    const r = await deliverInOrder([], { whatsapp: async () => ({ status: 'ok' }), push: async () => ({ status: 'ok' }) })
    expect(r).toEqual({ status: 'failed', channel: null, errorMessage: 'no-channel' })
  })
})

describe('pushOutcome — «if the phone notification is on»', () => {
  it('ok only when a device got it; no subscription is a skip; not configured is an error', async () => {
    expect(await pushOutcome('u', { title: 't', body: 'b' }, async () => ({ sent: 1, failed: 0, removedDeadSubscriptions: 0 }))).toEqual({ status: 'ok' })
    expect(await pushOutcome('u', { title: 't', body: 'b' }, async () => ({ sent: 0, failed: 0, removedDeadSubscriptions: 0 }))).toEqual({ status: 'skipped', error: 'no-push-subscription' })
    expect(await pushOutcome('u', { title: 't', body: 'b' }, async () => ({ sent: 0, failed: 2, removedDeadSubscriptions: 0 }))).toEqual({ status: 'error', error: 'push-failed' })
    expect(
      await pushOutcome('u', { title: 't', body: 'b' }, async () => {
        throw new PushNotConfiguredError()
      }),
    ).toEqual({ status: 'error', error: 'push-not-configured' })
  })
})

describe('pushPayloadForProactive — the WhatsApp message as a phone notification', () => {
  it('drops links and bold, opens the menu (or the list for the shopping reminder)', () => {
    const p = pushPayloadForProactive('daily_brief', 'Buenos días. Hoy toca:\n- Cena: *Lentejas*\n  https://mimoia.com/r/abc\n\n¿Quieres cambiar algo?\n\nVer menú: https://mimoia.com/menu')
    expect(p).toEqual({ title: 'Mimo', body: 'Buenos días. Hoy toca: - Cena: Lentejas ¿Quieres cambiar algo?', url: '/menu', tag: 'proactive:daily_brief' })
    expect(pushPayloadForProactive('shopping_reminder', '¿Toca compra?').url).toBe('/shopping')
    expect(pushPayloadForProactive('weekly_nudge', 'x'.repeat(400)).body.length).toBeLessThanOrEqual(180)
  })
  it('one fallback per person, kind and day', () => {
    expect(fallbackKey('daily_brief', 'u1', '2026-10-19')).toBe('fallback:daily_brief:u1:2026-10-19')
  })
})

describe('«Es hora de comer» is gone (PRO-234)', () => {
  it('no local meal-time notification left in the web app', async () => {
    const { existsSync, readFileSync, readdirSync, statSync } = await import('node:fs')
    const { join } = await import('node:path')
    const webSrc = join(__dirname, '../../../web/src')
    expect(existsSync(join(webSrc, 'lib/pwa/notifications.ts'))).toBe(false)
    const hits: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) walk(p)
        else if (/\.(ts|tsx)$/.test(name) && /Es hora de|scheduleMealReminders|new Notification\(/.test(readFileSync(p, 'utf8'))) hits.push(p)
      }
    }
    walk(webSrc)
    expect(hits).toEqual([])
  })
})
