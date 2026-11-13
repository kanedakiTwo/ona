/**
 * PRO-1197: «Pregunta por correo». Who gets the email (each of the five cases
 * out: active, internal, test, suspended, BAJA / «No, gracias»), the exact
 * count before sending, and a second press that sends nothing.
 */
import { describe, expect, it } from 'vitest'
import {
  QUESTION_FOOTER,
  QUESTION_FROM_NAME,
  QUESTION_SUBJECT,
  cleanBody,
  leftTheBeta,
  planEmailQuestion,
  previewEmailQuestion,
  questionMessage,
  renderQuestionEmail,
  sendEmailQuestion,
  type EmailCandidateHousehold,
  type EmailCandidateMember,
  type EmailQuestionDeps,
  type EmailQuestionRecipient,
  type EmailQuestionStore,
} from '../services/emailQuestion.js'
import type { EmailMessage } from '../services/email.js'

const NOW = new Date('2026-11-13T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
// Every address here is a test one; only example.com plays «hogar de prueba» in these tests.
const TEST = ['example.com']

let n = 0
function member(over: Partial<EmailCandidateMember> = {}): EmailCandidateMember {
  n++
  return {
    userId: `u${n}`,
    email: `persona${n}@example.org`,
    username: `persona${n}`,
    waitlistName: null,
    role: 'user',
    suspended: false,
    isOwner: true,
    joinedAt: new Date('2026-10-01T10:00:00Z'),
    saidNo: false,
    ...over,
  }
}
function household(id: string, members: EmailCandidateMember[], over: Partial<EmailCandidateHousehold> = {}): EmailCandidateHousehold {
  return { householdId: id, createdAt: new Date('2026-10-01T10:00:00Z'), lastActivityAt: new Date(NOW.getTime() - 20 * DAY), members, ...over }
}

/** Two that get it, and one household for each reason to leave one out. */
function group(): EmailCandidateHousehold[] {
  return [
    household('h-ok-1', [member({ waitlistName: 'lucía' })]),
    household('h-ok-never', [member()], { lastActivityAt: null }),
    household('h-active', [member()], { lastActivityAt: new Date(NOW.getTime() - 3 * DAY) }),
    household('h-new', [member()], { createdAt: new Date(NOW.getTime() - 5 * DAY), lastActivityAt: null }),
    household('h-internal', [member(), member({ isOwner: false, role: 'admin' })]),
    household('h-test', [member({ email: 'alguien@example.com' })]),
    household('h-suspended', [member({ suspended: true })]),
    household('h-baja', [member(), member({ isOwner: false, saidNo: true })]),
  ]
}

const ctx = (alreadySent: Iterable<string> = []) => ({ now: NOW, alreadySent: new Set(alreadySent), adminEmails: [] as string[], testDomains: TEST })

describe('leftTheBeta', () => {
  it('needs 14 days without activity and a household at least that old', () => {
    const old = new Date(NOW.getTime() - 30 * DAY)
    expect(leftTheBeta({ createdAt: old, lastActivityAt: new Date(NOW.getTime() - 14 * DAY) }, NOW)).toBe(true)
    expect(leftTheBeta({ createdAt: old, lastActivityAt: new Date(NOW.getTime() - 13 * DAY) }, NOW)).toBe(false)
    expect(leftTheBeta({ createdAt: old, lastActivityAt: null }, NOW)).toBe(true)
    expect(leftTheBeta({ createdAt: new Date(NOW.getTime() - 10 * DAY), lastActivityAt: null }, NOW)).toBe(false)
  })
})

describe('planEmailQuestion', () => {
  it('keeps out each of the five cases and counts why', () => {
    const plan = planEmailQuestion(group(), ctx())
    expect(plan.recipients.map((r) => r.householdId)).toEqual(['h-ok-1', 'h-ok-never'])
    expect(plan.excluded).toEqual({ activo: 2, interna: 1, prueba: 1, suspendida: 1, baja: 1, ya_enviada: 0 })
  })

  it.each([
    ['active', household('x', [member()], { lastActivityAt: new Date(NOW.getTime() - 1 * DAY) }), 'activo'],
    ['internal by role', household('x', [member({ role: 'admin' })]), 'interna'],
    ['internal by ADMIN_EMAILS', household('x', [member({ email: 'miguel@mimoia.com' })]), 'interna'],
    ['test household', household('x', [member({ email: 'prueba@example.com' })]), 'prueba'],
    ['suspended', household('x', [member(), member({ isOwner: false, suspended: true })]), 'suspendida'],
    ['BAJA or «No, gracias»', household('x', [member({ saidNo: true })]), 'baja'],
  ] as const)('%s → out', (_label, h, reason) => {
    const plan = planEmailQuestion([h], { ...ctx(), adminEmails: ['miguel@mimoia.com'] })
    expect(plan.recipients).toEqual([])
    expect(plan.excluded[reason]).toBe(1)
  })

  it('one person per household: the owner, else the earliest member; the name from the waitlist or the username', () => {
    const owner = member({ isOwner: true, username: 'ana', joinedAt: new Date('2026-10-05T10:00:00Z') })
    const early = member({ isOwner: false, joinedAt: new Date('2026-10-01T10:00:00Z') })
    const [r] = planEmailQuestion([household('h', [early, owner])], ctx()).recipients
    expect(r).toEqual({ householdId: 'h', userId: owner.userId, email: owner.email, firstName: 'Ana' })

    const a = member({ isOwner: false, username: 'mm_84', joinedAt: new Date('2026-10-03T10:00:00Z') })
    const b = member({ isOwner: false, joinedAt: new Date('2026-10-02T10:00:00Z'), waitlistName: '  pablo ' })
    expect(planEmailQuestion([household('h', [a, b])], ctx()).recipients[0]).toMatchObject({ userId: b.userId, firstName: 'Pablo' })
    expect(planEmailQuestion([household('h', [a])], ctx()).recipients[0].firstName).toBeNull()
  })

  it('a household that already got it stays out', () => {
    const plan = planEmailQuestion(group(), ctx(['h-ok-1']))
    expect(plan.recipients.map((r) => r.householdId)).toEqual(['h-ok-never'])
    expect(plan.excluded.ya_enviada).toBe(1)
  })
})

// A stand-in body (the real one is pasted in Admin).
const BODY = 'Hola{, Nombre}:\n\nUna línea de prueba para el cuerpo del correo.\n\n1. Primera pregunta de prueba\n2. Segunda pregunta de prueba\n\nGracias,\nFirma de prueba'

describe('the email', () => {
  it('drops a pasted greeting and tidies the paragraphs', () => {
    expect(cleanBody(BODY)).toBe('Una línea de prueba para el cuerpo del correo.\n\n1. Primera pregunta de prueba\n2. Segunda pregunta de prueba\n\nGracias,\nFirma de prueba')
    expect(cleanBody('  Hola:\r\n\r\n  Texto  \r\n\r\n\r\nMás  ')).toBe('Texto\n\nMás')
    expect(cleanBody('Hola, qué tal estás hoy en casa con todo lo de la semana y lo demás: bien\n\nTexto')).toContain('Hola, qué tal')
  })

  it('subject, «Miguel de Mimoia», reply-to the sender, to one person; greeting, body and footer', () => {
    const msg = questionMessage({ email: 'lucia@example.org', firstName: 'Lucía' }, BODY)
    expect(msg).toMatchObject({ to: 'lucia@example.org', subject: QUESTION_SUBJECT, fromName: QUESTION_FROM_NAME, replyToSender: true })
    expect(QUESTION_SUBJECT).toBe('¿Qué te faltó en Mimoia?')
    expect(QUESTION_FROM_NAME).toBe('Miguel de Mimoia')
    expect(QUESTION_FOOTER).toBe('Te escribo porque tienes cuenta en la beta de Mimoia.')
    expect(msg.text).toBe(`Hola, Lucía:\n\n${cleanBody(BODY)}\n\n--\n${QUESTION_FOOTER}`)
    expect(msg.html).toContain('Hola, Lucía:')
    expect(msg.html).toContain('1. Primera pregunta de prueba<br>2. Segunda pregunta de prueba')
    expect(msg.html).toContain(QUESTION_FOOTER)
    expect(msg.html).not.toMatch(/<a\s/)
  })

  it('without a name, «Hola:»; the name and the body are escaped in the HTML', () => {
    expect(renderQuestionEmail(null, BODY).text.startsWith('Hola:\n')).toBe(true)
    const { html } = renderQuestionEmail('<b>', 'Texto con <script>')
    expect(html).toContain('Hola, &lt;b&gt;:')
    expect(html).toContain('Texto con &lt;script&gt;')
  })
})

/** In-memory store with the same «claim once» rule as the unique index. */
function memoryStore(households: EmailCandidateHousehold[]) {
  const rows = new Map<string, { id: string; status: string }>()
  const store: EmailQuestionStore = {
    loadCandidates: async () => households,
    sentHouseholds: async () => new Set(rows.keys()),
    claimSend: async (r: EmailQuestionRecipient) => {
      if (rows.has(r.householdId)) return null
      const id = `s${rows.size + 1}`
      rows.set(r.householdId, { id, status: 'sending' })
      return id
    },
    markSent: async (id) => {
      for (const v of rows.values()) if (v.id === id) v.status = 'sent'
    },
    markFailed: async (id) => {
      for (const v of rows.values()) if (v.id === id) v.status = 'failed'
    },
    totals: async () => ({
      sent: [...rows.values()].filter((v) => v.status === 'sent').length,
      failed: [...rows.values()].filter((v) => v.status !== 'sent').length,
      lastSentAt: null,
    }),
  }
  return { store, rows }
}

describe('preview and send', () => {
  function setup() {
    const { store, rows } = memoryStore(group())
    const sent: EmailMessage[] = []
    const deps: EmailQuestionDeps = {
      store,
      now: NOW,
      configured: true,
      adminEmails: [],
      testDomains: TEST,
      pause: async () => {},
      send: async (msg) => {
        sent.push(msg)
        return { status: 'sent', id: null }
      },
    }
    return { deps, sent, rows }
  }

  it('the count the admin sees is exactly who gets it', async () => {
    const { deps } = setup()
    const p = await previewEmailQuestion(deps)
    expect(p.count).toBe(2)
    expect(p.excluded).toMatchObject({ activo: 2, interna: 1, prueba: 1, suspendida: 1, baja: 1, ya_enviada: 0 })
    expect(p.sent).toBe(0)
  })

  it('sends one email per household, each to one address; a second press sends nothing', async () => {
    const { deps, sent, rows } = setup()
    expect(await sendEmailQuestion(BODY, 2, deps)).toEqual({ status: 'sent', sent: 2, failed: 0, skipped: 0 })
    expect(sent.map((m) => m.to)).toHaveLength(2)
    expect(new Set(sent.map((m) => m.to)).size).toBe(2)
    expect([...rows.keys()].sort()).toEqual(['h-ok-1', 'h-ok-never'])

    // Second click, with the same count it saw: nothing goes out.
    expect(await sendEmailQuestion(BODY, 2, deps)).toEqual({ status: 'count_changed', count: 0 })
    expect(sent).toHaveLength(2)
    const after = await previewEmailQuestion(deps)
    expect(after).toMatchObject({ count: 0, sent: 2, excluded: { ya_enviada: 2 } })
  })

  it('a household claimed in between (another admin) is skipped, never sent twice', async () => {
    const { deps, sent } = setup()
    const store = deps.store!
    const racing: EmailQuestionStore = {
      ...store,
      claimSend: async (r) => {
        if (r.householdId === 'h-ok-1') await store.claimSend(r)
        return store.claimSend(r)
      },
    }
    expect(await sendEmailQuestion(BODY, 2, { ...deps, store: racing })).toEqual({ status: 'sent', sent: 1, failed: 0, skipped: 1 })
    expect(sent).toHaveLength(1)
  })

  it('a count that changed, zero, or no email configured: nothing goes out', async () => {
    const { deps, sent } = setup()
    expect(await sendEmailQuestion(BODY, 3, deps)).toEqual({ status: 'count_changed', count: 2 })
    expect(await sendEmailQuestion(BODY, 2, { ...deps, configured: false })).toEqual({ status: 'unavailable', reason: 'not_configured' })
    expect(sent).toEqual([])
  })

  it('a failed send is kept as failed and not retried', async () => {
    const { deps, rows } = setup()
    let calls = 0
    const failing = { ...deps, send: async () => (calls++ === 0 ? ({ status: 'failed', error: 'boom' } as const) : ({ status: 'sent', id: 'x' } as const)) }
    expect(await sendEmailQuestion(BODY, 2, failing)).toEqual({ status: 'sent', sent: 1, failed: 1, skipped: 0 })
    expect([...rows.values()].map((v) => v.status).sort()).toEqual(['failed', 'sent'])
    expect((await previewEmailQuestion(failing)).count).toBe(0)
    expect(calls).toBe(2)
  })
})
