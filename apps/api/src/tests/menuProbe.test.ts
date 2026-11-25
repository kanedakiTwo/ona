import { describe as group, expect, it } from 'vitest'
import { describe, isProductionUrl, nextWeekStart, runMenuProbe, verdict } from '../services/menuProbe.js'

// PRO-396: la sonda diaria del menú (specs/menu-probe.md).

const NOW = new Date('2026-11-24T14:39:00Z') // martes en Madrid

type Route = (body: any, headers: Record<string, string>) => { status: number; body?: unknown; delayMs?: number } | 'hang'

function fakeFetch(routes: Record<string, Route>, calls: string[] = []): typeof fetch {
  return (async (url: string, init: RequestInit) => {
    const path = new URL(url).pathname
    calls.push(path)
    const r = routes[path]?.(JSON.parse(String(init.body ?? 'null')), (init.headers ?? {}) as Record<string, string>)
    if (!r) return new Response('{}', { status: 404 })
    if (r === 'hang') {
      return new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
    }
    if (r.delayMs) await new Promise((res) => setTimeout(res, r.delayMs))
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status })
  }) as unknown as typeof fetch
}

const login: Route = () => ({ status: 200, body: { token: 'tok', user: { id: 'u1', email: 'sonda@mimoia.com' } } })
const menu = (status = 201, days = 7): Route => () => ({ status, body: { id: 'm1', days: Array.from({ length: days }, () => ({})) } })

group('verdict', () => {
  it('verde: 201 con días y por debajo del tope', () => {
    expect(verdict({ status: 201, seconds: 4.2, days: 7, maxSeconds: 30 })).toBeNull()
  })
  it('ROJO si pasa del tope', () => {
    expect(verdict({ status: 201, seconds: 31, days: 7, maxSeconds: 30 })).toBe('tardó 31 s (tope 30 s)')
  })
  it('ROJO si la API falla, no contesta o el menú viene vacío', () => {
    expect(verdict({ status: 500, seconds: 1, days: 0, maxSeconds: 30 })).toBe('POST /menu/generate respondió 500')
    expect(verdict({ status: null, seconds: null, days: 0, maxSeconds: 30 })).toBe('la API no contestó a tiempo')
    expect(verdict({ status: 201, seconds: 1, days: 0, maxSeconds: 30 })).toBe('el menú vino vacío')
  })
})

group('nextWeekStart', () => {
  it('el lunes de la semana que viene en Madrid', () => {
    expect(nextWeekStart(NOW)).toBe('2026-11-30')
    // Domingo 23:30 en Madrid (22:30 UTC): la semana que viene empieza al día siguiente.
    expect(nextWeekStart(new Date('2026-11-29T22:30:00Z'))).toBe('2026-11-30')
    // Lunes 00:30 en Madrid: ya es la semana del 30, la que viene es la del 7.
    expect(nextWeekStart(new Date('2026-11-29T23:30:00Z'))).toBe('2026-12-07')
  })
})

group('isProductionUrl', () => {
  it('reconoce producción', () => {
    expect(isProductionUrl('https://ona-api-production.up.railway.app')).toBe(true)
    expect(isProductionUrl('https://mimoia.com')).toBe(true)
    expect(isProductionUrl('https://ona-api-staging.up.railway.app')).toBe(false)
  })
})

group('runMenuProbe', () => {
  it('entra con la cuenta, genera la semana que viene y da verde', async () => {
    const bodies: any[] = []
    const r = await runMenuProbe({
      env: 'production',
      apiUrl: 'https://ona-api-production.up.railway.app/',
      username: 'sonda@mimoia.com',
      password: 'x',
      now: NOW,
      fetchImpl: fakeFetch({
        '/login': login,
        '/menu/generate': (body, headers) => {
          bodies.push({ body, auth: headers.Authorization })
          return { status: 201, body: { days: [{}, {}] } }
        },
      }),
    })
    expect(r).toMatchObject({ entorno: 'production', ok: true, semana: '2026-11-30', topeSegundos: 30, motivo: null, fecha: NOW.toISOString() })
    expect(r.segundos).toBeGreaterThanOrEqual(0)
    expect(bodies).toEqual([{ body: { userId: 'u1', weekStart: '2026-11-30' }, auth: 'Bearer tok' }])
    // Sin datos personales en el resultado.
    expect(JSON.stringify(r)).not.toMatch(/sonda@|u1|tok/)
    expect(describe(r)).toMatch(/^VERDE production: menú de 2026-11-30 en [\d.]+ s \(tope 30 s\)$/)
  })

  it('ROJO forzando un tope bajo', async () => {
    const r = await runMenuProbe({
      env: 'staging', apiUrl: 'https://ona-api-staging.up.railway.app', username: 'a', password: 'b', now: NOW, maxSeconds: 0.1,
      fetchImpl: fakeFetch({ '/login': login, '/menu/generate': () => ({ status: 201, body: { days: [{}] }, delayMs: 400 }) }),
    })
    expect(r.ok).toBe(false)
    expect(r.motivo).toMatch(/^tardó [\d.]+ s \(tope 0.1 s\)$/)
    expect(describe(r)).toMatch(/^ROJO staging: tardó [\d.]+ s \(tope 0.1 s\)$/)
  })

  it('ROJO si el menú falla o el login no entra', async () => {
    const fail = await runMenuProbe({
      env: 'staging', apiUrl: 'http://x', username: 'a', password: 'b', now: NOW,
      fetchImpl: fakeFetch({ '/login': login, '/menu/generate': menu(500) }),
    })
    expect(fail).toMatchObject({ ok: false, motivo: 'POST /menu/generate respondió 500' })
    const calls: string[] = []
    const denied = await runMenuProbe({
      env: 'staging', apiUrl: 'http://x', username: 'a', password: 'b', now: NOW,
      fetchImpl: fakeFetch({ '/login': () => ({ status: 401 }), '/menu/generate': menu() }, calls),
    })
    expect(denied).toMatchObject({ ok: false, segundos: null, motivo: 'el login respondió 401' })
    expect(calls).toEqual(['/login'])
  })

  it('sin cuenta, en staging da de alta una de usar y tirar con la invitación', async () => {
    const regs: any[] = []
    const r = await runMenuProbe({
      env: 'staging', apiUrl: 'http://x', inviteCode: 'inv', now: NOW,
      fetchImpl: fakeFetch({
        '/register': (body) => { regs.push(body); return { status: 201, body: { token: 't', user: { id: 'u2' } } } },
        '/menu/generate': menu(),
      }),
    })
    expect(r.ok).toBe(true)
    expect(regs).toHaveLength(1)
    expect(regs[0]).toMatchObject({ inviteCode: 'inv', ageConfirmed: true })
    expect(regs[0].email).toMatch(/^sonda\d+@example\.com$/)
  })

  it('en producción nunca da de alta: sin credenciales es ROJO sin llamar a nada', async () => {
    const calls: string[] = []
    for (const cfg of [
      { env: 'production' as const, apiUrl: 'https://ona-api-production.up.railway.app' },
      { env: 'staging' as const, apiUrl: 'https://ona-api-production.up.railway.app' },
    ]) {
      const r = await runMenuProbe({ ...cfg, inviteCode: 'inv', now: NOW, fetchImpl: fakeFetch({}, calls) })
      expect(r).toMatchObject({ ok: false, motivo: 'faltan las credenciales de la cuenta de la sonda' })
    }
    expect(calls).toEqual([])
  })
})
