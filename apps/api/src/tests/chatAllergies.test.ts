/**
 * PRO-1305 (D-1025, Legal E-103) · The pure part of the allergies said in
 * the chat: the permission, the buttons the code reads, the texts and what
 * the code reads in a message. The DB flow is in chatAllergies.smoke.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  ASK_BUTTONS,
  askText,
  chatAllergyChannel,
  chatPermissionFrom,
  consentButtonId,
  allergiesInMessage,
  declinedHint,
  deletedNotice,
  isAdultForConsent,
  isTypedAnswer,
  listText,
  mergeSaved,
  parseConsentButton,
  reminderDue,
  saidOf,
  savedNotice,
  withChatAllergyOutbox,
  currentOutbox,
  type ConsentEvent,
} from '../services/chatAllergies.js'
import { HEALTH_CONSENT_TEXT, HEALTH_CONSENT_VERSION } from '@ona/shared'

const at = (iso: string) => new Date(iso)
const ev = (event: string, iso: string, extra: Partial<ConsentEvent> = {}): ConsentEvent => ({ id: `${event}-${iso}`, event, personId: null, questionId: null, createdAt: at(iso), ...extra })
const noWeb = { consentAt: null, version: null, withdrawnAt: null }
const Q = '0b7f6a1e-3c2d-4e5f-8a9b-1c2d3e4f5a6b'

describe('the permission (one in the life of the account)', () => {
  it('the web box (v1, v2 or v3) is the permission', () => {
    for (const version of ['salud-v1-2026-10', 'salud-v2-2026-10', 'salud-v3-2026-11']) {
      expect(chatPermissionFrom({ consentAt: at('2026-11-01'), version, withdrawnAt: null }, [])).toEqual({ kind: 'web', version, consentRef: version })
    }
  })

  it('never asked → never; asked without an answer → asked (never again), one reminder', () => {
    expect(chatPermissionFrom(noWeb, [])).toEqual({ kind: 'never' })
    const asked = chatPermissionFrom(noWeb, [ev('asked', '2026-11-24T10:00:00Z')])
    expect(asked).toMatchObject({ kind: 'asked', reminded: false })
    const reminded = chatPermissionFrom(noWeb, [ev('asked', '2026-11-24T10:00:00Z', { id: 'q1' }), ev('reminded', '2026-11-25T10:00:00Z', { questionId: 'q1' })])
    expect(reminded).toMatchObject({ kind: 'asked', reminded: true })
  })

  it('«Sí, doy mi permiso» → chat, with the grant as its reference; «No, gracias» → declined (never asked again)', () => {
    expect(chatPermissionFrom(noWeb, [ev('asked', '2026-11-24T10:00:00Z'), ev('granted', '2026-11-24T10:01:00Z', { id: 'g1' })])).toEqual({ kind: 'chat', consentRef: 'g1' })
    expect(chatPermissionFrom(noWeb, [ev('asked', '2026-11-24T10:00:00Z'), ev('declined', '2026-11-24T10:01:00Z')])).toEqual({ kind: 'declined' })
  })

  it('withdrawn on the web or in the chat → declined: no question, ever', () => {
    expect(chatPermissionFrom({ consentAt: at('2026-10-01'), version: 'salud-v2-2026-10', withdrawnAt: at('2026-11-01') }, [])).toEqual({ kind: 'declined' })
    const granted = [ev('asked', '2026-11-24T10:00:00Z'), ev('granted', '2026-11-24T10:01:00Z')]
    expect(chatPermissionFrom(noWeb, [...granted, ev('withdrawn', '2026-11-25T10:00:00Z')])).toEqual({ kind: 'declined' })
    expect(chatPermissionFrom({ consentAt: null, version: null, withdrawnAt: at('2026-11-26') }, granted)).toEqual({ kind: 'declined' })
  })

  it("another adult's «está de acuerdo» isn't the account's permission", () => {
    expect(chatPermissionFrom(noWeb, [ev('asked', '2026-11-24T10:00:00Z', { personId: 'p1' }), ev('granted', '2026-11-24T10:01:00Z', { personId: 'p1' })])).toEqual({ kind: 'never' })
  })

  it('one reminder, only after the question went in an earlier turn and while something is pending', () => {
    const asked = { kind: 'asked' as const, questionId: 'q', askedAt: at('2026-11-24T10:00:00Z'), reminded: false }
    const pending = [{ personId: null, restriction: 'marisco', expiresAt: at('2026-12-24') }]
    expect(reminderDue(asked, pending, at('2026-11-24T10:30:00Z'))).toBe(false)
    expect(reminderDue(asked, pending, at('2026-11-25T10:00:00Z'))).toBe(true)
    expect(reminderDue({ ...asked, reminded: true }, pending, at('2026-11-25T10:00:00Z'))).toBe(false)
    expect(reminderDue(asked, [], at('2026-11-25T10:00:00Z'))).toBe(false)
  })
})

describe('the buttons (read by the code, tied to their question)', () => {
  it('round-trips the ids; anything else is null', () => {
    for (const kind of ['ask', 'person', 'withdraw'] as const) {
      for (const answer of ['yes', 'no'] as const) expect(parseConsentButton(consentButtonId(kind, answer, Q))).toEqual({ kind, answer, questionId: Q })
    }
    expect(parseConsentButton('hc:yes:not-a-uuid')).toBeNull()
    expect(parseConsentButton('optin_yes')).toBeNull()
    expect(parseConsentButton(null)).toBeNull()
  })

  it('the titles fit WhatsApp (20 characters) and say «doy mi permiso» (Legal E-100, condition 1)', () => {
    expect(ASK_BUTTONS.es.yes).toBe('Sí, doy mi permiso')
    for (const b of Object.values(ASK_BUTTONS)) for (const t of Object.values(b)) expect(t.length).toBeLessThanOrEqual(20)
  })

  it('a typed «sí» (or «no») is not an answer: the buttons go again (C.8)', () => {
    for (const t of ['sí', 'Si!', 'vale', 'ok', 'Sí, guárdalo', 'no', 'No, gracias', 'doy mi permiso']) expect(isTypedAnswer(t)).toBe(true)
    for (const t of ['soy celíaca', 'sí, y ponme lentejas el lunes', '¿qué ceno hoy?']) expect(isTypedAnswer(t)).toBe(false)
  })
})

describe('the texts (Legal E-103 §2)', () => {
  it('the one-time question names what was said, its scope and /privacidad', () => {
    const t = askText('sin gluten y marisco', 'es', 'https://mimoia.com')
    expect(t).toMatch(/^Me has dicho sin gluten y marisco\. Para que no se me olvide nunca, ¿me das permiso para apuntar en la ficha de tu casa/)
    expect(t).toContain('si eres su madre, padre o tutor')
    expect(t).toContain('Es un dato de salud: sin tu permiso no lo guardo.')
    expect(t).toMatch(/Más información: https:\/\/mimoia\.com\/privacidad$/)
    expect(askText('gluten', 'en', 'https://mimoia.com')).toMatch(/^You told me gluten\. So I never forget it, do you give me permission/)
  })

  it('the notice every time it saves, for a child, and the first-time line', () => {
    expect(savedNotice(['sin gluten'], 'es')).toBe('Apuntado en la ficha de tu casa: sin gluten. No saldrá en tus menús. Si quieres que lo borre, dímelo.')
    expect(savedNotice(['huevo', 'soja'], 'es', { alias: 'la peque' })).toBe('Apuntado para la peque: huevo y soja. No saldrá en vuestros menús. Si quieres que lo borre, dímelo.')
    expect(savedNotice(['marisco'], 'es', { firstWebLine: true })).toMatch(/Lo guardo porque diste tu permiso para tus datos de salud en tu perfil; puedes retirarlo cuando quieras\.$/)
    expect(savedNotice(['gluten'], 'en')).toBe("Saved to your household profile: gluten. It won't appear in your menus. If you'd like me to delete it, just tell me.")
    expect(deletedNotice(['sin gluten'], 'es')).toBe('Borrado: sin gluten ya no está en tu ficha. Ojo: desde ahora puede volver a salir en tus menús.')
    expect(declinedHint('es', 'https://mimoia.com')).toBe('Si algún día quieres que lo apunte, márcalo en tu perfil: https://mimoia.com/profile/casa/alergias')
  })

  it('lists and the «me has dicho» part', () => {
    expect(listText(['a'])).toBe('a')
    expect(listText(['a', 'b', 'c'])).toBe('a, b y c')
    expect(saidOf([{ restriction: 'marisco', personId: null, alias: null }, { restriction: 'huevo', personId: 'p', alias: 'la peque' }], 'es')).toBe('marisco; de la peque, huevo')
  })

  it('one notice per person in a turn', () => {
    const merged = mergeSaved([
      { type: 'saved', personId: null, alias: null, items: ['marisco'], consentRef: 'v', firstWebLine: true },
      { type: 'saved', personId: null, alias: null, items: ['soja', 'marisco'], consentRef: 'v', firstWebLine: false },
      { type: 'saved', personId: 'p', alias: 'la peque', items: ['huevo'], consentRef: 'v', firstWebLine: false },
    ])
    expect(merged).toEqual([
      { type: 'saved', personId: null, alias: null, items: ['marisco', 'soja'], consentRef: 'v', firstWebLine: true },
      { type: 'saved', personId: 'p', alias: 'la peque', items: ['huevo'], consentRef: 'v', firstWebLine: false },
    ])
  })

  it('the web box v3 says the chat notes them down (E-103 §2.1)', () => {
    expect(HEALTH_CONSENT_VERSION).toBe('salud-v3-2026-11')
    expect(HEALTH_CONSENT_TEXT).toContain('Mimo las anota en la ficha de mi casa sin preguntarme de nuevo y me avisa cada vez.')
    expect(HEALTH_CONSENT_TEXT).toMatch(/^Consiento que Mimoia trate mis datos de salud/)
    expect(HEALTH_CONSENT_TEXT).toContain('Puedo retirarlo cuando quiera desde mi perfil o pidiéndoselo a Mimo; si lo retiro, se borran esos datos.')
  })
})

describe('what the code reads and where it applies', () => {
  it('a clear allergy is «strong»; «no como marisco» is doubtful (never saved nor asked about by the code)', () => {
    expect(allergiesInMessage('Soy alérgica al marisco. Y no comemos pescado')).toEqual({ strong: ['marisco'], doubtful: ['pescado'] })
    expect(allergiesInMessage('mi hijo es celíaco')).toEqual({ strong: ['sin gluten'], doubtful: [] })
    expect(allergiesInMessage('hoy no me apetece marisco')).toEqual({ strong: [], doubtful: [] })
  })

  it('the chats it applies to: WhatsApp and the web chat; never Telegram nor the web sign-up', () => {
    expect(chatAllergyChannel({ channel: 'whatsapp' })).toBe('whatsapp')
    expect(chatAllergyChannel({ channel: 'text' })).toBe('web')
    expect(chatAllergyChannel({ channel: 'voice' })).toBe('web')
    expect(chatAllergyChannel({ channel: 'whatsapp', surface: 'telegram' })).toBeNull()
    expect(chatAllergyChannel({ channel: 'onboarding' })).toBeNull()
  })

  it('another adult (and 13–17) agree for themselves (C.3); children go under the permission', () => {
    expect(isAdultForConsent('adulto')).toBe(true)
    expect(isAdultForConsent('13-17')).toBe(true)
    for (const b of ['0-2', '3-5', '6-12']) expect(isAdultForConsent(b)).toBe(false)
  })

  it('the outbox only exists inside its turn, for its user', async () => {
    expect(currentOutbox('u1')).toBeNull()
    const seen = vi.fn()
    const { run } = withChatAllergyOutbox({ userId: 'u1', channel: 'whatsapp' }, async () => {
      seen(currentOutbox('u1')?.channel, currentOutbox('u2'))
    })
    await run
    expect(seen).toHaveBeenCalledWith('whatsapp', null)
    expect(currentOutbox('u1')).toBeNull()
  })
})
