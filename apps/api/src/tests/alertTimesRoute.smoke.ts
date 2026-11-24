/**
 * PRO-1301 against a running API + Postgres: the household's time for the
 * morning menu and the dinner question (`/notifications/prefs { times }`,
 * what Perfil → Avisos and Mimo's set_alert_time use). Saved for the whole
 * household: whoever joins sees the same. Skips when the API isn't reachable.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { reachable } from './smokeEnv.js'

const API_URL = process.env.API_URL ?? 'http://localhost:8000'

interface Session { token: string; userId: string }

async function register(prefix: string): Promise<Session> {
  const username = `${prefix}_${Date.now()}${Math.random().toString(36).slice(2, 6)}`
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@test.local`, password: 'smokepass123', ageConfirmed: true }),
  })
  const body = await r.json()
  return { token: body.token, userId: body.user.id }
}

function call(s: Session) {
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${API_URL}${path}`, {
      method,
      headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const text = await r.text()
    return { status: r.status, json: text ? JSON.parse(text) : null }
  }
}

describe.skipIf(!reachable)('alert times of a household (smoke)', () => {
  let owner: Session
  beforeAll(async () => {
    owner = await register('horas')
  })

  it('a new household has today\'s times, not chosen', async () => {
    const r = await call(owner)('GET', '/notifications/prefs')
    expect(r.status).toBe(200)
    expect(r.json.times).toEqual({ daily_brief: { time: '09:00', custom: false }, dinner_checkin: { time: '22:00', custom: false } })
  })

  it('PATCH saves them; out of range is a 400 with the reason and saves nothing', async () => {
    const api = call(owner)
    const ok = await api('PATCH', '/notifications/prefs', { times: { daily_brief: '8:30', dinner_checkin: '21:15' } })
    expect(ok.status).toBe(200)
    expect(ok.json.times).toEqual({ daily_brief: { time: '08:30', custom: true }, dinner_checkin: { time: '21:15', custom: true } })
    const bad = await api('PATCH', '/notifications/prefs', { times: { dinner_checkin: '23:30' } })
    expect(bad.status).toBe(400)
    expect(bad.json.error).toMatch(/entre las 19:00 y las 22:00/)
    expect((await api('GET', '/notifications/prefs')).json.times.dinner_checkin).toEqual({ time: '21:15', custom: true })
    // The switches still work alone; an empty body doesn't.
    expect((await api('PATCH', '/notifications/prefs', { prefs: { weekly_nudge: false } })).status).toBe(200)
    expect((await api('PATCH', '/notifications/prefs', {})).status).toBe(400)
  })

  it('it is the household\'s: someone who joins sees the same time', async () => {
    const guest = await register('horasinv')
    const inv = await call(owner)('POST', '/households/me/invites', { role: 'member' })
    expect(inv.status).toBe(201)
    expect((await call(guest)('POST', `/invites/${inv.json.token}/accept`)).status).toBe(200)
    expect((await call(guest)('GET', '/notifications/prefs')).json.times.daily_brief).toEqual({ time: '08:30', custom: true })
  })

  it('null goes back to the default', async () => {
    const r = await call(owner)('PATCH', '/notifications/prefs', { times: { daily_brief: null } })
    expect(r.json.times.daily_brief).toEqual({ time: '09:00', custom: false })
  })
})
