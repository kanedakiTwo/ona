/**
 * PRO-136 (specs/billing.md, specs/email.md): the day-7 founder-price offer
 * (email + Mimo on WhatsApp inside the 24 h window, once, from launch day) and
 * the legal notice 15 days before the first charge (once, on the right day).
 */
import { describe, expect, it } from 'vitest'
import { PLANS, euros, founderPriceAmounts } from '@ona/shared'
import type { EmailMessage, EmailResult } from '../services/email.js'
import {
  founderOfferEmail,
  founderOfferShort,
  isFounderOfferDue,
  sendFounderOffers,
  sendFounderOffersIfDue,
  type OfferCandidate,
  type OfferRepo,
} from '../services/founderOffer.js'
import {
  cancelUrl,
  chargeNoticeEmail,
  sendChargeNotices,
  type ChargeNoticeCandidate,
  type ChargeNoticeRepo,
} from '../services/chargeNotice.js'
import { isChargeNoticeDue } from '../services/billing.js'

const NEW = new Date('2027-01-10T14:00:00Z')
/** 11:00 Madrid on day n of the trial. */
const dayAt11 = (n: number) => new Date(new Date('2027-01-10T10:00:00Z').getTime() + n * 86_400_000)

function memory<C, K extends keyof C>(candidates: C[], key: K) {
  const marked = new Set<unknown>()
  return {
    marked,
    async listCandidates() {
      return candidates.filter((c) => !marked.has(c[key]))
    },
    async claim(id: unknown) {
      if (marked.has(id)) return false
      marked.add(id)
      return true
    },
    async unclaim(id: unknown) {
      marked.delete(id)
    },
  }
}

const sentMail = () => {
  const sent: EmailMessage[] = []
  return {
    sent,
    send: async (m: EmailMessage): Promise<EmailResult> => {
      sent.push(m)
      return { status: 'sent', id: 'x' }
    },
  }
}

describe('day-7 founder-price offer', () => {
  const candidate: OfferCandidate = { householdId: 'h1', householdCreatedAt: NEW, ownerId: 'u1', ownerEmail: 'eva@example.com' }

  it('the text: D-056 promise, last day of the trial, nothing charged until the first charge', () => {
    const copy = { access: { trialLastDay: '2027-01-24' }, firstCharge: new Date('2027-02-02T11:00:00Z') }
    expect(founderOfferShort(copy)).toBe(
      `Llevas una semana con Mimoia. Si ya sabes que te quedas, deja la tarjeta antes de que acabe tu prueba (dura hasta el 24 de enero) y te quedas el precio de fundador para siempre (${founderPriceAmounts()}): no te sube mientras sigas suscrito. No se cobra nada hasta el 2 de febrero de 2027 y puedes cancelar antes sin pagar nada.`,
    )
    const m = founderOfferEmail({ ...copy, email: 'eva@example.com', publicUrl: 'https://mimoia.com' })
    expect(m.subject).toBe('Quédate el precio de fundador de Mimoia')
    expect(m.text).toContain(`te quedas el precio de fundador para siempre (${founderPriceAmounts()}): no te sube`)
    expect(m.text).toContain('Quince días antes te avisamos de la fecha y del importe')
    expect(m.text).toContain('https://mimoia.com/profile/suscripcion')
  })

  it('the founder price carries its amounts, read from PLANS (PRO-204, Legal)', () => {
    const amounts = founderPriceAmounts()
    for (const p of PLANS) {
      expect(amounts).toContain(`${p.name}, ${euros(p.prices.mensual.cents)} al mes o ${euros(p.prices.anual.cents)} al año`)
    }
    expect(amounts).toBe('Esencial, 4,99 € al mes o 49,99 € al año; Plus, 8,99 € al mes o 59,99 € al año')
    const copy = { access: { trialLastDay: '2027-01-24' }, firstCharge: new Date('2027-02-02T11:00:00Z') }
    expect(founderOfferShort(copy)).toContain(`para siempre (${amounts}): no te sube`)
  })

  it('due from day 7, not on day 6, and not after the trial', () => {
    expect(isFounderOfferDue(NEW, dayAt11(6))).toBeNull()
    expect(isFounderOfferDue(NEW, dayAt11(7))).toMatchObject({ state: 'trial', trialDay: 7 })
    expect(isFounderOfferDue(NEW, dayAt11(15))).toBeNull()
    // A beta household: its trial starts on launch day, so day 7 is 22 December.
    const beta = new Date('2026-10-01T10:00:00Z')
    expect(isFounderOfferDue(beta, new Date('2026-12-21T10:00:00Z'))).toBeNull()
    expect(isFounderOfferDue(beta, new Date('2026-12-22T10:00:00Z'))).not.toBeNull()
  })

  it('sent once (email + WhatsApp), nothing before launch day', async () => {
    const repo: OfferRepo & { marked: Set<unknown> } = memory([candidate], 'householdId')
    const mail = sentMail()
    const wa: Array<{ userId: string; text: string }> = []
    const deps = {
      repo,
      sendEmail: mail.send,
      sendWhatsApp: async (userId: string, text: string) => {
        wa.push({ userId, text })
        return { status: 'ok' as const }
      },
      publicUrl: 'https://mimoia.com',
    }
    expect((await sendFounderOffers(dayAt11(6), deps)).offered).toBe(0)
    expect((await sendFounderOffers(dayAt11(7), deps)).offered).toBe(1)
    expect((await sendFounderOffers(dayAt11(8), deps)).offered).toBe(0)
    expect(mail.sent).toHaveLength(1)
    expect(wa).toEqual([{ userId: 'u1', text: expect.stringContaining('precio de fundador para siempre') }])
    expect(wa[0].text).toContain('https://mimoia.com/profile/suscripcion')

    const before = memory([{ ...candidate, householdCreatedAt: new Date('2026-10-01T10:00:00Z') }], 'householdId')
    expect((await sendFounderOffers(new Date('2026-12-10T10:00:00Z'), { ...deps, repo: before })).offered).toBe(0)
    expect(await sendFounderOffersIfDue(new Date('2026-12-10T10:00:00Z'), () => ({ ...deps, repo: before }))).toBeNull()
  })

  it('if no channel got it out (no email key, WhatsApp window closed), it stays pending', async () => {
    const repo = memory([candidate], 'householdId')
    const r = await sendFounderOffers(dayAt11(7), {
      repo,
      sendEmail: async () => ({ status: 'skipped', reason: 'not_configured' }),
      sendWhatsApp: async () => ({ status: 'skipped', error: 'outside-24h-window' }),
      publicUrl: '',
    })
    expect(r.offered).toBe(0)
    expect(repo.marked.size).toBe(0)
  })
})

describe('legal notice 15 days before the first charge', () => {
  const chargeAt = new Date('2027-02-02T11:00:00Z')
  const candidate: ChargeNoticeCandidate = {
    subscriptionId: 's1',
    email: 'eva@example.com',
    plan: 'esencial',
    period: 'mensual',
    status: 'trialing',
    trialEnd: chargeAt,
    cancelAtPeriodEnd: false,
    founderPrice: true,
  }

  it('the text: date, amount, what happens if they do not cancel, a direct link to cancel', () => {
    const m = chargeNoticeEmail({ ...candidate, chargeAt, publicUrl: 'https://mimoia.com/' })
    expect(m.subject).toBe('Tu primer cobro de Mimoia: 2 de febrero de 2027')
    expect(m.text).toContain('el 2 de febrero de 2027 te cobraremos 4,99 € (IVA incluido) por Mimoia Esencial (mensual)')
    expect(m.text).toContain('Si no cancelas, la suscripción sigue y se renueva cada mes por 4,99 €')
    expect(m.text).toContain('cancela antes de esa fecha y no se te cobrará nada')
    expect(m.text).toContain('Tienes el precio de fundador')
    expect(m.text).toContain(cancelUrl('https://mimoia.com'))
    // PRO-204 (Legal): who charges and issues the receipt.
    expect(m.text).toContain('El cobro y el recibo los hace Link, de Stripe, que te vende la suscripción de Mimoia; en tu extracto aparecerá «LINK.COM* MIMOIA».')
    expect(cancelUrl('https://mimoia.com/')).toBe('https://mimoia.com/profile/suscripcion?cancelar=1')
    const anual = chargeNoticeEmail({ ...candidate, plan: 'plus', period: 'anual', founderPrice: false, chargeAt, publicUrl: 'https://mimoia.com' })
    expect(anual.text).toContain('59,99 €')
    expect(anual.text).toContain('cada año')
    expect(anual.text).not.toContain('precio de fundador')
  })

  it('due on the Madrid day 15 days before (18 January), not the day before; not if cancelled', () => {
    const row = { status: 'trialing' as const, trialEnd: chargeAt, cancelAtPeriodEnd: false }
    expect(isChargeNoticeDue(row, new Date('2027-01-17T20:00:00Z'))).toBe(false)
    expect(isChargeNoticeDue(row, new Date('2027-01-17T23:30:00Z'))).toBe(true) // 00:30 on the 18th in Madrid
    expect(isChargeNoticeDue({ ...row, cancelAtPeriodEnd: true }, new Date('2027-01-20T10:00:00Z'))).toBe(false)
    expect(isChargeNoticeDue({ ...row, status: 'active' }, new Date('2027-01-20T10:00:00Z'))).toBe(false)
    // A beta subscription (first charge 29 December): the notice goes on 14 December.
    const beta = { ...row, trialEnd: new Date('2026-12-29T11:00:00Z') }
    expect(isChargeNoticeDue(beta, new Date('2026-12-13T12:00:00Z'))).toBe(false)
    expect(isChargeNoticeDue(beta, new Date('2026-12-14T09:00:00Z'))).toBe(true)
  })

  it('sent on the right day and only once; a skipped send (no key) stays pending', async () => {
    const repo: ChargeNoticeRepo & { marked: Set<unknown> } = memory([candidate], 'subscriptionId')
    const mail = sentMail()
    const deps = { repo, sendEmail: mail.send, publicUrl: 'https://mimoia.com' }
    expect(await sendChargeNotices(new Date('2027-01-17T10:00:00Z'), deps)).toEqual({ sent: 0, skipped: 0, failed: 0 })
    expect(await sendChargeNotices(new Date('2027-01-18T10:00:00Z'), deps)).toEqual({ sent: 1, skipped: 0, failed: 0 })
    expect(await sendChargeNotices(new Date('2027-01-19T10:00:00Z'), deps)).toEqual({ sent: 0, skipped: 0, failed: 0 })
    expect(mail.sent.map((m) => m.to)).toEqual(['eva@example.com'])

    const skipRepo = memory([candidate], 'subscriptionId')
    await sendChargeNotices(new Date('2027-01-18T10:00:00Z'), { ...deps, repo: skipRepo, sendEmail: async () => ({ status: 'skipped', reason: 'not_configured' }) })
    expect(skipRepo.marked.size).toBe(0)
  })
})
