/**
 * PRO-1198: Marketing deja su recomendación de la newsletter con la cabecera
 * `x-newsletter-token` (specs/newsletter.md → «Editor en Admin»).
 *
 *   - con el token bueno guarda la recomendación, no toca la plantilla y queda
 *     en la auditoría como `newsletter.recommendation` con actor «marketing»;
 *   - con uno malo o sin `NEWSLETTER_RECOMMENDATION_TOKEN`, 401;
 *   - el resto de `/admin/newsletter` sigue pidiendo el JWT de admin, aunque
 *     lleve el token.
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { env } from '../config/env.js'
import { createNewsletterRouter } from '../routes/newsletter.js'
import type { NewsletterRepo } from '../services/newsletter.js'
import { memoryDraftsRepo } from './fixtures/memoryNewsletterDrafts.js'

const ADMIN = '11111111-1111-4111-8111-1111111111ad'
const TOKEN = 'marketing-token-de-prueba-0123456789'
const NOW = new Date('2026-11-10T09:00:00Z')

const REC = {
  subject: '{nombre}, tu receta de esta semana',
  preheader: 'La he elegido para tu casa',
  content: {
    edition: 'N.º 5 · 13 de noviembre de 2026',
    preface: 'Hola, {nombre}:',
    headline: 'Una receta *para vosotros*',
    intro: 'Esta semana te mando {receta}. {porque}',
    star: {
      title: 'Lentejas estofadas',
      body: 'De cuchara, para el primer fin de semana de frío.',
      imageUrl: 'https://mimoia.com/images/recipes/lentejas.jpg',
      imageAlt: 'Un plato de lentejas',
      url: 'https://mimoia.com/recipes/lentejas',
    },
    cta: { label: 'Abrir Mimoia', url: 'https://mimoia.com/menu' },
    signoff: 'Un abrazo.',
    from: { name: 'Miguel', role: 'Fundador de Mimoia' },
  },
}
const MIGUEL = { ...REC, preheader: 'La plantilla de Miguel' }

const servers: Server[] = []
const savedToken = env.NEWSLETTER_RECOMMENDATION_TOKEN
afterEach(async () => {
  env.NEWSLETTER_RECOMMENDATION_TOKEN = savedToken
  await Promise.all(servers.splice(0).map((s) => new Promise((r) => s.close(r))))
})

/** The real guards (no JWT in these requests: `authMiddleware` answers 401 before any DB read). */
async function app() {
  const drafts = memoryDraftsRepo()
  await drafts.saveTemplate('2026-11-13', MIGUEL, ADMIN, NOW)
  const audit = vi.fn(async () => 'a1')
  const router = createNewsletterRouter({
    repo: {} as NewsletterRepo,
    drafts,
    audit: audit as any,
    auditAdmin: async () => ADMIN,
    now: () => NOW,
  })
  const server = await new Promise<Server>((resolve) => {
    const s = express().use(express.json()).use(router).listen(0, '127.0.0.1', () => resolve(s))
  })
  servers.push(server)
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/admin/newsletter`
  const call = (method: string, path: string, token?: string, body?: unknown) =>
    fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token !== undefined ? { 'x-newsletter-token': token } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
  return { drafts, audit, call }
}

describe('la recomendación de Marketing con x-newsletter-token (PRO-1198)', () => {
  it('con el token bueno guarda la recomendación, no toca la plantilla y lo deja en la auditoría', async () => {
    env.NEWSLETTER_RECOMMENDATION_TOKEN = TOKEN
    const { drafts, audit, call } = await app()
    const res = await call('PUT', '/drafts/2026-11-13/recommendation', TOKEN, REC)
    expect(res.status).toBe(200)
    const row = drafts.rows.get('2026-11-13')!
    expect(row.recommendation).toEqual(REC)
    expect(row.recommendedAt).toEqual(NOW)
    expect(row.template).toEqual(MIGUEL)
    expect(row.savedAt).toEqual(NOW)
    expect(audit).toHaveBeenCalledWith({
      adminId: ADMIN,
      action: 'newsletter.recommendation',
      targetType: 'newsletter_issue',
      payload: { issueId: '2026-11-13', actor: 'marketing' },
    })
  })

  it('con un token malo, 401 y no guarda nada', async () => {
    env.NEWSLETTER_RECOMMENDATION_TOKEN = TOKEN
    const { drafts, audit, call } = await app()
    for (const bad of ['otro-token', '', `${TOKEN}x`]) {
      const res = await call('PUT', '/drafts/2026-11-13/recommendation', bad, REC)
      expect(res.status).toBe(401)
      expect(await res.json()).toMatchObject({ code: 'NEWSLETTER_TOKEN_INVALID' })
    }
    expect(drafts.rows.get('2026-11-13')!.recommendation).toBeNull()
    expect(audit).not.toHaveBeenCalled()
  })

  it('sin la variable, 401 aunque el token coincida con el vacío', async () => {
    env.NEWSLETTER_RECOMMENDATION_TOKEN = ''
    const { drafts, call } = await app()
    expect((await call('PUT', '/drafts/2026-11-13/recommendation', '', REC)).status).toBe(401)
    expect((await call('PUT', '/drafts/2026-11-13/recommendation', TOKEN, REC)).status).toBe(401)
    expect(drafts.rows.get('2026-11-13')!.recommendation).toBeNull()
  })

  it('sin cabecera, la recomendación sigue pidiendo el JWT de admin', async () => {
    env.NEWSLETTER_RECOMMENDATION_TOKEN = TOKEN
    const { call } = await app()
    expect((await call('PUT', '/drafts/2026-11-13/recommendation', undefined, REC)).status).toBe(401)
  })

  it('el resto de /admin/newsletter no acepta el token: pide el JWT', async () => {
    env.NEWSLETTER_RECOMMENDATION_TOKEN = TOKEN
    const { drafts, audit, call } = await app()
    const other: Array<[string, string, unknown?]> = [
      ['GET', '/drafts'],
      ['GET', '/drafts/2026-11-13'],
      ['PUT', '/drafts/2026-11-13/template', REC],
      ['POST', '/drafts/2026-11-13/preview'],
      ['POST', '/drafts/2026-11-13/proof'],
      ['POST', '/drafts/2026-11-13/schedule'],
      ['DELETE', '/drafts/2026-11-13/schedule'],
      ['POST', '/send', { issueId: '2026-11-13', dryRun: true, ...REC }],
    ]
    for (const [method, path, body] of other) {
      const res = await call(method, path, TOKEN, body)
      expect(res.status, `${method} ${path}`).toBe(401)
    }
    expect(drafts.rows.get('2026-11-13')!.template).toEqual(MIGUEL)
    expect(audit).not.toHaveBeenCalled()
  })
})
