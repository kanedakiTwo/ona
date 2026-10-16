/**
 * Newsletter «El menú de los viernes» (PRO-94, specs/newsletter.md):
 * recipient selection, idempotency per issue, the newsletter-only opt-out,
 * the visual template and the admin route. Resend is stubbed; the DB repo's
 * SQL is covered by newsletter.smoke.ts.
 */
import express from 'express'
import type { RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { createNewsletterRouter } from '../routes/newsletter.js'
import {
  buildNewsletterMessage,
  newsletterSendSchema,
  newsletterTokenForUser,
  newsletterTokenForWaitlist,
  parseNewsletterToken,
  recipientHash,
  renderNewsletterEmail,
  selectNewsletterRecipients,
  sendNewsletter,
  type NewsletterCandidate,
  type NewsletterDeps,
  type NewsletterRepo,
  type NewsletterSendInput,
} from '../services/newsletter.js'
import type { EmailMessage, EmailResult } from '../services/email.js'

const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const TOKEN_C = 'cccccccccccccccccccccccccccccccc'
const TOKEN_D = 'dddddddddddddddddddddddddddddddd'

type CandInput = Partial<NewsletterCandidate> & { unsubscribeToken?: string }

/** A waitlist candidate; `unsubscribeToken` is the entry's full opt-out token. */
function cand(email: string | null, extra: CandInput = {}): NewsletterCandidate {
  const { unsubscribeToken = TOKEN_A, ...rest } = extra
  return {
    source: 'waitlist',
    email,
    status: 'waiting',
    newsletterOptIn: true,
    token: newsletterTokenForWaitlist(unsubscribeToken),
    leaveToken: unsubscribeToken,
    ...rest,
  }
}

const USER_ID = '22222222-2222-4222-8222-222222222222'

function userCand(email: string, extra: Partial<NewsletterCandidate> = {}): NewsletterCandidate {
  return { source: 'user', email, status: 'active', newsletterOptIn: true, token: newsletterTokenForUser(USER_ID), ...extra }
}

const ISSUE: NewsletterSendInput = newsletterSendSchema.parse({
  issueId: '2026-10-16',
  subject: 'El menú de los viernes · nº 1',
  preheader: 'Una receta, una novedad y un truco',
  content: {
    intro: 'Hola, soy Mimo.',
    star: {
      title: 'Lentejas estofadas',
      body: 'De cuchara, para el primer fin de semana de frío.',
      imageUrl: 'https://mimoia.com/images/recipes/lentejas.jpg',
      imageAlt: 'Un plato de lentejas estofadas con zanahoria',
      url: 'https://mimoia.com/recipes/lentejas',
    },
    news: { title: 'La lista por días', body: 'Ahora puedes ver solo lo de hoy.', imageUrl: 'https://mimoia.com/n.jpg' },
    tip: { title: '¿Qué ceno con lo que tengo?', body: 'Escríbeselo a Mimo.' },
    cta: { label: 'Abrir Mimoia', url: 'https://mimoia.com/menu' },
    note: 'Las fotos de las recetas están hechas con IA.',
  },
})

describe('selectNewsletterRecipients', () => {
  it('keeps only opted-in entries still on the list with an email, once per email, minus the already sent', () => {
    const sent = new Set([recipientHash('ya@example.com')])
    const r = selectNewsletterRecipients(
      [
        cand('ana@example.com'),
        cand('sin-casilla@example.com', { newsletterOptIn: false }),
        cand('baja@example.com', { status: 'unsubscribed' }),
        cand(null),
        cand('ya@example.com'),
        cand(' ANA@example.com ', { unsubscribeToken: TOKEN_B }),
        cand('invitada@example.com', { status: 'invited', unsubscribeToken: TOKEN_C }),
        cand('dentro@example.com', { status: 'joined', unsubscribeToken: TOKEN_D }),
      ],
      sent,
    )
    expect(r.map((x) => x.email)).toEqual(['ana@example.com', 'invitada@example.com', 'dentro@example.com'])
    expect(r[0]).toMatchObject({ token: `w.${TOKEN_A}`, leaveToken: TOKEN_A, hash: recipientHash('ana@example.com') })
  })
  it('adds users who ticked the box (PRO-95), skips suspended ones, and one email per address with the account first', () => {
    const r = selectNewsletterRecipients(
      [
        userCand('Ana@Example.com'),
        userCand('suspendida@example.com', { status: 'suspended' }),
        cand('ana@example.com'),
        cand('bea@example.com', { unsubscribeToken: TOKEN_B }),
      ],
      new Set(),
    )
    expect(r.map((x) => [x.source, x.email])).toEqual([
      ['user', 'ana@example.com'],
      ['waitlist', 'bea@example.com'],
    ])
    expect(r[0].leaveToken).toBeUndefined()
  })
})

describe('newsletter tokens', () => {
  it('a user token only parses with its signature', () => {
    const t = newsletterTokenForUser(USER_ID)
    expect(parseNewsletterToken(t)).toEqual({ kind: 'user', userId: USER_ID })
    expect(parseNewsletterToken(t.slice(0, -1) + (t.endsWith('A') ? 'B' : 'A'))).toBeNull()
    expect(parseNewsletterToken(`u.33333333-3333-4333-8333-333333333333.${t.split('.')[2]}`)).toBeNull()
    expect(parseNewsletterToken(`w.${TOKEN_A}`)).toEqual({ kind: 'waitlist', token: TOKEN_A })
    expect(parseNewsletterToken(TOKEN_A)).toBeNull()
  })
})

/** In-memory repo with the same semantics as the SQL (unique issue + hash; opt-out by email). */
function memoryRepo(candidates: NewsletterCandidate[], admins: string[] = []) {
  const rows = new Map<string, { status: 'pending' | 'sent'; providerId: string | null }>()
  const key = (issue: string, h: string) => `${issue}|${h}`
  const entries = candidates.map((c) => ({ ...c }))
  const offByEmail = (email: string) => {
    let n = 0
    for (const e of entries) {
      if (e.email?.toLowerCase() === email.toLowerCase() && e.newsletterOptIn) {
        e.newsletterOptIn = false
        n++
      }
    }
    return n
  }
  const repo: NewsletterRepo = {
    async candidates() {
      return entries.filter((c) => c.newsletterOptIn).map((c) => ({ ...c }))
    },
    async claimedHashes(issue) {
      return new Set([...rows.keys()].filter((k) => k.startsWith(`${issue}|`)).map((k) => k.split('|')[1]))
    },
    async claim(issue, rs) {
      const got = new Set<string>()
      for (const r of rs) {
        if (rows.has(key(issue, r.hash))) continue
        rows.set(key(issue, r.hash), { status: 'pending', providerId: null })
        got.add(r.hash)
      }
      return got
    },
    async markSent(issue, sent) {
      for (const s of sent) rows.set(key(issue, s.hash), { status: 'sent', providerId: s.providerId })
    },
    async release(issue, hashes) {
      for (const h of hashes) if (rows.get(key(issue, h))?.status === 'pending') rows.delete(key(issue, h))
    },
    async isAdminEmail(email) {
      return admins.includes(email)
    },
    async unsubscribe(token) {
      if (!parseNewsletterToken(token)) return 'not_found'
      const e = entries.find((x) => x.token === token)
      if (!e) return 'not_found'
      if (e.status === 'unsubscribed' || !e.email) return 'already'
      return offByEmail(e.email) > 0 ? 'ok' : 'already'
    },
    async getUserOptIn() {
      const u = entries.find((x) => x.source === 'user')
      return u ? u.newsletterOptIn : null
    },
    async setUserOptIn(_id, optIn) {
      const u = entries.find((x) => x.source === 'user')
      if (!u) return null
      if (optIn) u.newsletterOptIn = true
      else offByEmail(u.email!)
      return optIn
    },
  }
  return { repo, rows, entries }
}

function deps(repo: NewsletterRepo, sendBatch: (m: EmailMessage[]) => Promise<EmailResult[]>): NewsletterDeps {
  return {
    repo,
    sendBatch,
    sendOne: vi.fn(async () => ({ status: 'sent', id: 'one' }) as EmailResult),
    publicUrl: 'https://mimoia.com',
    apiUrl: 'https://api.mimoia.com',
  }
}

const okBatch = () => vi.fn(async (m: EmailMessage[]) => m.map((_, k) => ({ status: 'sent', id: `id${k}` }) as EmailResult))

describe('sendNewsletter', () => {
  const people = [
    cand('ana@example.com', { unsubscribeToken: TOKEN_A }),
    cand('bea@example.com', { unsubscribeToken: TOKEN_B }),
    cand('no@example.com', { unsubscribeToken: TOKEN_C, newsletterOptIn: false }),
  ]

  it('dryRun only counts', async () => {
    const { repo, rows } = memoryRepo(people)
    const batch = okBatch()
    expect(await sendNewsletter({ ...ISSUE, dryRun: true }, deps(repo, batch))).toEqual({
      mode: 'dry_run',
      issueId: '2026-10-16',
      recipients: 2,
      alreadySent: 0,
      bySource: { waitlist: 2, user: 0 },
    })
    expect(batch).not.toHaveBeenCalled()
    expect(rows.size).toBe(0)
  })

  it('is idempotent: the same issue twice emails no one twice', async () => {
    const { repo } = memoryRepo(people)
    const batch = okBatch()
    const first = await sendNewsletter(ISSUE, deps(repo, batch))
    expect(first).toMatchObject({ mode: 'send', sent: 2, failed: 0, alreadySent: 0 })
    expect(batch.mock.calls[0][0].map((m) => m.to)).toEqual(['ana@example.com', 'bea@example.com'])
    const second = await sendNewsletter(ISSUE, deps(repo, batch))
    expect(second).toMatchObject({ mode: 'send', sent: 0, alreadySent: 2 })
    expect(batch.mock.calls[1][0]).toEqual([])
    // A new issue goes to everyone again.
    expect(await sendNewsletter({ ...ISSUE, issueId: '2026-10-23' }, deps(repo, batch))).toMatchObject({ sent: 2 })
  })

  it('a failed or unconfigured send releases the claim, so a re-run retries only those', async () => {
    const { repo } = memoryRepo(people)
    const flaky = vi.fn(async (m: EmailMessage[]) =>
      m.map((x) => (x.to === 'bea@example.com' ? { status: 'failed', error: 'boom' } : { status: 'sent', id: 'x' }) as EmailResult),
    )
    expect(await sendNewsletter(ISSUE, deps(repo, flaky))).toMatchObject({ sent: 1, failed: 1 })
    const batch = okBatch()
    expect(await sendNewsletter(ISSUE, deps(repo, batch))).toMatchObject({ sent: 1, alreadySent: 1 })
    expect(batch.mock.calls[0][0].map((m) => m.to)).toEqual(['bea@example.com'])

    const off = memoryRepo(people)
    const skipped = vi.fn(async (m: EmailMessage[]) => m.map(() => ({ status: 'skipped', reason: 'not_configured' }) as EmailResult))
    expect(await sendNewsletter(ISSUE, deps(off.repo, skipped))).toMatchObject({ sent: 0, skipped: 2 })
    expect(off.rows.size).toBe(0)
  })

  it('testTo sends one proof to an admin address only, and records nothing', async () => {
    const { repo, rows } = memoryRepo(people, ['miguel@mimoia.com'])
    const d = deps(repo, okBatch())
    const r = await sendNewsletter({ ...ISSUE, testTo: 'miguel@mimoia.com' }, d)
    expect(r).toEqual({ mode: 'test', issueId: '2026-10-16', to: 'm***@m***.com', status: 'sent' })
    const msg = (d.sendOne as any).mock.calls[0][0] as EmailMessage
    expect(msg.to).toBe('miguel@mimoia.com')
    expect(msg.subject).toBe('[Prueba] El menú de los viernes · nº 1')
    expect(rows.size).toBe(0)
    await expect(sendNewsletter({ ...ISSUE, testTo: 'ana@example.com' }, d)).rejects.toThrow()
  })

  it('the newsletter opt-out leaves the entry on the list; a second click says already', async () => {
    const { repo, entries } = memoryRepo(people)
    expect(await repo.unsubscribe(`w.${TOKEN_A}`)).toBe('ok')
    expect(entries[0]).toMatchObject({ status: 'waiting', email: 'ana@example.com', newsletterOptIn: false })
    expect(await repo.unsubscribe(`w.${TOKEN_A}`)).toBe('already')
    expect(await repo.unsubscribe(TOKEN_A)).toBe('not_found')
    const batch = okBatch()
    expect(await sendNewsletter(ISSUE, deps(repo, batch))).toMatchObject({ sent: 1 })
    expect(batch.mock.calls[0][0].map((m) => m.to)).toEqual(['bea@example.com'])
  })

  it('one person, one switch: the account opt-out also turns off their waitlist entry, and vice versa', async () => {
    const both = memoryRepo([userCand('ana@example.com'), cand('ana@example.com'), cand('bea@example.com', { unsubscribeToken: TOKEN_B })])
    expect(await both.repo.unsubscribe(newsletterTokenForUser(USER_ID))).toBe('ok')
    expect(both.entries.map((e) => e.newsletterOptIn)).toEqual([false, false, true])

    const again = memoryRepo([userCand('ana@example.com'), cand('ana@example.com')])
    expect(await again.repo.unsubscribe(`w.${TOKEN_A}`)).toBe('ok')
    expect(again.entries.map((e) => e.newsletterOptIn)).toEqual([false, false])

    const prof = memoryRepo([userCand('ana@example.com'), cand('ana@example.com')])
    expect(await prof.repo.setUserOptIn(USER_ID, false)).toBe(false)
    expect(prof.entries.map((e) => e.newsletterOptIn)).toEqual([false, false])
  })

  it('dryRun says how many come from each source and whether an address is in', async () => {
    const { repo } = memoryRepo([userCand('ana@example.com'), cand('bea@example.com', { unsubscribeToken: TOKEN_B })])
    const r = await sendNewsletter({ ...ISSUE, dryRun: true, includes: 'ana@example.com' }, deps(repo, okBatch()))
    expect(r).toMatchObject({ recipients: 2, bySource: { waitlist: 1, user: 1 }, includes: true })
    const no = await sendNewsletter({ ...ISSUE, dryRun: true, includes: 'zoe@example.com' }, deps(repo, okBatch()))
    expect(no).toMatchObject({ includes: false })
  })
})

describe('renderNewsletterEmail / buildNewsletterMessage', () => {
  it('opens with the star recipe photo at full width, absolute URL and alt, linked to the recipe', () => {
    const { html, text } = renderNewsletterEmail(ISSUE, { unsubscribeUrl: 'https://mimoia.com/newsletter/baja?t=w.x' })
    const firstImg = html.match(/<img [^>]+>/)![0]
    expect(firstImg).toContain('src="https://mimoia.com/images/recipes/lentejas.jpg"')
    expect(firstImg).toContain('alt="Un plato de lentejas estofadas con zanahoria"')
    expect(firstImg).toContain('width:100%')
    expect(html.indexOf('lentejas.jpg')).toBeLessThan(html.indexOf('La lista por días'))
    expect(html).toContain('<a href="https://mimoia.com/recipes/lentejas" style="text-decoration:none;"><img')
    expect(html).toContain('max-width:600px')
    expect(html).toContain('src="https://mimoia.com/n.jpg"')
    expect(text).toContain('LA RECETA DE LA SEMANA: Lentejas estofadas')
    expect(text).toContain('No quiero recibir más el menú de los viernes: https://mimoia.com/newsletter/baja?t=w.x')
  })

  it('rejects a relative image URL or a star without alt', () => {
    const bad = JSON.parse(JSON.stringify(ISSUE))
    bad.content.star.imageUrl = '/images/recipes/lentejas.jpg'
    expect(newsletterSendSchema.safeParse(bad).success).toBe(false)
    const noAlt = JSON.parse(JSON.stringify(ISSUE))
    delete noAlt.content.star.imageAlt
    expect(newsletterSendSchema.safeParse(noAlt).success).toBe(false)
  })

  it('carries the personal one-click headers and both opt-out links', () => {
    const m = buildNewsletterMessage(ISSUE, 'ana@example.com', { token: `w.${TOKEN_A}`, leaveToken: TOKEN_A }, {
      publicUrl: 'https://mimoia.com/',
      apiUrl: 'https://api.mimoia.com',
    })
    expect(m.headers).toEqual({
      'List-Unsubscribe': `<https://api.mimoia.com/newsletter/unsubscribe?t=w.${TOKEN_A}>, <https://mimoia.com/newsletter/baja?t=w.${TOKEN_A}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    })
    expect(m.html).toContain(`https://mimoia.com/newsletter/baja?t=w.${TOKEN_A}`)
    expect(m.html).toContain(`https://mimoia.com/lista/baja?t=${TOKEN_A}`)
  })

  it('escapes the content', () => {
    const x = newsletterSendSchema.parse({ ...ISSUE, content: { ...ISSUE.content, intro: '<script>alert(1)</script>' } })
    expect(renderNewsletterEmail(x, { unsubscribeUrl: 'https://mimoia.com/x' }).html).not.toContain('<script>')
  })

  it('a letter signed by a person: edition, accent headline, sections in order, the name under the signoff', () => {
    const x = newsletterSendSchema.parse({
      ...ISSUE,
      content: {
        ...ISSUE.content,
        edition: 'N.º 1 · 16 de octubre de 2026',
        headline: 'La escudella, fuera de *temporada*',
        star: { ...ISSUE.content.star, meta: 'Cuchara · para 6' },
        sections: [
          { label: 'Por qué existe Mimoia', quote: 'Que en casa solo quede lo divertido', body: 'La misión.', tone: 'band' },
          { label: 'Qué es esta carta', title: 'Cada viernes', body: 'El formato.' },
        ],
        signoff: 'Un abrazo,',
        from: { name: 'Miguel', role: 'Fundador de Mimoia' },
      },
    })
    const m = buildNewsletterMessage(x, 'ana@example.com', { token: `w.${TOKEN_A}` }, {
      publicUrl: 'https://mimoia.com',
      apiUrl: 'https://api.mimoia.com',
    })
    expect(m.html).toContain('src="https://mimoia.com/email/mimoia-logo.png"')
    expect(m.html).toContain('N.º 1 · 16 de octubre de 2026')
    expect(m.html).toMatch(/La escudella, fuera de <em [^>]*>temporada<\/em>/)
    expect(m.html).toContain('Cuchara · para 6')
    expect(m.html).toContain('«Que en casa solo quede lo divertido»')
    expect(m.html.indexOf('lentejas.jpg')).toBeLessThan(m.html.indexOf('Por qué existe Mimoia'))
    expect(m.html.indexOf('Por qué existe Mimoia')).toBeLessThan(m.html.indexOf('Qué es esta carta'))
    expect(m.html.indexOf('Un abrazo,')).toBeLessThan(m.html.indexOf('>Miguel</p>'))
    expect(m.text).toContain('La escudella, fuera de temporada')
    expect(m.text).toContain('POR QUÉ EXISTE MIMOIA')
    expect(m.text).toMatch(/Un abrazo,\nMiguel\nFundador de Mimoia/)
  })

  it('the greeting goes above the headline, and escaped (Miguel, 2026-10-16)', () => {
    const x = newsletterSendSchema.parse({
      ...ISSUE,
      content: { ...ISSUE.content, preface: 'Hola a todos <b>', headline: 'Los macarrones de *casa*', intro: 'La historia.' },
    })
    const { html, text } = renderNewsletterEmail(x, { unsubscribeUrl: 'https://mimoia.com/x' })
    expect(html.indexOf('Hola a todos')).toBeGreaterThan(-1)
    expect(html.indexOf('Hola a todos')).toBeLessThan(html.indexOf('Los macarrones de'))
    expect(html.indexOf('Los macarrones de')).toBeLessThan(html.indexOf('La historia.'))
    expect(html).not.toContain('<b>')
    expect(text.indexOf('Hola a todos')).toBeLessThan(text.indexOf('Los macarrones de casa'))
  })

  it('the headline accent cannot smuggle markup', () => {
    const x = newsletterSendSchema.parse({ ...ISSUE, content: { ...ISSUE.content, headline: '*<img src=x onerror=alert(1)>*' } })
    const { html } = renderNewsletterEmail(x, { unsubscribeUrl: 'https://mimoia.com/x' })
    expect(html).not.toContain('<img src=x')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;</em>')
  })
})

// ─── Routes ──────────────────────────────────────────────────────

const servers: Server[] = []
afterAll(() => servers.forEach((s) => (s.closeAllConnections(), s.close())))

async function serve(app: express.Express): Promise<string> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

const noLimit: RequestHandler = (_req, _res, next) => next()

describe('newsletter routes', () => {
  it('POST /admin/newsletter/send: 401 without an admin, 400 on a bad issue, audits a real send', async () => {
    const { repo } = memoryRepo([cand('ana@example.com')])
    const deny: RequestHandler = (_req, res) => void res.status(401).json({ error: 'no' })
    const app1 = express().use(express.json()).use(createNewsletterRouter({ repo, adminAuth: [deny], unsubscribeLimiter: noLimit }))
    const b1 = await serve(app1)
    expect((await fetch(`${b1}/admin/newsletter/send`, { method: 'POST' })).status).toBe(401)

    const asAdmin: RequestHandler = (req, _res, next) => {
      ;(req as any).userId = '11111111-1111-4111-8111-111111111111'
      next()
    }
    const audit = vi.fn(async () => 'a1')
    const sendBatch = okBatch()
    const app = express()
      .use(express.json())
      .use(
        createNewsletterRouter({
          repo,
          adminAuth: [asAdmin],
          unsubscribeLimiter: noLimit,
          audit: audit as any,
          makeDeps: (urls) => ({ ...deps(repo, sendBatch), ...urls }),
          publicUrl: () => 'https://mimoia.com',
        }),
      )
    const b = await serve(app)
    const post = (body: unknown) =>
      fetch(`${b}/admin/newsletter/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect((await post({ issueId: 'Nº 1', subject: 'x' })).status).toBe(400)
    const dry = await post({ ...ISSUE, dryRun: true })
    expect(await dry.json()).toMatchObject({ mode: 'dry_run', recipients: 1 })
    expect(audit).not.toHaveBeenCalled()
    expect((await post({ ...ISSUE, testTo: 'ana@example.com' })).status).toBe(400)
    const real = await post(ISSUE)
    expect(await real.json()).toMatchObject({ mode: 'send', sent: 1 })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'newsletter.send', payload: expect.objectContaining({ issueId: '2026-10-16', sent: 1 }) }))
    // The one-click URL points at the API origin that served the request.
    expect(sendBatch.mock.calls[0][0][0].headers!['List-Unsubscribe']).toContain(`${b}/newsletter/unsubscribe?t=w.`)
  })

  it('GET/PUT /newsletter/me: the profile switch, behind auth', async () => {
    const { repo, entries } = memoryRepo([userCand('ana@example.com', { newsletterOptIn: false })])
    const asUser: RequestHandler = (req, _res, next) => {
      ;(req as any).userId = USER_ID
      next()
    }
    const app = express().use(express.json()).use(createNewsletterRouter({ repo, userAuth: asUser, unsubscribeLimiter: noLimit }))
    const b = await serve(app)
    expect(await (await fetch(`${b}/newsletter/me`)).json()).toEqual({ optIn: false })
    const put = (body: unknown) =>
      fetch(`${b}/newsletter/me`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    expect((await put({ optIn: 'si' })).status).toBe(400)
    expect(await (await put({ optIn: true })).json()).toEqual({ optIn: true })
    expect(entries[0].newsletterOptIn).toBe(true)
    expect(await (await put({ optIn: false })).json()).toEqual({ optIn: false })
    expect(entries[0].newsletterOptIn).toBe(false)
  })

  it('POST /newsletter/unsubscribe: JSON token and the RFC 8058 one-click form both work; unknown → 404', async () => {
    const { repo, entries } = memoryRepo([cand('ana@example.com', { unsubscribeToken: TOKEN_A }), cand('bea@example.com', { unsubscribeToken: TOKEN_B })])
    const app = express().use(express.json()).use(express.urlencoded({ extended: true })).use(createNewsletterRouter({ repo, unsubscribeLimiter: noLimit }))
    const b = await serve(app)
    const json = await fetch(`${b}/newsletter/unsubscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: `w.${TOKEN_A}` }) })
    expect(await json.json()).toEqual({ ok: true, alreadyUnsubscribed: false })
    const oneClick = await fetch(`${b}/newsletter/unsubscribe?t=w.${TOKEN_B}`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    })
    expect(oneClick.status).toBe(200)
    expect(entries.map((e) => [e.newsletterOptIn, e.status])).toEqual([
      [false, 'waiting'],
      [false, 'waiting'],
    ])
    const unknown = await fetch(`${b}/newsletter/unsubscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 'w.zzzzzzzzzzzzzzzzzzzz' }) })
    expect(unknown.status).toBe(404)
  })
})
