/**
 * PRO-97: one-time invitation links and the single reminder.
 *  - the token: deterministic per entry (the reminder rebuilds the same link),
 *    keyed with the secret, only its hash stored;
 *  - what a link means (ok / used / not found);
 *  - the reminder: at 3 days yes, at 2 no, never twice, not after registering;
 *  - the suggested batch with names and emails (admin view);
 *  - GET /waitlist/invite/:token.
 */
import express from 'express'
import type { RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, describe, expect, it, vi } from 'vitest'
import {
  INVITE_REMINDER_AFTER_MS,
  INVITE_TOKEN_RE,
  hashInviteToken,
  inviteLinkState,
  isInviteReminderDue,
  resetReminderClock,
  sendWaitlistInviteReminders,
  sendWaitlistInviteRemindersIfDue,
  waitlistEntryUrl,
  waitlistInviteToken,
  type ReminderCandidate,
  type ReminderDeps,
  type ReminderRepo,
} from '../services/waitlistInvites.js'
import { waitlistInviteReminderEmail } from '../services/waitlistEmails.js'
import { nextBatchPeople, type NextBatchRow } from '../services/waitlist.js'
import { createWaitlistRouter } from '../routes/waitlist.js'
import { createMemoryWaitlistRepo } from './fixtures/memoryWaitlistRepo.js'

const ID = '3f2a8c1e-0d4b-4c2a-9f1e-2b3c4d5e6f70'
const DAY = 86_400_000

describe('invitation token', () => {
  it('is 43 base64url chars, the same for the same entry, different per entry and per secret', () => {
    const t = waitlistInviteToken(ID, 's1')
    expect(t).toMatch(INVITE_TOKEN_RE)
    expect(waitlistInviteToken(ID, 's1')).toBe(t)
    expect(waitlistInviteToken('3f2a8c1e-0d4b-4c2a-9f1e-2b3c4d5e6f71', 's1')).not.toBe(t)
    expect(waitlistInviteToken(ID, 's2')).not.toBe(t)
  })

  it('stores a hash, never the token', () => {
    const t = waitlistInviteToken(ID, 's1')
    expect(hashInviteToken(t)).toMatch(/^[0-9a-f]{64}$/)
    expect(hashInviteToken(t)).not.toContain(t)
  })

  it('builds /entrar/<token> on the public origin', () => {
    expect(waitlistEntryUrl('https://mimoia.com/', 'abc')).toBe('https://mimoia.com/entrar/abc')
  })
})

describe('inviteLinkState', () => {
  const row = { id: ID, email: 'laura@example.com', firstName: 'Laura', status: 'invited', inviteTokenUsedAt: null }
  it('ok while invited and unused', () => expect(inviteLinkState(row)).toBe('ok'))
  it('used once the account exists (or the link was used)', () => {
    expect(inviteLinkState({ ...row, inviteTokenUsedAt: new Date() })).toBe('used')
    expect(inviteLinkState({ ...row, status: 'joined' })).toBe('used')
  })
  it('not found when unknown, left the list or not invited', () => {
    expect(inviteLinkState(null)).toBe('not_found')
    expect(inviteLinkState({ ...row, status: 'unsubscribed', email: null })).toBe('not_found')
    expect(inviteLinkState({ ...row, status: 'waiting' })).toBe('not_found')
  })
})

// ─── Reminder ────────────────────────────────────────────────────

const NOW = new Date('2026-10-31T10:00:00Z')

function candidate(over: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    id: ID,
    email: 'laura@example.com',
    firstName: 'Laura',
    wantsWhatsapp: false,
    status: 'invited',
    invitedAt: new Date(NOW.getTime() - 3 * DAY),
    inviteTokenHash: 'h',
    inviteTokenUsedAt: null,
    inviteReminderSentAt: null,
    unsubscribeToken: 'unsub-tok',
    ...over,
  }
}

describe('isInviteReminderDue', () => {
  it('at 3 days yes, at 2 days (or 3 days minus a minute) no', () => {
    expect(INVITE_REMINDER_AFTER_MS).toBe(3 * DAY)
    expect(isInviteReminderDue(candidate(), NOW)).toBe(true)
    expect(isInviteReminderDue(candidate({ invitedAt: new Date(NOW.getTime() - 2 * DAY) }), NOW)).toBe(false)
    expect(isInviteReminderDue(candidate({ invitedAt: new Date(NOW.getTime() - 3 * DAY + 60_000) }), NOW)).toBe(false)
  })

  it('never twice, never after registering, never without a link or after leaving', () => {
    expect(isInviteReminderDue(candidate({ inviteReminderSentAt: new Date() }), NOW)).toBe(false)
    expect(isInviteReminderDue(candidate({ inviteTokenUsedAt: new Date() }), NOW)).toBe(false)
    expect(isInviteReminderDue(candidate({ status: 'joined' }), NOW)).toBe(false)
    expect(isInviteReminderDue(candidate({ inviteTokenHash: null }), NOW)).toBe(false)
    expect(isInviteReminderDue(candidate({ status: 'unsubscribed', email: null }), NOW)).toBe(false)
  })
})

/** In-memory repo with the same claim semantics as Postgres (`WHERE reminder IS NULL`). */
function memoryRepo(rows: ReminderCandidate[]): ReminderRepo & { rows: ReminderCandidate[] } {
  return {
    rows,
    async listCandidates(cutoff) {
      return rows.filter(
        (r) => r.status === 'invited' && r.inviteTokenHash && !r.inviteTokenUsedAt && !r.inviteReminderSentAt && r.invitedAt! <= cutoff,
      ).map((r) => ({ ...r }))
    },
    async claim(id, at) {
      const r = rows.find((x) => x.id === id)
      if (!r || r.inviteReminderSentAt) return false
      r.inviteReminderSentAt = at
      return true
    },
    async unclaim(id) {
      const r = rows.find((x) => x.id === id)
      if (r) r.inviteReminderSentAt = null
    },
  }
}

function deps(repo: ReminderRepo, sendEmail: ReminderDeps['sendEmail']): ReminderDeps {
  return {
    repo,
    sendEmail,
    buildEmail: (c, links) => waitlistInviteReminderEmail({ ...c, ...links }),
    publicUrl: 'https://mimoia.com',
    secret: 'test-secret',
  }
}

describe('sendWaitlistInviteReminders', () => {
  it('at 2 days sends nothing; at 3 days one email with the same personal link; never a second one', async () => {
    const repo = memoryRepo([candidate({ invitedAt: new Date(NOW.getTime() - 2 * DAY) })])
    const send = vi.fn(async () => ({ status: 'sent' as const, id: 'em_1' }))

    expect(await sendWaitlistInviteReminders(NOW, deps(repo, send))).toEqual({ sent: 0, skipped: 0, failed: 0 })
    expect(send).not.toHaveBeenCalled()

    const day3 = new Date(NOW.getTime() + DAY)
    expect(await sendWaitlistInviteReminders(day3, deps(repo, send))).toEqual({ sent: 1, skipped: 0, failed: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    const msg = send.mock.calls[0][0] as any
    expect(msg.to).toBe('laura@example.com')
    expect(msg.text).toContain(`https://mimoia.com/entrar/${waitlistInviteToken(ID, 'test-secret')}`)
    expect(msg.text).toContain('https://mimoia.com/lista/baja?t=unsub-tok')
    expect(repo.rows[0].inviteReminderSentAt).toEqual(day3)

    // Next tick, next day: still nothing more.
    await sendWaitlistInviteReminders(new Date(day3.getTime() + DAY), deps(repo, send))
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('does not remind someone who already created the account', async () => {
    const repo = memoryRepo([candidate({ inviteTokenUsedAt: new Date(NOW.getTime() - DAY), status: 'joined' })])
    const send = vi.fn()
    await sendWaitlistInviteReminders(NOW, deps(repo, send))
    expect(send).not.toHaveBeenCalled()
  })

  it('two runs at once: only the one that claims the row sends', async () => {
    const repo = memoryRepo([candidate()])
    const send = vi.fn(async () => ({ status: 'sent' as const, id: null }))
    await Promise.all([sendWaitlistInviteReminders(NOW, deps(repo, send)), sendWaitlistInviteReminders(NOW, deps(repo, send))])
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('a failed send stays marked (never twice); email not configured is unmarked to go out later', async () => {
    const failedRepo = memoryRepo([candidate()])
    await sendWaitlistInviteReminders(NOW, deps(failedRepo, async () => ({ status: 'failed', error: 'boom' })))
    expect(failedRepo.rows[0].inviteReminderSentAt).not.toBeNull()

    const skippedRepo = memoryRepo([candidate()])
    const r = await sendWaitlistInviteReminders(NOW, deps(skippedRepo, async () => ({ status: 'skipped', reason: 'not_configured' })))
    expect(r.skipped).toBe(1)
    expect(skippedRepo.rows[0].inviteReminderSentAt).toBeNull()
  })

  it('from the scheduler: at most once an hour per process', async () => {
    resetReminderClock()
    const repo = memoryRepo([])
    const list = vi.spyOn(repo, 'listCandidates')
    const d = () => deps(repo, vi.fn())
    expect(await sendWaitlistInviteRemindersIfDue(NOW, d)).not.toBeNull()
    expect(await sendWaitlistInviteRemindersIfDue(new Date(NOW.getTime() + 5 * 60_000), d)).toBeNull()
    expect(await sendWaitlistInviteRemindersIfDue(new Date(NOW.getTime() + 61 * 60_000), d)).not.toBeNull()
    expect(list).toHaveBeenCalledTimes(2)
    resetReminderClock()
  })
})

// ─── Suggested batch with people (admin) ─────────────────────────

describe('nextBatchPeople', () => {
  const t = (m: number) => new Date(Date.UTC(2026, 9, 10, 10, m))
  const row = (id: string, over: Partial<NextBatchRow> = {}): NextBatchRow => ({
    id,
    email: `${id}@example.com`,
    firstName: id,
    householdSize: '2',
    plannerRole: 'yo',
    currentMethod: 'improviso',
    platform: 'android',
    wantsWhatsapp: false,
    source: 'directo',
    status: 'waiting',
    referralCode: `code${id}`,
    referredByCode: null,
    createdAt: t(0),
    ...over,
  })

  it('returns name and email in invitation order, flags who comes with their referrer', () => {
    const rows = [
      row('a', { createdAt: t(1) }),
      row('b', { createdAt: t(2), householdSize: '1' }), // not target
      row('c', { createdAt: t(3), referredByCode: 'codea' }),
      row('d', { createdAt: t(0), status: 'invited' }),
    ]
    const out = nextBatchPeople(rows, 10)
    expect(out.people.map((p) => p.id)).toEqual(['a', 'c', 'b'])
    expect(out.people[0]).toMatchObject({ email: 'a@example.com', firstName: 'a', target: true, withReferrer: false })
    expect(out.people[1].withReferrer).toBe(true)
    expect(out.people[2].target).toBe(false)
    expect(out.counts.selected).toBe(3)
  })
})

// ─── GET /waitlist/invite/:token ─────────────────────────────────

const servers: Server[] = []
afterAll(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
})

describe('GET /waitlist/invite/:token', () => {
  const pass: RequestHandler = (_req, _res, next) => next()
  async function serve(findInvite: any) {
    const app = express()
    app.use(express.json())
    app.use(
      createWaitlistRouter({
        repo: createMemoryWaitlistRepo(),
        findInvite,
        publicUrl: () => 'https://mimoia.com',
        signupLimiter: pass,
        readLimiter: pass,
        unsubscribeLimiter: pass,
      }),
    )
    const server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s))
    })
    servers.push(server)
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  }
  const row = { id: ID, email: 'laura@example.com', firstName: 'Laura', status: 'invited', inviteTokenUsedAt: null }

  it('valid → who it is for; opening it does not use it up', async () => {
    const find = vi.fn(async () => row)
    const b = await serve(find)
    for (let i = 0; i < 2; i++) {
      const r = await fetch(`${b}/waitlist/invite/tok`)
      expect(r.status).toBe(200)
      expect(await r.json()).toEqual({ email: 'laura@example.com', firstName: 'Laura' })
    }
  })

  it('used → 410 WAITLIST_INVITE_USED; unknown → 404 WAITLIST_INVITE_NOT_FOUND, in Spanish', async () => {
    const used = await fetch(`${await serve(async () => ({ ...row, inviteTokenUsedAt: new Date() }))}/waitlist/invite/tok`)
    expect(used.status).toBe(410)
    const u = await used.json()
    expect(u.code).toBe('WAITLIST_INVITE_USED')
    expect(u.error).toMatch(/ya se ha usado/)
    const unknown = await fetch(`${await serve(async () => null)}/waitlist/invite/tok`)
    expect(unknown.status).toBe(404)
    expect((await unknown.json()).code).toBe('WAITLIST_INVITE_NOT_FOUND')
  })
})
