import { describe, expect, it, vi } from 'vitest'
import { passwordResetEmail, welcomeEmail, welcomeKind } from '../services/accountEmails.js'
import { requestPasswordReset, sendWelcomeEmail, type AccountMailerDeps } from '../services/accountMailer.js'
import { renderBrandEmail } from '../services/email.js'

const WEB = 'https://mimoia.com'

describe('welcomeKind', () => {
  it('beta for the closed-beta ways in, household when joining a home, general otherwise', () => {
    expect(welcomeKind({ access: 'waitlist', joiningHousehold: false })).toBe('beta')
    expect(welcomeKind({ access: 'campaign', joiningHousehold: false })).toBe('beta')
    expect(welcomeKind({ access: 'admin', joiningHousehold: false })).toBe('beta')
    expect(welcomeKind({ access: 'household', joiningHousehold: true })).toBe('household')
    expect(welcomeKind({ access: 'campaign', joiningHousehold: true })).toBe('household')
    expect(welcomeKind({ access: 'open', joiningHousehold: false })).toBe('general')
  })
})

describe('welcomeEmail', () => {
  it('beta: says it is a beta, asks to reply, lists the first steps, signed by Miguel', () => {
    const m = welcomeEmail({ email: 'ana@example.com', firstName: 'Ana', kind: 'beta', publicUrl: WEB })
    expect(m.to).toBe('ana@example.com')
    expect(m.subject).toBe('Ya estás dentro de Mimoia')
    expect(m.text).toContain('Hola, Ana:')
    expect(m.text).toContain('Estamos en beta')
    expect(m.text).toContain('contesta a este correo')
    expect(m.text).toContain('1. Contesta unas preguntas sobre tu casa')
    expect(m.text).toContain('Abrir Mimoia: https://mimoia.com/menu')
    expect(m.text).toMatch(/Miguel\nFundador de Mimoia/)
    expect(m.html).toContain('Beta privada')
    expect(m.html).toContain('src="https://mimoia.com/email/mimoia-logo.png"')
    expect(m.headers).toBeUndefined()
  })

  it('general and household say different things, and neither calls it a beta', () => {
    const g = welcomeEmail({ email: 'a@example.com', kind: 'general', publicUrl: WEB })
    const h = welcomeEmail({ email: 'a@example.com', kind: 'household', publicUrl: WEB })
    expect(g.subject).toBe('Te doy la bienvenida a Mimoia')
    expect(g.text).toContain('Hola:')
    expect(g.text).toContain('la parte divertida de cocinar')
    expect(h.subject).toBe('Ya tienes cuenta en Mimoia')
    expect(h.text).toContain('Alguien de tu casa te ha invitado')
    expect(h.text).toContain('márcalo en la lista')
    for (const m of [g, h]) {
      expect(m.text).not.toContain('beta')
      expect(m.html).not.toContain('Beta privada')
    }
  })
})

describe('passwordResetEmail', () => {
  it('carries the one-time link, says it lasts 1 hour and what to do if it was not you', () => {
    const m = passwordResetEmail({ email: 'ana@example.com', resetUrl: 'https://mimoia.com/reset?token=abc' })
    expect(m.subject).toBe('Cambia tu contraseña de Mimoia')
    expect(m.html).toContain('href="https://mimoia.com/reset?token=abc"')
    expect(m.text).toContain('Elegir contraseña nueva: https://mimoia.com/reset?token=abc')
    expect(m.text).toContain('caduca en 1 hora')
    expect(m.text).toContain('Si no lo has pedido tú, no hagas nada')
  })
})

function deps(over: Partial<AccountMailerDeps> = {}): AccountMailerDeps {
  return {
    send: vi.fn(async () => ({ status: 'sent' as const, id: 'r1' })),
    publicUrl: 'https://mimoia.com/',
    findUser: vi.fn(async () => ({ id: 'u1', email: 'Ana@Example.com', suspendedAt: null })),
    recentResets: vi.fn(async () => 0),
    mint: vi.fn(async () => ({ token: 'tok123' })),
    firstName: vi.fn(async () => null),
    now: () => new Date('2026-10-15T10:00:00Z'),
    ...over,
  }
}

describe('requestPasswordReset', () => {
  it('an active account gets a fresh link at /reset, to the address on the account', async () => {
    const d = deps()
    expect(await requestPasswordReset('ana@example.com', d)).toBe('sent')
    expect(d.mint).toHaveBeenCalledWith('u1')
    const msg = vi.mocked(d.send).mock.calls[0][0]
    expect(msg.to).toBe('Ana@Example.com')
    expect(msg.text).toContain('https://mimoia.com/reset?token=tok123')
  })

  it('no account, a suspended one or too many requests: no link, no email', async () => {
    for (const [over, want] of [
      [{ findUser: vi.fn(async () => null) }, 'no_account'],
      [{ findUser: vi.fn(async () => ({ id: 'u1', email: 'a@b.c', suspendedAt: new Date() })) }, 'suspended'],
      [{ recentResets: vi.fn(async () => 3) }, 'throttled'],
    ] as const) {
      const d = deps(over)
      expect(await requestPasswordReset('a@b.c', d)).toBe(want)
      expect(d.mint).not.toHaveBeenCalled()
      expect(d.send).not.toHaveBeenCalled()
    }
  })

  it('counts the last hour of links', async () => {
    const d = deps()
    await requestPasswordReset('a@b.c', d)
    expect(vi.mocked(d.recentResets).mock.calls[0][1]).toEqual(new Date('2026-10-15T09:00:00Z'))
  })
})

describe('sendWelcomeEmail', () => {
  it('greets with the name from the waitlist when there is one', async () => {
    const d = deps({ firstName: vi.fn(async () => 'Laura') })
    expect(await sendWelcomeEmail({ email: 'laura@example.com', kind: 'beta' }, d)).toBe('sent')
    expect(vi.mocked(d.send).mock.calls[0][0].text).toContain('Hola, Laura:')
  })
})

describe('renderBrandEmail (brand shell)', () => {
  it('logo, accent heading, numbered steps, button, signature and footer, all escaped', () => {
    const { html, text } = renderBrandEmail({
      heading: 'Ya estás *dentro* <b>',
      paragraphs: ['Hola'],
      steps: ['Uno & dos', 'Tres'],
      button: { label: 'Abrir', url: 'https://mimoia.com/menu' },
      after: ['Después'],
      signoff: 'Un abrazo,',
      from: { name: 'Miguel', role: 'Fundador de Mimoia' },
      footer: ['Por qué te llega'],
      assets: { logoUrl: 'https://mimoia.com/email/mimoia-logo.png', homeUrl: 'https://mimoia.com/' },
    })
    expect(html).toContain('src="https://mimoia.com/email/mimoia-logo.png"')
    expect(html).toMatch(/Ya estás <em [^>]*>dentro<\/em> &lt;b&gt;/)
    expect(html).toContain('Uno &amp; dos')
    expect(html.indexOf('Tres')).toBeLessThan(html.indexOf('https://mimoia.com/menu"'))
    expect(html.indexOf('Un abrazo,')).toBeLessThan(html.indexOf('>Miguel</p>'))
    expect(html).toContain('Por qué te llega')
    expect(text).toContain('Ya estás dentro <b>')
    expect(text).toContain('1. Uno & dos\n2. Tres')
    expect(text).toMatch(/Abrir: https:\/\/mimoia.com\/menu\n\nDespués/)
  })
})
