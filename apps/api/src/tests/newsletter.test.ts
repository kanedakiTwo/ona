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
  forgetNewsletterSends,
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
import {
  buildIssueStats,
  contentLinks,
  countsAsClick,
  type NewsletterStatsRepo,
  type TrackedLink,
} from '../services/newsletterStats.js'

/** In-memory clicks / opt-outs with the same semantics as the SQL (PRO-191). */
function memoryStats(sendsOf: () => Array<{ issueId: string; source: string; hash?: string }> = () => []) {
  const links = new Map<string, TrackedLink & { clicks: number }>()
  const unsubs: Array<{ issueId: string | null; source: string }> = []
  const stats: NewsletterStatsRepo = {
    async registerLinks(issueId, ls) {
      for (const l of ls) {
        const k = `${issueId}|${l.index}`
        links.set(k, { ...l, clicks: links.get(k)?.clicks ?? 0 })
      }
    },
    async click(issueId, index, count) {
      const l = links.get(`${issueId}|${index}`)
      if (!l) return null
      if (count) l.clicks += 1
      return l.destination
    },
    async wasSentTo(issueId, hash) {
      return sendsOf().some((x) => x.issueId === issueId && x.hash === hash)
    },
    async recordUnsubscribe(issueId, source) {
      unsubs.push({ issueId, source })
    },
    async stats() {
      const sends = sendsOf()
      const ids = [...new Set(sends.map((x) => x.issueId))]
      return buildIssueStats(
        ids.map((issueId) => {
          const mine = sends.filter((x) => x.issueId === issueId)
          return { issueId, firstSentAt: '2026-10-21T08:00:00.000Z', total: mine.length, user: mine.filter((x) => x.source === 'user').length, waitlist: mine.filter((x) => x.source === 'waitlist').length }
        }),
        [...links.entries()].map(([k, l]) => ({ issueId: k.split('|')[0], index: l.index, destination: l.destination, clicks: l.clicks })),
        unsubs.map((u) => ({ ...u, n: 1 })),
      )
    },
  }
  return { stats, links, unsubs }
}

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

describe('forgetNewsletterSends (PRO-132)', () => {
  function fakeDb(deleted: number) {
    const calls: unknown[] = []
    const db = {
      delete: vi.fn((table: unknown) => {
        calls.push(table)
        return { where: () => ({ returning: async () => Array.from({ length: deleted }, () => ({ h: 'x' })) }) }
      }),
    }
    return { db: db as any, calls }
  }
  it('deletes the rows of that email and says how many', async () => {
    const { db, calls } = fakeDb(2)
    expect(await forgetNewsletterSends(db, ' Ana@Example.com ')).toBe(2)
    expect(calls).toHaveLength(1)
  })
  it('does nothing without an email (an already-anonymised entry)', async () => {
    const { db } = fakeDb(5)
    expect(await forgetNewsletterSends(db, null)).toBe(0)
    expect(await forgetNewsletterSends(db, '  ')).toBe(0)
    expect(db.delete).not.toHaveBeenCalled()
  })
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
      if (!parseNewsletterToken(token)) return { outcome: 'not_found', recipientHash: null }
      const e = entries.find((x) => x.token === token)
      if (!e) return { outcome: 'not_found', recipientHash: null }
      if (e.status === 'unsubscribed' || !e.email) return { outcome: 'already', recipientHash: null }
      return { outcome: offByEmail(e.email) > 0 ? 'ok' : 'already', recipientHash: recipientHash(e.email) }
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

  it('each waitlist recipient gets their own invite link, never someone else\'s; accounts get none (PRO-130)', async () => {
    const codes: Record<string, string> = { 'ana@example.com': 'anacode1', 'bea@example.com': 'beacode2' }
    const { repo } = memoryRepo([
      userCand('cuenta@example.com'),
      cand('ana@example.com', { unsubscribeToken: TOKEN_A, referralCode: codes['ana@example.com'] }),
      cand('bea@example.com', { unsubscribeToken: TOKEN_B, referralCode: codes['bea@example.com'] }),
    ])
    const batch = okBatch()
    await sendNewsletter(ISSUE, deps(repo, batch))
    const msgs = batch.mock.calls[0][0]
    expect(msgs.map((m) => m.to)).toEqual(['cuenta@example.com', 'ana@example.com', 'bea@example.com'])
    for (const m of msgs) {
      const own = codes[m.to]
      for (const [email, code] of Object.entries(codes)) {
        if (email === m.to) continue
        expect(m.html).not.toContain(code)
        expect(m.text).not.toContain(code)
      }
      if (own) {
        expect(m.html).toContain('Invita a tu hogar y entráis antes:')
        expect(m.html).toContain(`href="https://mimoia.com/?invita=${own}"`)
        expect(m.text).toContain(`Invita a tu hogar y entráis antes: https://mimoia.com/?invita=${own}`)
      } else {
        expect(m.html).not.toContain('Invita a tu hogar')
        expect(m.text).not.toContain('Invita a tu hogar')
        expect(m.html).not.toContain('?invita=')
      }
    }
  })

  it('the admin proof carries no invite link (PRO-130)', async () => {
    const { repo } = memoryRepo([cand('ana@example.com', { referralCode: 'anacode1' })], ['miguel@mimoia.com'])
    const d = deps(repo, okBatch())
    await sendNewsletter({ ...ISSUE, testTo: 'miguel@mimoia.com' }, d)
    const msg = (d.sendOne as any).mock.calls[0][0] as EmailMessage
    expect(msg.html).not.toContain('?invita=')
  })

  it('the newsletter opt-out leaves the entry on the list; a second click says already', async () => {
    const { repo, entries } = memoryRepo(people)
    expect(await repo.unsubscribe(`w.${TOKEN_A}`)).toEqual({ outcome: 'ok', recipientHash: recipientHash('ana@example.com') })
    expect(entries[0]).toMatchObject({ status: 'waiting', email: 'ana@example.com', newsletterOptIn: false })
    expect((await repo.unsubscribe(`w.${TOKEN_A}`)).outcome).toBe('already')
    expect((await repo.unsubscribe(TOKEN_A)).outcome).toBe('not_found')
    const batch = okBatch()
    expect(await sendNewsletter(ISSUE, deps(repo, batch))).toMatchObject({ sent: 1 })
    expect(batch.mock.calls[0][0].map((m) => m.to)).toEqual(['bea@example.com'])
  })

  it('one person, one switch: the account opt-out also turns off their waitlist entry, and vice versa', async () => {
    const both = memoryRepo([userCand('ana@example.com'), cand('ana@example.com'), cand('bea@example.com', { unsubscribeToken: TOKEN_B })])
    expect((await both.repo.unsubscribe(newsletterTokenForUser(USER_ID))).outcome).toBe('ok')
    expect(both.entries.map((e) => e.newsletterOptIn)).toEqual([false, false, true])

    const again = memoryRepo([userCand('ana@example.com'), cand('ana@example.com')])
    expect((await again.repo.unsubscribe(`w.${TOKEN_A}`)).outcome).toBe('ok')
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
    const { stats, unsubs } = memoryStats(() => [{ issueId: '2026-10-16', source: 'waitlist', hash: recipientHash('ana@example.com') }])
    const app = express().use(express.json()).use(express.urlencoded({ extended: true })).use(createNewsletterRouter({ repo, stats, unsubscribeLimiter: noLimit }))
    const b = await serve(app)
    const json = await fetch(`${b}/newsletter/unsubscribe`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: `w.${TOKEN_A}`, issueId: '2026-10-16' }) })
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
    // PRO-191: counted under its issue when the link carries one (the one-click URL above had none).
    expect(unsubs).toEqual([
      { issueId: '2026-10-16', source: 'waitlist' },
      { issueId: null, source: 'waitlist' },
    ])
  })

  it('POST /newsletter/unsubscribe with an issue that was not sent to that person: the opt-out happens, counted without issue', async () => {
    const { repo, entries } = memoryRepo([
      cand('ana@example.com', { unsubscribeToken: TOKEN_A }),
      cand('bea@example.com', { unsubscribeToken: TOKEN_B }),
      userCand('carla@example.com'),
      cand('dani@example.com', { unsubscribeToken: TOKEN_D }),
    ])
    // 2026-10-16 went to bea only (dani signed up after it, e.g. to inflate its opt-outs).
    const { stats, unsubs } = memoryStats(() => [{ issueId: '2026-10-16', source: 'waitlist', hash: recipientHash('bea@example.com') }])
    const app = express().use(express.json()).use(express.urlencoded({ extended: true })).use(createNewsletterRouter({ repo, stats, unsubscribeLimiter: noLimit }))
    const b = await serve(app)
    // An issue id that looks valid but was never sent, by JSON and by the one-click URL.
    const json = await fetch(`${b}/newsletter/unsubscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: `w.${TOKEN_A}`, issueId: 'numero-inventado' }),
    })
    expect(await json.json()).toEqual({ ok: true, alreadyUnsubscribed: false })
    const oneClick = await fetch(`${b}/newsletter/unsubscribe?t=${encodeURIComponent(newsletterTokenForUser(USER_ID))}&i=otro-inventado`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    })
    expect(await oneClick.json()).toEqual({ ok: true, alreadyUnsubscribed: false })
    // A real issue that this person never got: the opt-out happens, but not under that issue.
    const notMine = await fetch(`${b}/newsletter/unsubscribe?t=w.${TOKEN_D}&i=2026-10-16`, { method: 'POST' })
    expect(await notMine.json()).toEqual({ ok: true, alreadyUnsubscribed: false })
    // The issue sent to this person still counts under it.
    const real = await fetch(`${b}/newsletter/unsubscribe?t=w.${TOKEN_B}&i=2026-10-16`, { method: 'POST' })
    expect(real.status).toBe(200)
    expect(entries.map((e) => e.newsletterOptIn)).toEqual([false, false, false, false])
    expect(unsubs).toEqual([
      { issueId: null, source: 'waitlist' },
      { issueId: null, source: 'user' },
      { issueId: null, source: 'waitlist' },
      { issueId: '2026-10-16', source: 'waitlist' },
    ])
    const report = await stats.stats()
    expect(report.issues.map((i) => i.issueId)).toEqual(['2026-10-16'])
    expect(report.issues[0].unsubscribes).toEqual({ total: 1, user: 0, waitlist: 1 })
    expect(report.unsubscribesWithoutIssue).toEqual({ total: 3, user: 1, waitlist: 2 })
  })

  it('POST /newsletter/unsubscribe: if checking the issue fails, the opt-out holds and counts without issue', async () => {
    const { repo, entries } = memoryRepo([cand('ana@example.com', { unsubscribeToken: TOKEN_A })])
    const { stats, unsubs } = memoryStats(() => [{ issueId: '2026-10-16', source: 'waitlist', hash: recipientHash('ana@example.com') }])
    stats.wasSentTo = async () => {
      throw new Error('db down')
    }
    const app = express().use(express.json()).use(createNewsletterRouter({ repo, stats, unsubscribeLimiter: noLimit }))
    const b = await serve(app)
    const r = await fetch(`${b}/newsletter/unsubscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: `w.${TOKEN_A}`, issueId: '2026-10-16' }),
    })
    expect(await r.json()).toEqual({ ok: true, alreadyUnsubscribed: false })
    expect(entries[0].newsletterOptIn).toBe(false)
    expect(unsubs).toEqual([{ issueId: null, source: 'waitlist' }])
  })
})

describe('buildIssueStats', () => {
  const SENDS = [{ issueId: '2026-10-16', firstSentAt: '2026-10-16T08:00:00.000Z', total: 3, user: 1, waitlist: 2 }]

  it('opt-outs under an issue with no sends do not create that issue; they count without issue', () => {
    const r = buildIssueStats(SENDS, [], [
      { issueId: '2026-10-16', source: 'user', n: 1 },
      { issueId: 'publicidad-gratis', source: 'waitlist', n: 4 },
      { issueId: 'otro-inventado', source: 'user', n: 2 },
      { issueId: null, source: 'waitlist', n: 1 },
    ])
    expect(r.issues.map((i) => i.issueId)).toEqual(['2026-10-16'])
    expect(r.issues[0].unsubscribes).toEqual({ total: 1, user: 1, waitlist: 0 })
    expect(r.unsubscribesWithoutIssue).toEqual({ total: 7, user: 2, waitlist: 5 })
  })

  it('an issue whose sends were forgotten keeps its opt-outs: its saved links make it known', () => {
    const r = buildIssueStats(SENDS, [{ issueId: '2026-10-09', index: 1, destination: 'https://mimoia.com/menu', clicks: 3 }], [
      { issueId: '2026-10-09', source: 'waitlist', n: 2 },
      { issueId: 'inventado', source: 'user', n: 1 },
    ])
    expect(r.issues.map((i) => i.issueId).sort()).toEqual(['2026-10-09', '2026-10-16'])
    expect(r.issues.find((i) => i.issueId === '2026-10-09')!.unsubscribes).toEqual({ total: 2, user: 0, waitlist: 2 })
    expect(r.unsubscribesWithoutIssue).toEqual({ total: 1, user: 1, waitlist: 0 })
  })
})

describe('newsletter clicks, counted by us (PRO-191)', () => {
  const BROWSER = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'

  it('a test issue with 2 links: one clicked twice → 2 and 0; unknown issue or index → 404, no redirect', async () => {
    const { repo, rows } = memoryRepo([cand('ana@example.com', { unsubscribeToken: TOKEN_A }), userCand('bea@example.com')])
    const sends = () =>
      [...rows.entries()].filter(([, v]) => v.status === 'sent').map(([k]) => ({ issueId: k.split('|')[0], source: 'waitlist', hash: k.split('|')[1] }))
    const { stats } = memoryStats(sends)
    const sendBatch = okBatch()
    const asAdmin: RequestHandler = (req, _res, next) => {
      ;(req as any).userId = '11111111-1111-4111-8111-111111111111'
      next()
    }
    const app = express()
      .use(express.json())
      .use(
        createNewsletterRouter({
          repo,
          stats,
          adminAuth: [asAdmin],
          statsAuth: asAdmin,
          unsubscribeLimiter: noLimit,
          audit: (async () => 'a1') as any,
          makeDeps: (urls) => ({ ...deps(repo, sendBatch), ...urls, stats }),
          publicUrl: () => 'https://mimoia.com',
        }),
      )
    const b = await serve(app)
    const issue = { ...ISSUE, issueId: 'prueba-clics' }
    expect(contentLinks(issue.content).map((l) => l.destination)).toEqual(['https://mimoia.com/recipes/lentejas', 'https://mimoia.com/menu'])
    const sent = await fetch(`${b}/admin/newsletter/send`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(issue) })
    expect(await sent.json()).toMatchObject({ mode: 'send', sent: 2 })

    // Every email carries our links, never the destinations themselves; the opt-out names the issue.
    const msg = sendBatch.mock.calls[0][0][0]
    expect(msg.html).toContain('https://mimoia.com/n/prueba-clics/1')
    expect(msg.html).toContain('https://mimoia.com/n/prueba-clics/2')
    expect(msg.html).not.toContain('https://mimoia.com/recipes/lentejas')
    expect(msg.text).toContain('https://mimoia.com/n/prueba-clics/2')
    expect(msg.html).toContain('i=prueba-clics')

    const click = (path: string, ua = BROWSER, method = 'GET') => fetch(`${b}${path}`, { method, headers: { 'user-agent': ua } })
    const first = await click('/newsletter/click/prueba-clics/1')
    expect(await first.json()).toEqual({ url: 'https://mimoia.com/recipes/lentejas' })
    await click('/newsletter/click/prueba-clics/1')
    // Not clicks: a HEAD, a mail scanner, a proof.
    expect((await click('/newsletter/click/prueba-clics/2', BROWSER, 'HEAD')).status).toBe(200)
    await click('/newsletter/click/prueba-clics/2', 'Mozilla/5.0 (compatible; Proofpoint URL Defense)')
    await click('/newsletter/click/prueba-clics/2?prueba=1')
    await fetch(`${b}/newsletter/click/prueba-clics/2`, { headers: { 'user-agent': BROWSER, 'x-newsletter-head': '1' } })

    // Unknown issue or link: 404, and nothing to redirect to.
    for (const p of ['/newsletter/click/no-existe/1', '/newsletter/click/prueba-clics/3', '/newsletter/click/prueba-clics/0', '/newsletter/click/Prueba/1']) {
      const r = await click(p)
      expect(r.status, p).toBe(404)
      expect(await r.json()).not.toHaveProperty('url')
    }

    // Opt-outs: the issue that was sent counts it; an invented one never becomes an issue.
    const optOut = (token: string, issue: string) =>
      fetch(`${b}/newsletter/unsubscribe?t=${encodeURIComponent(token)}&i=${issue}`, { method: 'POST' })
    expect((await optOut(`w.${TOKEN_A}`, 'prueba-clics')).status).toBe(200)
    expect((await optOut(newsletterTokenForUser(USER_ID), 'no-existe')).status).toBe(200)

    const report = await (await fetch(`${b}/admin/newsletter/stats`)).json()
    const row = report.issues.find((i: any) => i.issueId === 'prueba-clics')
    expect(row.unsubscribes).toEqual({ total: 1, user: 0, waitlist: 1 })
    expect(report.issues.map((i: any) => i.issueId)).not.toContain('no-existe')
    expect(report.unsubscribesWithoutIssue).toEqual({ total: 1, user: 1, waitlist: 0 })
    expect(row.clicks.total).toBe(2)
    expect(row.clicks.links).toEqual([
      { index: 1, destination: 'https://mimoia.com/recipes/lentejas', clicks: 2 },
      { index: 2, destination: 'https://mimoia.com/menu', clicks: 0 },
    ])
    expect(row.sent.total).toBe(2)
    expect(report.definitions.clicks).toMatch(/not people/)
  })

  it('a proof (testTo) uses the same links with ?prueba=1, which never count', async () => {
    const { repo } = memoryRepo([cand('ana@example.com')], ['admin@mimoia.com'])
    const { stats, links } = memoryStats()
    const sendOne = vi.fn(async () => ({ status: 'sent', id: 'one' }) as EmailResult)
    await sendNewsletter({ ...ISSUE, issueId: 'n2', testTo: 'admin@mimoia.com' }, { ...deps(repo, okBatch()), sendOne, stats })
    const html = (sendOne.mock.calls[0] as any)[0].html as string
    expect(html).toContain('https://mimoia.com/n/n2/1?prueba=1')
    expect(links.size).toBe(2)
    expect(countsAsClick({ method: 'GET', userAgent: BROWSER, proof: true })).toBe(false)
  })

  it('what counts as a click', () => {
    expect(countsAsClick({ method: 'GET', userAgent: BROWSER })).toBe(true)
    expect(countsAsClick({ method: 'HEAD', userAgent: BROWSER })).toBe(false)
    expect(countsAsClick({ method: 'GET', userAgent: '' })).toBe(false)
    for (const ua of ['Googlebot/2.1', 'Mozilla/5.0 (compatible; Mimecast)', 'Microsoft Office SafeLinks', 'WhatsApp/2.23', 'curl/8.4.0', 'python-requests/2.31']) {
      expect(countsAsClick({ method: 'GET', userAgent: ua }), ua).toBe(false)
    }
  })
})
