/**
 * Email through Resend (PRO-93, specs/email.md): fetch is stubbed, so this
 * pins the request body and headers, the "no key → nothing sent" rule, the
 * masked logs and the brand template.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RESEND_BATCH_LIMIT,
  maskEmail,
  renderBrandEmail,
  sendEmail,
  sendEmailBatch,
  type EmailConfig,
} from '../services/email.js'
import { waitlistInviteEmail, waitlistInviteReminderEmail } from '../services/waitlistEmails.js'

function cfg(fetchImpl: any, apiKey = 're_test_key'): EmailConfig {
  return { apiKey, from: 'Mimoia <hola@mimoia.com>', baseUrl: 'https://api.resend.test/', fetch: fetchImpl }
}

function okFetch(json: unknown = { id: 'em_1' }) {
  return vi.fn(async () => new Response(JSON.stringify(json), { status: 200, headers: { 'Content-Type': 'application/json' } }))
}

const MSG = {
  to: 'laura@example.com',
  subject: 'Hola',
  html: '<p>Hola</p>',
  text: 'Hola',
  headers: { 'List-Unsubscribe': '<https://mimoia.com/lista/baja?t=abc>' },
}

afterEach(() => vi.restoreAllMocks())

describe('sendEmail', () => {
  it('POSTs one message to Resend with the key, sender, both bodies and the extra headers', async () => {
    const f = okFetch()
    const r = await sendEmail(MSG, cfg(f))
    expect(r).toEqual({ status: 'sent', id: 'em_1' })
    expect(f).toHaveBeenCalledTimes(1)
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://api.resend.test/emails')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer re_test_key')
    expect(JSON.parse(String(init.body))).toEqual({
      from: 'Mimoia <hola@mimoia.com>',
      to: ['laura@example.com'],
      subject: 'Hola',
      html: '<p>Hola</p>',
      text: 'Hola',
      headers: { 'List-Unsubscribe': '<https://mimoia.com/lista/baja?t=abc>' },
    })
  })

  it('without a key sends nothing and says so', async () => {
    const f = okFetch()
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    expect(await sendEmail(MSG, cfg(f, ''))).toEqual({ status: 'skipped', reason: 'not_configured' })
    expect(f).not.toHaveBeenCalled()
    expect(log.mock.calls.flat().join(' ')).toContain('not configured')
  })

  it('a Resend error comes back as failed, never thrown, and logs only the masked address', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify({ message: 'domain not verified' }), { status: 403 }))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await sendEmail(MSG, cfg(f))).toEqual({ status: 'failed', error: 'domain not verified' })
    const logged = err.mock.calls.flat().join(' ')
    expect(logged).toContain('l***@e***.com')
    expect(logged).not.toContain('laura@example.com')
  })

  it('a network error is failed too', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const f = vi.fn(async () => {
      throw new Error('ECONNRESET')
    })
    expect(await sendEmail(MSG, cfg(f))).toEqual({ status: 'failed', error: 'ECONNRESET' })
  })

  it('success logs never carry the full address', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    await sendEmail(MSG, cfg(okFetch()))
    expect(log.mock.calls.flat().join(' ')).not.toContain('laura@example.com')
  })
})

describe('sendEmailBatch', () => {
  it(`splits into calls of ${RESEND_BATCH_LIMIT} and keeps the input order`, async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const f = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as unknown[]
      return new Response(JSON.stringify({ data: body.map((_, k) => ({ id: `id_${k}` })) }), { status: 200 })
    })
    const msgs = Array.from({ length: 150 }, (_, k) => ({ ...MSG, to: `p${k}@example.com` }))
    const r = await sendEmailBatch(msgs, cfg(f))
    expect(f).toHaveBeenCalledTimes(2)
    expect(f.mock.calls[0][0]).toBe('https://api.resend.test/emails/batch')
    expect((JSON.parse(String(f.mock.calls[0][1].body)) as unknown[]).length).toBe(100)
    expect((JSON.parse(String(f.mock.calls[1][1].body)) as any[])[0].to).toEqual(['p100@example.com'])
    expect(r).toHaveLength(150)
    expect(r[100]).toEqual({ status: 'sent', id: 'id_0' })
  })

  it('without a key skips every message and calls nothing', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const f = okFetch()
    expect(await sendEmailBatch([MSG, MSG], cfg(f, ''))).toEqual([
      { status: 'skipped', reason: 'not_configured' },
      { status: 'skipped', reason: 'not_configured' },
    ])
    expect(f).not.toHaveBeenCalled()
  })
})

describe('maskEmail', () => {
  it('keeps the first letters and the TLD only', () => {
    expect(maskEmail('miguel@gmail.com')).toBe('m***@g***.com')
    expect(maskEmail('a@b')).toBe('a***@b***')
  })
})

describe('renderBrandEmail', () => {
  it('escapes every string and repeats the content in the text version', () => {
    const { html, text } = renderBrandEmail({
      heading: 'Hola <b>',
      paragraphs: ['Tom & Jerry'],
      button: { label: 'Entrar', url: 'https://mimoia.com/register?a=1&b=2' },
      unsubscribeUrl: 'https://mimoia.com/lista/baja?t=x',
    })
    expect(html).toContain('Hola &lt;b&gt;')
    expect(html).toContain('Tom &amp; Jerry')
    expect(html).toContain('href="https://mimoia.com/register?a=1&amp;b=2"')
    expect(html).toContain('max-width:600px')
    expect(html).not.toContain('<b>')
    expect(text).toContain('Tom & Jerry')
    expect(text).toContain('Entrar: https://mimoia.com/register?a=1&b=2')
    expect(text).toContain('Darme de baja: https://mimoia.com/lista/baja?t=x')
  })
})

describe('waitlistInviteEmail', () => {
  const base = {
    email: 'laura@example.com',
    entryUrl: 'https://mimoia.com/entrar/TOKEN123',
    unsubscribeUrl: 'https://mimoia.com/lista/baja?t=tok',
  }

  it('greets by name, links to the personal one-time link and carries the opt-out link and header', () => {
    const m = waitlistInviteEmail({ ...base, firstName: 'Laura', wantsWhatsapp: false })
    expect(m.to).toBe('laura@example.com')
    expect(m.subject).toBe('¡Te toca, Laura! Ya puedes entrar en Mimoia')
    expect(m.html).toContain('href="https://mimoia.com/entrar/TOKEN123"')
    expect(m.html).not.toContain('/register')
    expect(m.text).toContain('Crear mi cuenta: https://mimoia.com/entrar/TOKEN123')
    expect(m.text).toContain('2 minutos')
    expect(m.text).toContain('sirve una vez')
    expect(m.text).toContain('Darme de baja: https://mimoia.com/lista/baja?t=tok')
    expect(m.headers).toEqual({ 'List-Unsubscribe': '<https://mimoia.com/lista/baja?t=tok>' })
    expect(m.text).not.toContain('WhatsApp')
  })

  it('without a name, a plain subject; with WhatsApp interest, how to talk to Mimo there', () => {
    const m = waitlistInviteEmail({ ...base, firstName: null, wantsWhatsapp: true })
    expect(m.subject).toBe('¡Te toca! Ya puedes entrar en Mimoia')
    expect(m.text).toContain('«Conectar WhatsApp»')
    expect(m.text).toContain('Soy Mimo')
  })
})

describe('waitlistInviteReminderEmail', () => {
  it('same link, says it is the only reminder, keeps the opt-out', () => {
    const m = waitlistInviteReminderEmail({
      email: 'laura@example.com',
      firstName: 'Laura',
      wantsWhatsapp: false,
      entryUrl: 'https://mimoia.com/entrar/TOKEN123',
      unsubscribeUrl: 'https://mimoia.com/lista/baja?t=tok',
    })
    expect(m.subject).toBe('Laura, tu invitación a Mimoia sigue aquí')
    expect(m.text).toContain('Crear mi cuenta: https://mimoia.com/entrar/TOKEN123')
    expect(m.text).toContain('único recordatorio')
    expect(m.headers).toEqual({ 'List-Unsubscribe': '<https://mimoia.com/lista/baja?t=tok>' })
  })
})
