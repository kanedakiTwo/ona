/**
 * PRO-1091: «Pregunta única por WhatsApp». The count before sending, never
 * twice to the same household, and BAJA (internal and test accounts too) out.
 */
import { describe, expect, it } from 'vitest'
import {
  inGroup,
  isTestEmail,
  planQuestion,
  previewQuestion,
  questionParam,
  questionTemplate,
  sendQuestion,
  type CandidateHousehold,
  type CandidateMember,
  type QuestionDeps,
  type QuestionFilter,
  type QuestionRecipient,
  type QuestionStore,
} from '../services/whatsapp/oneOffQuestion.js'

const NOW = new Date('2026-11-02T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const FILTER: QuestionFilter = { signedUpFrom: '2026-10-01', signedUpTo: '2026-10-31', inactiveDays: 7 }
const TEXT = '¿Qué es lo que más os cuesta de planificar la semana?'
// Every address here is a test one; only example.com plays «hogar de prueba» in these tests.
const TEST = ['example.com']

let n = 0
function member(over: Partial<CandidateMember> = {}): CandidateMember {
  n++
  return {
    userId: `u${n}`,
    email: `persona${n}@example.org`,
    role: 'user',
    suspended: false,
    isOwner: true,
    joinedAt: new Date('2026-10-10T10:00:00Z'),
    link: { phone: `3460000${n}`, saidNo: false },
    ...over,
  }
}
function household(id: string, members: CandidateMember[], over: Partial<CandidateHousehold> = {}): CandidateHousehold {
  return { householdId: id, createdAt: new Date('2026-10-10T10:00:00Z'), lastActivityAt: new Date(NOW.getTime() - 10 * DAY), members, ...over }
}

/** The group of the tests: 3 who get it, and one of each reason to leave a household out. */
function group(): CandidateHousehold[] {
  return [
    household('h-ok-1', [member()]),
    household('h-ok-2', [member(), member({ isOwner: false, link: null })]),
    // The owner said BAJA, a member didn't: it goes to the member.
    household('h-ok-3', [member({ link: { phone: '34611', saidNo: true } }), member({ isOwner: false, userId: 'u-member' })]),
    household('h-baja', [member({ link: { phone: '34622', saidNo: true } })]),
    household('h-admin', [member({ role: 'admin' })]),
    household('h-adminemail', [member({ email: 'Equipo@example.org' })]),
    household('h-prueba', [member({ email: 'laura@example.com' })]),
    household('h-sinwa', [member({ link: null })]),
    household('h-activo', [member()], { lastActivityAt: new Date(NOW.getTime() - 2 * DAY) }),
    household('h-septiembre', [member()], { createdAt: new Date('2026-09-20T10:00:00Z') }),
  ]
}

function memoryStore(households: CandidateHousehold[]) {
  const sends: Array<{ questionId: string; status: string } & QuestionRecipient> = []
  const questions = new Map<string, string>()
  const store: QuestionStore = {
    loadCandidates: async () => households,
    sentHouseholds: async (text) => new Set(sends.filter((s) => s.questionId === questions.get(text)).map((s) => s.householdId)),
    ensureQuestion: async (text) => {
      if (!questions.has(text)) questions.set(text, `q${questions.size + 1}`)
      return questions.get(text)!
    },
    claimSend: async (questionId, r) => {
      if (sends.some((s) => s.questionId === questionId && s.householdId === r.householdId)) return null
      sends.push({ questionId, status: 'sent', ...r })
      return `s${sends.length}`
    },
    markFailed: async (sendId) => {
      sends[Number(sendId.slice(1)) - 1].status = 'failed'
    },
    list: async () => [],
  }
  return { store, sends }
}

function deps(store: QuestionStore, sent: string[], over: Partial<QuestionDeps> = {}): QuestionDeps {
  return {
    store,
    now: NOW,
    template: 'mimoia_pregunta_unica',
    configured: true,
    isPaused: async () => false,
    adminEmails: [],
    testDomains: TEST,
    sendTemplate: async (phone) => {
      sent.push(phone)
      return `wamid.${phone}`
    },
    recordOutbound: async () => {},
    ...over,
  }
}

describe('the group and its count', () => {
  it('counts one person per household and says why the rest are out', () => {
    const plan = planQuestion(group(), { filter: FILTER, now: NOW, alreadySent: new Set(), allowed: () => true, adminEmails: ['equipo@example.org'], testDomains: TEST })
    expect(plan.recipients.map((r) => r.householdId)).toEqual(['h-ok-1', 'h-ok-2', 'h-ok-3'])
    expect(plan.recipients[2].userId).toBe('u-member')
    expect(plan.excluded).toEqual({ ya_enviada: 0, baja: 1, interna: 2, prueba: 1, sin_whatsapp: 1 })
  })

  it('whoever asked BAJA never gets it', () => {
    const plan = planQuestion(group(), { filter: FILTER, now: NOW, alreadySent: new Set(), allowed: () => true, adminEmails: [], testDomains: TEST })
    const phones = plan.recipients.map((r) => r.phone)
    expect(phones).not.toContain('34611')
    expect(phones).not.toContain('34622')
  })

  it('sign-up dates are Madrid days, both ends included; 0 days = any activity', () => {
    const h = { createdAt: new Date('2026-10-31T23:30:00Z'), lastActivityAt: NOW } // 1 Nov, 00:30 in Madrid
    expect(inGroup(h, { ...FILTER, inactiveDays: 0 }, NOW)).toBe(false)
    expect(inGroup(h, { ...FILTER, signedUpTo: '2026-11-01', inactiveDays: 0 }, NOW)).toBe(true)
    expect(inGroup(h, { ...FILTER, signedUpTo: '2026-11-01', inactiveDays: 1 }, NOW)).toBe(false)
    expect(inGroup({ ...h, lastActivityAt: null }, { ...FILTER, signedUpTo: '2026-11-01', inactiveDays: 30 }, NOW)).toBe(true)
  })

  it('paused, suspended and not-allowed accounts are skipped', () => {
    const hs = [
      household('h-paused', [member({ userId: 'p1' })]),
      household('h-susp', [member({ suspended: true })]),
      household('h-notallowed', [member({ email: 'fuera@example.org' })]),
    ]
    const plan = planQuestion(hs, { filter: FILTER, now: NOW, alreadySent: new Set(), paused: new Set(['p1']), allowed: (e) => e !== 'fuera@example.org', adminEmails: [], testDomains: TEST })
    expect(plan.recipients).toEqual([])
    expect(plan.excluded.sin_whatsapp).toBe(3)
  })

  it('test households: reserved test domains (exact or «.suffix») and the mail sink ones', () => {
    expect(isTestEmail('laura@example.com')).toBe(true)
    expect(isTestEmail('x@example.org')).toBe(true)
    expect(isTestEmail('x@example.org', ['example.com'])).toBe(false)
    expect(isTestEmail('x@mail.example.org', ['.example.org'])).toBe(true)
    expect(isTestEmail('x@example.com', ['example.org'])).toBe(false)
  })
})

describe('preview and send', () => {
  it('the preview gives the count the button will send', async () => {
    const { store } = memoryStore(group())
    const p = await previewQuestion(TEXT, FILTER, deps(store, []))
    // h-adminemail only counts as internal with ADMIN_EMAILS set; here it's an ordinary household.
    expect(p.count).toBe(4)
    expect(p.template).toBe('mimoia_pregunta_unica')
  })

  it('sends once per household: a second press (or the same text again) sends nothing', async () => {
    const { store, sends } = memoryStore(group())
    const sent: string[] = []
    const d = deps(store, sent)
    const first = await sendQuestion(TEXT, FILTER, 4, 'admin', d)
    expect(first).toMatchObject({ status: 'sent', sent: 4, failed: 0, skipped: 0, remaining: 0 })
    expect(new Set(sends.map((s) => s.householdId)).size).toBe(4)

    const again = await previewQuestion(`  ${TEXT}\n`, FILTER, d)
    expect(again.count).toBe(0)
    expect(again.excluded.ya_enviada).toBe(4)
    expect(await sendQuestion(TEXT, FILTER, 0, 'admin', d)).toMatchObject({ status: 'sent', sent: 0 })
    expect(sent).toHaveLength(4)
  })

  it('two presses at the same time still send once per household (claimed before sending)', async () => {
    const { store } = memoryStore(group())
    const sent: string[] = []
    const d = deps(store, sent)
    const [a, b] = await Promise.all([sendQuestion(TEXT, FILTER, 4, 'admin', d), sendQuestion(TEXT, FILTER, 4, 'admin', d)])
    expect(sent).toHaveLength(4)
    expect(new Set(sent).size).toBe(4)
    expect([a, b].map((o) => (o.status === 'sent' ? o.sent + o.skipped : -1))).toEqual([4, 4])
  })

  it('a different question can go to the same households', async () => {
    const { store } = memoryStore(group())
    const sent: string[] = []
    await sendQuestion(TEXT, FILTER, 4, 'admin', deps(store, sent))
    const other = await sendQuestion('¿Qué cenasteis ayer en casa?', FILTER, 4, 'admin', deps(store, sent))
    expect(other).toMatchObject({ status: 'sent', sent: 4 })
  })

  it('nothing goes out when the count changed, without the template or without WhatsApp', async () => {
    const { store } = memoryStore(group())
    const sent: string[] = []
    expect(await sendQuestion(TEXT, FILTER, 3, 'admin', deps(store, sent))).toEqual({ status: 'count_changed', count: 4 })
    expect(await sendQuestion(TEXT, FILTER, 4, 'admin', deps(store, sent, { template: null }))).toEqual({ status: 'unavailable', reason: 'no_template' })
    expect(await sendQuestion(TEXT, FILTER, 4, 'admin', deps(store, sent, { configured: false }))).toEqual({ status: 'unavailable', reason: 'not_configured' })
    expect(sent).toEqual([])
  })

  it('a failed send is recorded and not retried', async () => {
    const { store, sends } = memoryStore([household('h1', [member({ link: { phone: '34699', saidNo: false } })])])
    const out = await sendQuestion(TEXT, FILTER, 1, 'admin', deps(store, [], { sendTemplate: async () => { throw new Error('Meta 131047') } }))
    expect(out).toMatchObject({ status: 'sent', sent: 0, failed: 1 })
    expect(sends[0].status).toBe('failed')
    expect((await previewQuestion(TEXT, FILTER, deps(store, []))).count).toBe(0)
  })

  it('the template parameter is one line; the template comes from WHATSAPP_TEMPLATES', () => {
    expect(questionParam(' ¿Qué tal?\n\nCuéntanos  algo. ')).toBe('¿Qué tal? Cuéntanos algo.')
    expect(questionTemplate('{"pregunta_unica":"mimoia_pregunta_unica","alert":"x"}')).toBe('mimoia_pregunta_unica')
    expect(questionTemplate('{"alert":"x"}')).toBeNull()
    expect(questionTemplate('')).toBeNull()
  })
})
