/**
 * PRO-237 (D-080): the «Avisos» screen in Perfil and Mimo's get_alerts /
 * set_alerts, which call the same routes (D-051: web chat and WhatsApp).
 * specs/notifications.md «Avisos».
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../services/recipeImport.js', () => ({ createRecipeFromParts: vi.fn() }))

import { ALERT_KINDS, ALERT_OPT_IN_KINDS, alertKindOn, buildAlertRows, type AlertsOverview } from '@ona/shared'
import { appSkills, describeAlerts } from '../services/assistant/appSkills.js'
import { toolsFor } from '../services/assistant/skills.js'
import { mergeAlertPrefs } from '../services/notifications/alertPrefs.js'
import type { AppApi } from '../services/assistant/appApi.js'

const rows = (o: Partial<Parameters<typeof buildAlertRows>[0]> = {}) =>
  buildAlertRows({ userPrefs: {}, whatsapp: { linked: false, notify: false, prefs: null }, pushSubscribed: false, ...o })
const byKind = (r: ReturnType<typeof rows>) => Object.fromEntries(r.map((x) => [x.kind, x]))

describe('buildAlertRows — one row per kind, where it arrives', () => {
  it('lists every kind in order, with its Spanish title', () => {
    const r = rows()
    expect(r.map((x) => x.kind)).toEqual([...ALERT_KINDS])
    expect(byKind(r).prep_alerts.title).toBe('Sacar del congelador y poner en remojo')
  })
  it('WhatsApp with avisos: everything by WhatsApp, the phone notification behind it when on', () => {
    const r = byKind(rows({ whatsapp: { linked: true, notify: true, prefs: {} }, pushSubscribed: true }))
    for (const k of ALERT_KINDS.filter((k) => !ALERT_OPT_IN_KINDS.has(k))) expect(r[k]).toMatchObject({ on: true, channel: 'whatsapp', fallback: 'push', note: null })
  })
  it('PRO-215: the morning menu is off until the person asks for it (in either store)', () => {
    expect(byKind(rows({ whatsapp: { linked: true, notify: true, prefs: {} } })).daily_brief).toMatchObject({ on: false, channel: 'off' })
    expect(byKind(rows({ whatsapp: { linked: true, notify: true, prefs: { daily_brief: true } } })).daily_brief).toMatchObject({ on: true, channel: 'whatsapp' })
    expect(byKind(rows({ userPrefs: { daily_brief: true }, whatsapp: { linked: true, notify: true, prefs: {} } })).daily_brief.on).toBe(true)
    expect(alertKindOn('daily_brief', { daily_brief: true }, { daily_brief: false })).toBe(false)
    expect(alertKindOn('daily_brief', {}, null)).toBe(false)
  })
  it('the monthly freezer review has its own row (PRO-228)', () => {
    expect(byKind(rows({ whatsapp: { linked: true, notify: true, prefs: {} } })).freezer_review).toMatchObject({ on: true, channel: 'whatsapp', title: 'Repaso del congelador' })
  })
  it('no WhatsApp, phone notifications on: only the prep alerts arrive (by the phone)', () => {
    const r = byKind(rows({ pushSubscribed: true }))
    expect(r.prep_alerts).toMatchObject({ channel: 'push', fallback: null })
    expect(r.cooking_reminder).toMatchObject({ on: true, channel: 'off', note: 'Solo llega por WhatsApp.' })
  })
  it('nothing connected: the prep alert says how to get it', () => {
    expect(byKind(rows()).prep_alerts).toMatchObject({ channel: 'off', note: 'Conecta WhatsApp o activa las notificaciones del móvil.' })
  })
  it('WhatsApp linked with avisos off: says so', () => {
    expect(byKind(rows({ whatsapp: { linked: true, notify: false, prefs: {} } })).weekly_nudge.note).toBe('Activa los avisos por WhatsApp.')
  })
  it('a switch off in either store is off, on every channel', () => {
    expect(byKind(rows({ userPrefs: { daily_brief: false }, whatsapp: { linked: true, notify: true, prefs: {} } })).daily_brief).toMatchObject({ on: false, channel: 'off' })
    expect(byKind(rows({ whatsapp: { linked: true, notify: true, prefs: { shopping_reminder: false } } })).shopping_reminder.on).toBe(false)
    expect(alertKindOn('prep_alerts', {}, null)).toBe(true)
    expect(mergeAlertPrefs({ daily_brief: true, weekly_nudge: false }, { daily_brief: false })).toEqual({ daily_brief: false, weekly_nudge: false })
  })
})

function fakeApi(overview: AlertsOverview) {
  const calls: { method: string; path: string; body?: any }[] = []
  const api: AppApi = async (method, path, body) => {
    calls.push({ method, path, body })
    if (path === '/notifications/prefs') {
      if (method === 'PATCH') {
        const prefs = (body as any).prefs as Record<string, boolean>
        return { ...overview, kinds: overview.kinds.map((k) => (k.kind in prefs ? { ...k, on: prefs[k.kind] } : k)) } as any
      }
      return overview as any
    }
    return {} as any
  }
  return { api, calls }
}
const ctx = (api: AppApi, channel?: string) => ({ userId: 'u1', db: null, api, channel }) as any
const skill = (name: string) => appSkills.find((s) => s.name === name)!
const OVERVIEW = (wa: boolean): AlertsOverview => ({
  whatsapp: { linked: wa, notify: wa },
  push: { subscribed: true },
  kinds: buildAlertRows({ userPrefs: {}, whatsapp: { linked: wa, notify: wa, prefs: {} }, pushSubscribed: true }),
})

describe('Mimo: get_alerts / set_alerts (same routes as the screen)', () => {
  it('both are offered in the web chat and on WhatsApp (D-051), next to set_whatsapp_notifications', () => {
    for (const mode of [undefined, 'whatsapp']) {
      const names = toolsFor({ mode }).map((s) => s.name)
      expect(names).toContain('get_alerts')
      expect(names).toContain('set_alerts')
      expect(names).toContain('set_whatsapp_notifications')
    }
  })
  it('get_alerts reads GET /notifications/prefs and says where each one arrives', async () => {
    const f = fakeApi(OVERVIEW(false))
    const r = await skill('get_alerts').handler({}, ctx(f.api))
    expect(f.calls).toEqual([{ method: 'GET', path: '/notifications/prefs', body: undefined }])
    expect(r.summary).toContain('Sacar del congelador y poner en remojo (prep_alerts): encendido, como notificación del móvil')
    expect(r.summary).toContain('Domingo de planificar (weekly_nudge): encendido, no llega (Solo llega por WhatsApp.)')
    expect(r.summary).toContain('Menú del día (daily_brief): apagado')
    expect(r.summary).toContain('Perfil → Avisos')
  })
  it('«no me mandes el menú del día» → PATCH that one kind off', async () => {
    const f = fakeApi(OVERVIEW(true))
    const r = await skill('set_alerts').handler({ kind: 'daily_brief', enabled: false }, ctx(f.api, 'whatsapp'))
    expect(f.calls).toEqual([{ method: 'PATCH', path: '/notifications/prefs', body: { prefs: { daily_brief: false } } }])
    expect(r.summary).toBe('Hecho: Menú del día apagado. Se ve en Perfil → Avisos.')
  })
  it('kind=all with WhatsApp also flips «Avisos por WhatsApp»; without WhatsApp it does not', async () => {
    const wa = fakeApi(OVERVIEW(true))
    await skill('set_alerts').handler({ kind: 'all', enabled: false }, ctx(wa.api))
    expect(wa.calls.map((c) => `${c.method} ${c.path}`)).toEqual(['PATCH /notifications/prefs', 'PATCH /whatsapp/link'])
    expect(wa.calls[0].body.prefs).toEqual(Object.fromEntries(ALERT_KINDS.map((k) => [k, false])))
    const web = fakeApi(OVERVIEW(false))
    await skill('set_alerts').handler({ kind: 'all', enabled: false }, ctx(web.api))
    expect(web.calls.map((c) => c.path)).toEqual(['/notifications/prefs'])
  })
  it('kind=all on does not turn on the opt-in morning menu (PRO-215)', async () => {
    const f = fakeApi(OVERVIEW(true))
    await skill('set_alerts').handler({ kind: 'all', enabled: true }, ctx(f.api))
    expect(f.calls[0].body.prefs.daily_brief).toBeUndefined()
    expect(f.calls[0].body.prefs.weekly_nudge).toBe(true)
  })
  it('turning on one that cannot arrive says why; unknown kinds are refused', async () => {
    const f = fakeApi(OVERVIEW(false))
    const r = await skill('set_alerts').handler({ kind: 'weekly_nudge', enabled: true }, ctx(f.api))
    expect(r.summary).toContain('Ojo: ahora no te llegaria: Solo llega por WhatsApp.')
    expect((await skill('set_alerts').handler({ kind: 'spam', enabled: true }, ctx(f.api))).summary).toBe('Tipo de aviso desconocido.')
  })
  it('describeAlerts marks a switched-off kind', () => {
    const o = OVERVIEW(true)
    o.kinds[0] = { ...o.kinds[0], on: false, channel: 'off', fallback: null }
    expect(describeAlerts(o)).toContain('Menú del día (daily_brief): apagado')
  })
})
