/**
 * PRO-135 (specs/billing.md): the 14-day trial without card and the paused
 * account at its end, only from launch day (2026-12-15). Pure rule, the
 * DB-backed checks with a fake loader, the 402 guard, and the day-12 email.
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { ACCOUNT_PAUSED_MESSAGE, accountAccess, trialDaysLeftLabel, trialEndsAt, trialLastDayLabel } from '@ona/shared'
import { accessForUser, isAccountPaused, requireActiveAccount, type AccessFacts } from '../services/accountAccess.js'
import {
  isSendingHour,
  isTrialEndingEmailDue,
  sendTrialEndingEmails,
  sendTrialEndingEmailsIfDue,
  trialEndingEmail,
  type TrialEmailCandidate,
  type TrialEmailRepo,
} from '../services/trialEmails.js'
import type { EmailMessage, EmailResult } from '../services/email.js'

const day = (n: number, from: Date) => new Date(from.getTime() + n * 86_400_000)

const BETA_HOUSEHOLD = new Date('2026-10-01T10:00:00Z')
/** Signs up after launch, at 15:00 Madrid. */
const NEW_HOUSEHOLD = new Date('2027-01-10T14:00:00Z')

describe('accountAccess (pure rule)', () => {
  it('before launch day nobody is in a trial or paused, whatever the date of sign-up', () => {
    for (const now of [new Date('2026-10-18T10:00:00Z'), new Date('2026-12-14T22:59:59Z')]) {
      expect(accountAccess({ householdCreatedAt: BETA_HOUSEHOLD, paid: false, now }).state).toBe('beta')
      expect(accountAccess({ householdCreatedAt: new Date('2026-12-14T20:00:00Z'), paid: false, now }).state).toBe('beta')
      expect(accountAccess({ householdCreatedAt: null, paid: false, now }).state).toBe('beta')
    }
  })

  it('a beta household: its 14 days start on launch day (15 → 28 December)', () => {
    expect(trialEndsAt(BETA_HOUSEHOLD)).toEqual({ endsAt: new Date('2026-12-28T23:00:00Z'), lastDay: '2026-12-28' })
    const at = (iso: string) => accountAccess({ householdCreatedAt: BETA_HOUSEHOLD, paid: false, now: new Date(iso) })
    expect(at('2026-12-14T23:00:00Z')).toMatchObject({ state: 'trial', daysLeft: 13 }) // 00:00 Madrid on launch day
    expect(at('2026-12-26T10:00:00Z')).toMatchObject({ state: 'trial', daysLeft: 2 })
    expect(at('2026-12-28T22:59:00Z')).toMatchObject({ state: 'trial', daysLeft: 0 })
    expect(at('2026-12-28T23:00:00Z')).toMatchObject({ state: 'paused', daysLeft: null })
  })

  it('signing up after launch day: day 13 active, day 15 paused', () => {
    const at = (n: number) => accountAccess({ householdCreatedAt: NEW_HOUSEHOLD, paid: false, now: day(n, NEW_HOUSEHOLD) })
    expect(at(0)).toMatchObject({ state: 'trial', daysLeft: 14, trialLastDay: '2027-01-24' })
    expect(at(12)).toMatchObject({ state: 'trial', daysLeft: 2 })
    expect(at(13)).toMatchObject({ state: 'trial', daysLeft: 1 })
    expect(at(15)).toMatchObject({ state: 'paused' })
    expect(at(400)).toMatchObject({ state: 'paused' })
  })

  it('a paid plan (trialing, active, past_due) means subscribed, even long after the trial', () => {
    expect(accountAccess({ householdCreatedAt: NEW_HOUSEHOLD, paid: true, now: day(60, NEW_HOUSEHOLD) }).state).toBe('subscribed')
  })

  it('in summer time the trial still ends at midnight in Madrid', () => {
    expect(trialEndsAt(new Date('2027-06-01T10:00:00Z'))).toEqual({ endsAt: new Date('2027-06-15T22:00:00Z'), lastDay: '2027-06-15' })
  })

  it('labels', () => {
    expect(trialLastDayLabel({ trialLastDay: '2026-12-28' })).toBe('28 de diciembre')
    expect([2, 1, 0].map(trialDaysLeftLabel)).toEqual(['Te quedan 2 días de prueba', 'Te queda 1 día de prueba', 'Hoy es el último día de tu prueba'])
  })
})

describe('isAccountPaused / accessForUser (DB facts behind a loader)', () => {
  const facts = (f: Partial<AccessFacts>) => async () => ({ householdCreatedAt: NEW_HOUSEHOLD, latestStatus: null, ...f })

  it('before launch day it never reads the DB and never pauses', async () => {
    const load = vi.fn(async () => {
      throw new Error('no DB before launch')
    })
    expect(await isAccountPaused('u1', new Date('2026-12-01T10:00:00Z'), load)).toBe(false)
    expect((await accessForUser('u1', new Date('2026-12-01T10:00:00Z'), load)).state).toBe('beta')
    expect(load).not.toHaveBeenCalled()
  })

  it('after the trial without plan: paused; with a live plan: not', async () => {
    const now = day(15, NEW_HOUSEHOLD)
    expect(await isAccountPaused('u1', now, facts({}))).toBe(true)
    expect(await isAccountPaused('u1', now, facts({ latestStatus: 'trialing' }))).toBe(false)
    expect(await isAccountPaused('u1', now, facts({ latestStatus: 'active' }))).toBe(false)
    expect(await isAccountPaused('u1', now, facts({ latestStatus: 'canceled' }))).toBe(true)
    expect(await isAccountPaused('u1', now, facts({ latestStatus: 'unpaid' }))).toBe(true)
    expect(await isAccountPaused('u1', day(13, NEW_HOUSEHOLD), facts({}))).toBe(false)
  })

  it('a failed read never pauses anyone', async () => {
    const load = async () => {
      throw new Error('db down')
    }
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await isAccountPaused('u1', day(20, NEW_HOUSEHOLD), load)).toBe(false)
    err.mockRestore()
  })
})

const servers: Server[] = []
afterAll(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

describe('requireActiveAccount (402 ACCOUNT_PAUSED)', () => {
  async function serve(paused: boolean, role = 'user') {
    const a = express()
    a.use(express.json())
    a.use((req, _res, next) => {
      Object.assign(req, { userId: 'u1', user: { role } })
      next()
    })
    a.post('/x', requireActiveAccount({ paused: async () => paused, skip: (req) => req.body?.empty === true }), (_req, res) => {
      res.json({ ok: true })
    })
    const server = await new Promise<Server>((resolve) => {
      const s = a.listen(0, '127.0.0.1', () => resolve(s))
    })
    servers.push(server)
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    return (body: unknown = {}) => fetch(`${base}/x`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  }

  it('a paused account is told to choose a plan; nothing is deleted', async () => {
    const r = await (await serve(true))()
    expect(r.status).toBe(402)
    expect(await r.json()).toEqual({ error: ACCOUNT_PAUSED_MESSAGE, code: 'ACCOUNT_PAUSED' })
    expect(ACCOUNT_PAUSED_MESSAGE).toMatch(/No se ha borrado nada/)
  })

  it('an active account, an admin and a skipped request (empty week) go through', async () => {
    expect((await (await serve(false))()).status).toBe(200)
    expect((await (await serve(true, 'admin'))()).status).toBe(200)
    expect((await (await serve(true))({ empty: true })).status).toBe(200)
  })
})

describe('«te quedan 2 días» email (day 12)', () => {
  function memoryRepo(candidates: TrialEmailCandidate[]): TrialEmailRepo & { marked: Set<string> } {
    const marked = new Set<string>()
    return {
      marked,
      async listCandidates() {
        return candidates.filter((c) => !marked.has(c.householdId))
      },
      async claim(id) {
        if (marked.has(id)) return false
        marked.add(id)
        return true
      },
      async unclaim(id) {
        marked.delete(id)
      },
    }
  }
  const candidate: TrialEmailCandidate = { householdId: 'h1', householdCreatedAt: NEW_HOUSEHOLD, ownerEmail: 'ana@example.com' }
  // 11:00 Madrid on day N.
  const dayAt11 = (n: number) => new Date(day(n, new Date('2027-01-10T10:00:00Z')))

  it('the text: last day, prices from the plans, nothing charged or deleted without a plan', () => {
    const access = accountAccess({ householdCreatedAt: NEW_HOUSEHOLD, paid: false, now: dayAt11(12) })
    const m = trialEndingEmail({ email: 'ana@example.com', access, publicUrl: 'https://mimoia.com/' })
    expect(m.to).toBe('ana@example.com')
    expect(m.subject).toBe('Te quedan 2 días de prueba en Mimoia')
    expect(m.text).toContain('dura hasta el 24 de enero, incluido')
    expect(m.text).toContain('Esencial cuesta 4,99 €/mes y Plus 8,99 €/mes')
    expect(m.text).toContain('no se te cobra nada')
    expect(m.text).toContain('no se borra nada')
    expect(m.text).toContain('https://mimoia.com/profile/suscripcion')
    expect(m.html).toContain('Ver los planes')
  })

  it('due on day 12, not on day 11; daytime only', () => {
    expect(isTrialEndingEmailDue(NEW_HOUSEHOLD, dayAt11(11))).toBeNull()
    expect(isTrialEndingEmailDue(NEW_HOUSEHOLD, dayAt11(12))).toMatchObject({ daysLeft: 2 })
    expect(isTrialEndingEmailDue(NEW_HOUSEHOLD, dayAt11(15))).toBeNull()
    expect(isSendingHour(new Date('2027-01-22T08:30:00Z'))).toBe(true)
    expect(isSendingHour(new Date('2027-01-22T23:30:00Z'))).toBe(false)
  })

  it('sent once per household; nothing before launch day; a skipped send (no key) stays pending', async () => {
    const sent: EmailMessage[] = []
    const send = async (m: EmailMessage): Promise<EmailResult> => {
      sent.push(m)
      return { status: 'sent', id: 'x' }
    }
    const repo = memoryRepo([candidate])
    expect(await sendTrialEndingEmails(dayAt11(11), { repo, sendEmail: send, publicUrl: 'https://mimoia.com' })).toEqual({ sent: 0, skipped: 0, failed: 0 })
    expect(await sendTrialEndingEmails(dayAt11(12), { repo, sendEmail: send, publicUrl: 'https://mimoia.com' })).toEqual({ sent: 1, skipped: 0, failed: 0 })
    expect(await sendTrialEndingEmails(dayAt11(13), { repo, sendEmail: send, publicUrl: 'https://mimoia.com' })).toEqual({ sent: 0, skipped: 0, failed: 0 })
    expect(sent).toHaveLength(1)

    const beta = memoryRepo([{ ...candidate, householdCreatedAt: BETA_HOUSEHOLD }])
    const before = await sendTrialEndingEmails(new Date('2026-12-10T10:00:00Z'), { repo: beta, sendEmail: send, publicUrl: 'https://mimoia.com' })
    expect(before).toEqual({ sent: 0, skipped: 0, failed: 0 })
    expect(await sendTrialEndingEmailsIfDue(new Date('2026-12-10T10:00:00Z'), () => ({ repo: beta, sendEmail: send, publicUrl: '' }))).toBeNull()
    // The beta households get it on 26 December (2 days left: the 27th and the 28th).
    expect(await sendTrialEndingEmails(new Date('2026-12-26T10:00:00Z'), { repo: beta, sendEmail: send, publicUrl: 'https://mimoia.com' })).toMatchObject({ sent: 1 })

    const skipRepo = memoryRepo([candidate])
    const skip = async (): Promise<EmailResult> => ({ status: 'skipped', reason: 'not_configured' })
    expect(await sendTrialEndingEmails(dayAt11(12), { repo: skipRepo, sendEmail: skip, publicUrl: '' })).toMatchObject({ skipped: 1 })
    expect(skipRepo.marked.size).toBe(0)
  })
})
