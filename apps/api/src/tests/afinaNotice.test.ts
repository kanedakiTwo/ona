/**
 * PRO-205: the «Afina tu menú» notice — WhatsApp inside the window only, once
 * per household, the app after 3 days without it going out (or straight away
 * without WhatsApp). The DB side (who gets it) is in afinaNotice.smoke.ts.
 */
import { describe, expect, it, vi } from 'vitest'
import { AFINA_NOTICE_TEXT, afinaNoticeEnabled, noticeVisibleInApp, runAfinaNotice, type NoticeRepo, type NoticeRow } from '../services/afinaNotice.js'

const DAY = 86_400_000
const t0 = new Date('2026-10-19T10:00:00+02:00')

function fakeRepo(rows: NoticeRow[]): NoticeRepo & { rows: NoticeRow[]; scans: number } {
  let scanned = false
  const repo = {
    rows,
    scans: 0,
    async scan() {
      repo.scans += 1
      if (scanned) return false
      scanned = true
      return true
    },
    async pendingWhatsApp() {
      return rows.filter((r) => r.userId && !r.whatsappSentAt && !r.dismissedAt)
    },
    async claimWhatsApp(id: string, at: Date) {
      const r = rows.find((x) => x.id === id)!
      if (r.whatsappSentAt) return false
      r.whatsappSentAt = at
      return true
    },
    async unclaimWhatsApp(id: string) {
      rows.find((x) => x.id === id)!.whatsappSentAt = null
    },
    async openInApp(_key: string, now: Date) {
      let n = 0
      for (const r of rows) {
        if (!r.appSince && !r.whatsappSentAt && now.getTime() - r.createdAt.getTime() >= 3 * DAY) {
          r.appSince = now
          n++
        }
      }
      return n
    },
  }
  return repo
}

const row = (over: Partial<NoticeRow> = {}): NoticeRow => ({
  id: over.id ?? 'n1',
  householdId: 'h1',
  userId: 'u1',
  createdAt: t0,
  whatsappSentAt: null,
  appSince: null,
  dismissedAt: null,
  ...over,
})

describe('«Afina tu menú» notice (PRO-205)', () => {
  it('WhatsApp inside the window: sent once with Legal’s text, never again', async () => {
    const repo = fakeRepo([row()])
    const send = vi.fn(async () => ({ status: 'ok' as const }))
    expect(await runAfinaNotice(t0, { repo, sendWhatsApp: send })).toMatchObject({ scanned: true, whatsapp: 1 })
    expect(send).toHaveBeenCalledWith('u1', AFINA_NOTICE_TEXT, t0)
    expect(await runAfinaNotice(new Date(t0.getTime() + 600_000), { repo, sendWhatsApp: send })).toMatchObject({ scanned: false, whatsapp: 0 })
    expect(send).toHaveBeenCalledTimes(1)
    // Sent on WhatsApp → no card, even after 3 days.
    expect(noticeVisibleInApp(repo.rows[0], new Date(t0.getTime() + 5 * DAY))).toBe(false)
  })

  it('window closed: not sent, tried again when they write; after 3 days also in the app', async () => {
    const repo = fakeRepo([row()])
    let open = false
    const send = vi.fn(async () => (open ? { status: 'ok' as const } : { status: 'skipped' as const, error: 'outside-24h-window' }))
    await runAfinaNotice(t0, { repo, sendWhatsApp: send })
    expect(repo.rows[0].whatsappSentAt).toBeNull()
    expect(noticeVisibleInApp(repo.rows[0], new Date(t0.getTime() + 2 * DAY))).toBe(false)

    const day3 = new Date(t0.getTime() + 3 * DAY + 1000)
    expect((await runAfinaNotice(day3, { repo, sendWhatsApp: send })).toApp).toBe(1)
    expect(noticeVisibleInApp(repo.rows[0], day3)).toBe(true)

    // They write on day 4: Mimo gives it then too, once; the card stays until closed.
    open = true
    const day4 = new Date(t0.getTime() + 4 * DAY)
    expect((await runAfinaNotice(day4, { repo, sendWhatsApp: send })).whatsapp).toBe(1)
    expect((await runAfinaNotice(new Date(day4.getTime() + 600_000), { repo, sendWhatsApp: send })).whatsapp).toBe(0)
    expect(noticeVisibleInApp(repo.rows[0], day4)).toBe(true)
  })

  it('a WhatsApp error is not counted as sent', async () => {
    const repo = fakeRepo([row()])
    await runAfinaNotice(t0, { repo, sendWhatsApp: async () => ({ status: 'error', error: 'meta 500' }) })
    expect(repo.rows[0].whatsappSentAt).toBeNull()
  })

  it('without WhatsApp: in the app right away, never sent; closed = gone', async () => {
    const r = row({ userId: null, appSince: t0 })
    const repo = fakeRepo([r])
    const send = vi.fn(async () => ({ status: 'ok' as const }))
    await runAfinaNotice(t0, { repo, sendWhatsApp: send })
    expect(send).not.toHaveBeenCalled()
    expect(noticeVisibleInApp(r, t0)).toBe(true)
    expect(noticeVisibleInApp({ ...r, dismissedAt: t0 }, t0)).toBe(false)
  })

  it('closed in the app before writing: no WhatsApp afterwards', async () => {
    const repo = fakeRepo([row({ dismissedAt: t0 })])
    const send = vi.fn(async () => ({ status: 'ok' as const }))
    await runAfinaNotice(t0, { repo, sendWhatsApp: send })
    expect(send).not.toHaveBeenCalled()
  })

  it('the text is Legal’s, word for word (no «sin cerdo» add-on: PRO-198 ships in the same version)', () => {
    expect(AFINA_NOTICE_TEXT.startsWith('¡Hola! Un aviso rápido: si usaste «Afina tu menú» estos días')).toBe(true)
    expect(AFINA_NOTICE_TEXT.endsWith('Perdona el lío, y gracias por estar en la prueba: para esto sirve.')).toBe(true)
    expect(AFINA_NOTICE_TEXT).not.toContain('cocido')
  })

  it('runs by itself only on staging and production, and AFINA_NOTICE=off stops it', () => {
    expect(afinaNoticeEnabled({ RAILWAY_ENVIRONMENT_NAME: 'staging' })).toBe(true)
    expect(afinaNoticeEnabled({ RAILWAY_ENVIRONMENT_NAME: 'production' })).toBe(true)
    expect(afinaNoticeEnabled({ NODE_ENV: 'production' })).toBe(true)
    expect(afinaNoticeEnabled({})).toBe(false) // CI, e2e, a laptop
    expect(afinaNoticeEnabled({ RAILWAY_ENVIRONMENT_NAME: 'production', AFINA_NOTICE: 'off' })).toBe(false)
  })
})
