/**
 * Pre-launch waitlist (specs/waitlist.md) — pure logic, no database:
 *
 *   - referral code / opt-out token generators
 *   - the target segment and the suggested next batch (who enters first)
 *   - the admin report aggregation
 *   - the shared zod schema + the form's payload builder (contract)
 *   - the signup service against an in-memory repo (idempotency, referrals)
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_WAITLIST_FORM,
  REFERRAL_CODE_RE,
  buildWaitlistPayload,
  isWaitlistFormComplete,
  readWaitlistAttribution,
  waitlistReferralUrl,
  waitlistShareText,
  waitlistSignupSchema,
  whatsappShareHref,
  type WaitlistFormState,
} from '@ona/shared'
import {
  buildWaitlistReport,
  generateReferralCode,
  generateUnsubscribeToken,
  isTargetSegment,
  signupToWaitlist,
  suggestNextBatch,
  type RankableEntry,
  type WaitlistReportRow,
} from '../services/waitlist.js'
import { createMemoryWaitlistRepo } from './fixtures/memoryWaitlistRepo.js'

// ─── Generators ──────────────────────────────────────────────────

describe('generateReferralCode', () => {
  it('encodes 40 random bits as 8 lowercase base32 chars', () => {
    expect(generateReferralCode(new Uint8Array([0, 0, 0, 0, 0]))).toBe('00000000')
    expect(generateReferralCode(new Uint8Array([255, 255, 255, 255, 255]))).toBe('zzzzzzzz')
    // 0b00001 00010 00011 00100 00101 00110 00111 01000 → 1 2 3 4 5 6 7 8
    expect(generateReferralCode(new Uint8Array([0x08, 0x86, 0x42, 0x98, 0xe8]))).toBe('12345678')
  })

  it('only uses the URL-safe alphabet without look-alikes (no i, l, o, u)', () => {
    for (let i = 0; i < 200; i++) {
      const code = generateReferralCode()
      expect(code).toMatch(REFERRAL_CODE_RE)
      expect(code).not.toMatch(/[ilou]/)
    }
  })

  it('is random: 500 codes, no repeats', () => {
    const codes = new Set(Array.from({ length: 500 }, () => generateReferralCode()))
    expect(codes.size).toBe(500)
  })

  it('rejects a byte source of the wrong size', () => {
    expect(() => generateReferralCode(new Uint8Array(4))).toThrow()
  })
})

describe('generateUnsubscribeToken', () => {
  it('is long, URL-safe and unique', () => {
    const a = generateUnsubscribeToken()
    const b = generateUnsubscribeToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    expect(a).not.toBe(b)
  })
})

// ─── Target segment + next batch ─────────────────────────────────

let seq = 0
function entry(over: Partial<RankableEntry> = {}): RankableEntry {
  seq += 1
  const id = over.id ?? `e${String(seq).padStart(3, '0')}`
  return {
    id,
    householdSize: '2',
    plannerRole: 'yo',
    currentMethod: 'improviso',
    status: 'waiting',
    referralCode: `code${String(seq).padStart(4, '0')}`,
    referredByCode: null,
    createdAt: new Date(Date.UTC(2026, 9, 16, 9, 0, seq)),
    ...over,
  }
}

describe('isTargetSegment', () => {
  it('households of 2 or more where the person plans (alone or shared) and cooks at home', () => {
    expect(isTargetSegment(entry({ householdSize: '2', plannerRole: 'yo' }))).toBe(true)
    expect(isTargetSegment(entry({ householdSize: '3-4', plannerRole: 'compartido' }))).toBe(true)
    expect(isTargetSegment(entry({ householdSize: '5+', plannerRole: 'yo', currentMethod: 'menu_fijo' }))).toBe(true)
  })

  it('excludes single households, people who do not plan, and people who barely cook', () => {
    expect(isTargetSegment(entry({ householdSize: '1' }))).toBe(false)
    expect(isTargetSegment(entry({ plannerRole: 'otra_persona' }))).toBe(false)
    expect(isTargetSegment(entry({ currentMethod: 'no_cocino' }))).toBe(false)
  })
})

describe('suggestNextBatch', () => {
  it('puts the target segment first, whatever the signup order', () => {
    const early = entry({ id: 'solo-early', householdSize: '1' })
    const late = entry({ id: 'family-late', householdSize: '3-4' })
    expect(suggestNextBatch([early, late], 10).ids).toEqual(['family-late', 'solo-early'])
  })

  it('within a tier, people who brought others go first, then earliest signup', () => {
    const a = entry({ id: 'a' })
    const b = entry({ id: 'b' })
    const c = entry({ id: 'c', referralCode: 'cccccccc' })
    // d signed up with c's link (d is single → not target, lands after the target tier)
    const d = entry({ id: 'd', householdSize: '1', referredByCode: 'cccccccc' })
    const { ids } = suggestNextBatch([a, b, c, d], 3)
    expect(ids).toEqual(['c', 'd', 'a'])
  })

  it('pulls the household along: people who used the link come right after the referrer', () => {
    const r = entry({ id: 'referrer', referralCode: 'rrrrrrrr' })
    const other = entry({ id: 'other' })
    const mate = entry({ id: 'mate', plannerRole: 'otra_persona', referredByCode: 'rrrrrrrr' })
    const res = suggestNextBatch([other, mate, r], 10)
    expect(res.ids).toEqual(['referrer', 'mate', 'other'])
    expect(res.counts.pulledInByReferrer).toBe(1)
  })

  it('keeps referral chains together (A invited B, B invited C)', () => {
    const a = entry({ id: 'A', referralCode: 'aaaaaaaa' })
    const b = entry({ id: 'B', householdSize: '1', referralCode: 'bbbbbbbb', referredByCode: 'aaaaaaaa' })
    const c = entry({ id: 'C', householdSize: '1', referredByCode: 'bbbbbbbb' })
    const x = entry({ id: 'X' })
    expect(suggestNextBatch([x, c, b, a], 10).ids).toEqual(['A', 'B', 'C', 'X'])
  })

  it('someone whose referrer is already in gets priority to join them', () => {
    const inviter = entry({ id: 'inviter', status: 'invited', referralCode: 'iiiiiiii' })
    const early = entry({ id: 'early' })
    const joiner = entry({ id: 'joiner', referredByCode: 'iiiiiiii' })
    expect(suggestNextBatch([inviter, early, joiner], 10).ids).toEqual(['joiner', 'early'])
  })

  it('only suggests waiting entries, and unsubscribed referees do not count as referrals', () => {
    const r = entry({ id: 'r', referralCode: 'rrrrrrrr' })
    const gone = entry({ id: 'gone', status: 'unsubscribed', referredByCode: 'rrrrrrrr' })
    const first = entry({ id: 'first', createdAt: new Date(Date.UTC(2026, 9, 1)) })
    const invited = entry({ id: 'invited', status: 'invited' })
    const joined = entry({ id: 'joined', status: 'joined' })
    const { ids } = suggestNextBatch([r, gone, first, invited, joined], 10)
    expect(ids).toEqual(['first', 'r'])
  })

  it('caps the batch at the requested size, even mid-household', () => {
    const r = entry({ id: 'r', referralCode: 'rrrrrrrr' })
    const m1 = entry({ id: 'm1', referredByCode: 'rrrrrrrr' })
    const m2 = entry({ id: 'm2', referredByCode: 'rrrrrrrr' })
    const res = suggestNextBatch([r, m1, m2, entry()], 2)
    expect(res.ids).toEqual(['r', 'm1'])
    expect(res.size).toBe(2)
  })

  it('reports counts, ids only (no personal data)', () => {
    const r = entry({ id: 'r', referralCode: 'rrrrrrrr' })
    const m = entry({ id: 'm', householdSize: '1', referredByCode: 'rrrrrrrr' })
    const s = entry({ id: 's', householdSize: '1' })
    const res = suggestNextBatch([r, m, s], 10)
    expect(res.counts).toEqual({
      waiting: 3,
      waitingInTarget: 1,
      selected: 3,
      selectedInTarget: 1,
      selectedReferrers: 1,
      pulledInByReferrer: 1,
    })
    expect(Object.keys(res).sort()).toEqual(['counts', 'ids', 'size'])
  })

  it('is deterministic on ties (same second → by id)', () => {
    const at = new Date(Date.UTC(2026, 9, 20))
    const res = suggestNextBatch([entry({ id: 'b', createdAt: at }), entry({ id: 'a', createdAt: at })], 10)
    expect(res.ids).toEqual(['a', 'b'])
  })
})

// ─── Admin report ────────────────────────────────────────────────

function row(over: Partial<WaitlistReportRow> = {}): WaitlistReportRow {
  return {
    ...entry(over),
    platform: 'android',
    wantsWhatsapp: false,
    newsletterOptIn: false,
    source: 'directo',
    utmSource: null,
    utmMedium: null,
    utmCampaign: null,
    batch: null,
    ...over,
  }
}

describe('buildWaitlistReport', () => {
  const now = new Date('2026-10-21T10:00:00Z')

  it('totals, status counts and signups per Madrid day (zero-filled)', () => {
    const rows = [
      // 23:30 UTC on the 18th is already the 19th in Madrid (UTC+2).
      row({ createdAt: new Date('2026-10-18T23:30:00Z') }),
      row({ createdAt: new Date('2026-10-19T08:00:00Z'), status: 'invited', batch: 1 }),
      row({ createdAt: new Date('2026-10-21T08:00:00Z'), status: 'unsubscribed', wantsWhatsapp: true }),
      row({ createdAt: new Date('2026-10-01T08:00:00Z'), wantsWhatsapp: true, status: 'joined', batch: 1, newsletterOptIn: true }),
    ]
    const r = buildWaitlistReport(rows, { now, days: 4, batchSize: 20 })
    expect(r.totals).toMatchObject({ entries: 4, active: 3, last7Days: 3, wantsWhatsapp: 1, newsletterOptIns: 1 })
    expect(r.status).toEqual({ waiting: 1, invited: 1, joined: 1, unsubscribed: 1 })
    expect(r.byDay).toEqual([
      { day: '2026-10-18', signups: 0 },
      { day: '2026-10-19', signups: 2 },
      { day: '2026-10-20', signups: 0 },
      { day: '2026-10-21', signups: 1 },
    ])
    expect(r.batches).toEqual([{ batch: 1, size: 2, joined: 1, unsubscribed: 0 }])
  })

  it('segments and sources count active entries only', () => {
    const rows = [
      row({ householdSize: '2', plannerRole: 'yo', currentMethod: 'lista', source: 'menu', utmSource: 'ig', utmCampaign: 'otono' }),
      row({ householdSize: '2', plannerRole: 'yo', currentMethod: 'lista', source: 'menu', utmSource: 'ig', utmCampaign: 'otono' }),
      row({ householdSize: '1', plannerRole: 'yo', currentMethod: 'app', platform: 'ios' }),
      row({ householdSize: '5+', status: 'unsubscribed', source: 'receta' }),
    ]
    const r = buildWaitlistReport(rows, { now, days: 30, batchSize: 20 })
    expect(r.segments.householdSize).toEqual({ '1': 1, '2': 2, '3-4': 0, '5+': 0 })
    expect(r.segments.platform).toEqual({ ios: 1, android: 2, otro: 0 })
    expect(r.segments.cross[0]).toEqual({ householdSize: '2', plannerRole: 'yo', currentMethod: 'lista', count: 2, target: true })
    expect(r.sources.bySource).toEqual([{ source: 'menu', count: 2 }, { source: 'directo', count: 1 }])
    expect(r.sources.byUtm).toEqual([
      { utmSource: 'ig', utmMedium: null, utmCampaign: 'otono', count: 2 },
      { utmSource: null, utmMedium: null, utmCampaign: null, count: 1 },
    ])
    expect(r.totals.inTargetSegment).toBe(2)
  })

  it('referral stats by code only, top referrers first', () => {
    const rows = [
      row({ referralCode: 'aaaaaaaa' }),
      row({ referralCode: 'bbbbbbbb' }),
      row({ referredByCode: 'bbbbbbbb' }),
      row({ referredByCode: 'bbbbbbbb' }),
      row({ referredByCode: 'aaaaaaaa' }),
      row({ referredByCode: 'aaaaaaaa', status: 'unsubscribed' }),
    ]
    const r = buildWaitlistReport(rows, { now, days: 30, batchSize: 20 })
    expect(r.referrals).toEqual({
      referredSignups: 3,
      referrers: 2,
      topReferrers: [{ code: 'bbbbbbbb', count: 2 }, { code: 'aaaaaaaa', count: 1 }],
    })
    expect(r.totals.referredSignups).toBe(3)
  })

  it('includes the suggested next batch and never an email', () => {
    const rows = [row({ id: 'x1' }), row({ id: 'x2', householdSize: '1' })]
    const r = buildWaitlistReport(rows, { now, days: 30, batchSize: 1 })
    expect(r.suggestedNextBatch.ids).toEqual(['x1'])
    expect(JSON.stringify(r)).not.toMatch(/@/)
  })
})

// ─── Shared schema + form contract ───────────────────────────────

const FILLED: WaitlistFormState = {
  ...EMPTY_WAITLIST_FORM,
  email: '  Lucia@Example.COM ',
  firstName: ' Lucía ',
  householdSize: '3-4',
  plannerRole: 'compartido',
  currentMethod: 'lista',
  platform: 'ios',
  supermarket: ' El mercado del barrio ',
  wantsWhatsapp: true,
  consent: true,
}

const NO_ATTRIBUTION = readWaitlistAttribution(new URLSearchParams(''))

describe('waitlistSignupSchema', () => {
  it('accepts the payload the landing form builds (contract) and normalises it', () => {
    const parsed = waitlistSignupSchema.parse(buildWaitlistPayload(FILLED, NO_ATTRIBUTION))
    expect(parsed).toMatchObject({
      email: 'lucia@example.com',
      firstName: 'Lucía',
      householdSize: '3-4',
      plannerRole: 'compartido',
      currentMethod: 'lista',
      platform: 'ios',
      supermarket: 'El mercado del barrio',
      wantsWhatsapp: true,
      consent: true,
      source: 'directo',
      referredByCode: null,
    })
  })

  it('rejects a bad email', () => {
    for (const email of ['', 'lucia', 'lucia@', '@example.com', 'a b@example.com']) {
      expect(waitlistSignupSchema.safeParse(buildWaitlistPayload({ ...FILLED, email }, NO_ATTRIBUTION)).success).toBe(false)
    }
  })

  it('rejects a missing consent', () => {
    const r = waitlistSignupSchema.safeParse(buildWaitlistPayload({ ...FILLED, consent: false }, NO_ATTRIBUTION))
    expect(r.success).toBe(false)
  })

  it('rejects a filled honeypot', () => {
    const r = waitlistSignupSchema.safeParse(buildWaitlistPayload({ ...FILLED, website: 'http://spam.example' }, NO_ATTRIBUTION))
    expect(r.success).toBe(false)
  })

  it('rejects unanswered or invented answers', () => {
    expect(waitlistSignupSchema.safeParse(buildWaitlistPayload(EMPTY_WAITLIST_FORM, NO_ATTRIBUTION)).success).toBe(false)
    const bad = { ...buildWaitlistPayload(FILLED, NO_ATTRIBUTION), householdSize: '7' }
    expect(waitlistSignupSchema.safeParse(bad).success).toBe(false)
  })

  it('the newsletter opt-in is separate and off by default', () => {
    expect(EMPTY_WAITLIST_FORM.newsletterOptIn).toBe(false)
    const { newsletterOptIn: _omit, ...withoutField } = buildWaitlistPayload(FILLED, NO_ATTRIBUTION)
    expect(waitlistSignupSchema.parse(withoutField).newsletterOptIn).toBe(false)
    // Opting in to the newsletter never stands in for the waitlist consent.
    const r = waitlistSignupSchema.safeParse(buildWaitlistPayload({ ...FILLED, consent: false, newsletterOptIn: true }, NO_ATTRIBUTION))
    expect(r.success).toBe(false)
  })

  it('takes no health data: unknown keys (allergies…) are dropped', () => {
    const parsed = waitlistSignupSchema.parse({ ...buildWaitlistPayload(FILLED, NO_ATTRIBUTION), allergies: ['gluten'] })
    expect(parsed).not.toHaveProperty('allergies')
  })

  it('never fails a signup over attribution: bad ref/invita/utm are cleaned or dropped', () => {
    const parsed = waitlistSignupSchema.parse({
      ...buildWaitlistPayload(FILLED, NO_ATTRIBUTION),
      source: 'NOT A SLUG!!',
      referredByCode: 'xx',
      utmSource: `ig\u0000${'x'.repeat(300)}`,
    })
    expect(parsed.source).toBe('directo')
    expect(parsed.referredByCode).toBeNull()
    expect(parsed.utmSource).toHaveLength(100)
    expect(parsed.utmSource).not.toContain('\u0000')
  })
})

describe('form helpers', () => {
  it('isWaitlistFormComplete needs email, the four answers and consent (not the optional fields)', () => {
    expect(isWaitlistFormComplete(FILLED)).toBe(true)
    expect(isWaitlistFormComplete({ ...FILLED, firstName: '', supermarket: '', wantsWhatsapp: false })).toBe(true)
    expect(isWaitlistFormComplete({ ...FILLED, platform: '' })).toBe(false)
    expect(isWaitlistFormComplete({ ...FILLED, consent: false })).toBe(false)
  })

  it('readWaitlistAttribution reads ?ref, ?utm_* and ?invita from the landing URL', () => {
    expect(readWaitlistAttribution(new URLSearchParams('?ref=Receta&utm_source=instagram&utm_medium=bio&utm_campaign=otono&invita=ABCD2345'))).toEqual({
      source: 'receta',
      referredByCode: 'abcd2345',
      utmSource: 'instagram',
      utmMedium: 'bio',
      utmCampaign: 'otono',
    })
    expect(readWaitlistAttribution(new URLSearchParams('?invita=abcd2345')).source).toBe('invita')
    expect(readWaitlistAttribution(new URLSearchParams('?invita=nope')).referredByCode).toBeNull()
  })

  it('share text + WhatsApp link carry the referral URL and no health claims', () => {
    const url = waitlistReferralUrl('https://mimoia.com/', 'abcd2345')
    expect(url).toBe('https://mimoia.com/?invita=abcd2345')
    const text = waitlistShareText(url)
    expect(text).toContain('Mimoia')
    expect(text.endsWith(url)).toBe(true)
    expect(whatsappShareHref(text)).toBe(`https://wa.me/?text=${encodeURIComponent(text)}`)
    expect(text).not.toMatch(/adelgaza|salud|peso|cura|previene/i)
  })
})

// ─── Signup service (in-memory repo) ─────────────────────────────

function signupInput(over: Record<string, unknown> = {}) {
  return waitlistSignupSchema.parse({ ...buildWaitlistPayload(FILLED, NO_ATTRIBUTION), ...over })
}

describe('signupToWaitlist', () => {
  const deps = (repo = createMemoryWaitlistRepo()) => ({ repo, publicUrl: 'https://mimoia.com', now: () => new Date('2026-10-20T10:00:00Z') })

  it('creates an entry with a referral link and hands out the opt-out token once', async () => {
    const d = deps()
    const res = await signupToWaitlist(signupInput(), d)
    expect(res.code).toMatch(REFERRAL_CODE_RE)
    expect(res.referralUrl).toBe(`https://mimoia.com/?invita=${res.code}`)
    expect(res.referredCount).toBe(0)
    expect(res.unsubscribeToken).toMatch(/^[A-Za-z0-9_-]{32,}$/)
    const stored = d.repo.rows[0]
    expect(stored).toMatchObject({ email: 'lucia@example.com', status: 'waiting', consentVersion: '2026-10-07', source: 'directo' })
    expect(stored.consentAt.toISOString()).toBe('2026-10-20T10:00:00.000Z')
  })

  it('newsletter: no consent stored unless opted in; stored with time + version when it is', async () => {
    const d = deps()
    await signupToWaitlist(signupInput({ email: 'no@example.com' }), d)
    await signupToWaitlist(signupInput({ email: 'si@example.com', newsletterOptIn: true }), d)
    expect(d.repo.rows[0]).toMatchObject({ newsletterOptIn: false, newsletterConsentAt: null, newsletterConsentVersion: null })
    expect(d.repo.rows[1]).toMatchObject({ newsletterOptIn: true, newsletterConsentVersion: '2026-10-07' })
    expect(d.repo.rows[1].newsletterConsentAt?.toISOString()).toBe('2026-10-20T10:00:00.000Z')
  })

  it('is idempotent on email: same link back, nothing changed, no opt-out token', async () => {
    const d = deps()
    const first = await signupToWaitlist(signupInput(), d)
    const again = await signupToWaitlist(signupInput({ email: 'LUCIA@example.com', householdSize: '1', supermarket: 'otro' }), d)
    expect(again).toEqual({ code: first.code, referralUrl: first.referralUrl, referredCount: 0 })
    expect(d.repo.rows).toHaveLength(1)
    expect(d.repo.rows[0].householdSize).toBe('3-4')
  })

  it('attributes a valid referral and counts it for the referrer', async () => {
    const d = deps()
    const owner = await signupToWaitlist(signupInput(), d)
    await signupToWaitlist(signupInput({ email: 'pareja@example.com', referredByCode: owner.code.toUpperCase() }), d)
    expect(d.repo.rows[1].referredByCode).toBe(owner.code)
    const again = await signupToWaitlist(signupInput(), d)
    expect(again.referredCount).toBe(1)
  })

  it('ignores a referral code that does not exist (or whose owner left)', async () => {
    const d = deps()
    await signupToWaitlist(signupInput({ email: 'x@example.com', referredByCode: 'zzzzzzzz' }), d)
    expect(d.repo.rows[0].referredByCode).toBeNull()
  })

  it('retries on a referral code collision', async () => {
    const d = deps()
    d.repo.forceCodeCollisions = 2
    const res = await signupToWaitlist(signupInput(), d)
    expect(res.code).toMatch(REFERRAL_CODE_RE)
    expect(d.repo.rows).toHaveLength(1)
  })

  it('a concurrent duplicate email (unique violation) answers like a repeat submission', async () => {
    const d = deps()
    const first = await signupToWaitlist(signupInput(), d)
    d.repo.hideEmailOnNextLookup = true // the lookup misses, the insert hits the unique index
    const again = await signupToWaitlist(signupInput(), d)
    expect(again).toEqual({ code: first.code, referralUrl: first.referralUrl, referredCount: 0 })
  })
})
