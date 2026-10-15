import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import emailSinkRoutes from '../routes/emailSink.js'
import { sendEmail, sendEmailBatch, type EmailConfig } from '../services/email.js'
import { clearSink, emailSinkDomains, isSinkAddress, readSink } from '../services/emailSink.js'

const msg = (to: string, subject = 'Hola') => ({ to, subject, html: '<p>x</p>', text: 'x' })

function cfg(fetchImpl: typeof fetch): EmailConfig {
  return { apiKey: 'k', from: 'Mimoia <hola@mimoia.com>', baseUrl: 'https://resend.test', fetch: fetchImpl }
}

afterEach(() => {
  vi.unstubAllEnvs()
  clearSink()
})

describe('emailSinkDomains', () => {
  it('reads EMAIL_SINK_DOMAINS and is always off on production', () => {
    expect(emailSinkDomains({ EMAIL_SINK_DOMAINS: ' example.com, @Test.local ' })).toEqual(['example.com', 'test.local'])
    expect(emailSinkDomains({})).toEqual([])
    expect(emailSinkDomains({ EMAIL_SINK_DOMAINS: 'example.com', RAILWAY_ENVIRONMENT_NAME: 'production' })).toEqual([])
    expect(emailSinkDomains({ EMAIL_SINK_DOMAINS: 'example.com', RAILWAY_ENVIRONMENT_NAME: 'staging' })).toEqual(['example.com'])
  })

  it('matches the exact domain only', () => {
    expect(isSinkAddress('Ana@Example.com', ['example.com'])).toBe(true)
    expect(isSinkAddress('ana@example.com.evil.es', ['example.com'])).toBe(false)
    expect(isSinkAddress('ana@gmail.com', ['example.com'])).toBe(false)
  })
})

describe('sendEmail / sendEmailBatch with the sink on', () => {
  it('a test address is kept, not sent; a real one still goes to Resend', async () => {
    vi.stubEnv('EMAIL_SINK_DOMAINS', 'example.com')
    const f = vi.fn(async () => new Response(JSON.stringify({ id: 'r1' }), { status: 200 }))
    expect((await sendEmail(msg('ana@example.com'), cfg(f as any))).status).toBe('sent')
    expect(f).not.toHaveBeenCalled()
    expect(readSink('ANA@example.com').map((m) => m.subject)).toEqual(['Hola'])
    expect(await sendEmail(msg('miguel@gmail.com'), cfg(f as any))).toEqual({ status: 'sent', id: 'r1' })
    expect(f).toHaveBeenCalledTimes(1)
  })

  it('a batch keeps the input order: sink results and Resend results interleaved', async () => {
    vi.stubEnv('EMAIL_SINK_DOMAINS', 'example.com')
    const f = vi.fn(async (_url: any, init: any) => {
      const sent = JSON.parse(init.body)
      return new Response(JSON.stringify({ data: sent.map((_: unknown, k: number) => ({ id: `r${k}` })) }), { status: 200 })
    })
    const r = await sendEmailBatch([msg('a@gmail.com'), msg('b@example.com'), msg('c@gmail.com')], cfg(f as any))
    expect(r[0]).toEqual({ status: 'sent', id: 'r0' })
    expect(r[1].status).toBe('sent')
    expect((r[1] as any).id).toMatch(/^sink-/)
    expect(r[2]).toEqual({ status: 'sent', id: 'r1' })
    expect(JSON.parse((f.mock.calls[0] as any)[1].body).map((m: any) => m.to[0])).toEqual(['a@gmail.com', 'c@gmail.com'])
  })

  it('off (no EMAIL_SINK_DOMAINS): nothing is kept', async () => {
    const r = await sendEmail(msg('ana@example.com'), { ...cfg(fetch), apiKey: '' })
    expect(r.status).toBe('skipped')
    expect(readSink('ana@example.com')).toEqual([])
  })
})

const servers: Server[] = []
afterAll(() => servers.forEach((s) => (s.closeAllConnections(), s.close())))

async function serve(): Promise<string> {
  const app = express()
  app.use(emailSinkRoutes)
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

describe('GET /email-sink', () => {
  it('404 when off; 400 for a real address; the kept emails for a test address', async () => {
    const b = await serve()
    expect((await fetch(`${b}/email-sink?to=ana@example.com`)).status).toBe(404)

    vi.stubEnv('EMAIL_SINK_DOMAINS', 'example.com')
    await sendEmail(msg('ana@example.com', 'Ya estás dentro de Mimoia'))
    expect((await fetch(`${b}/email-sink?to=miguel@gmail.com`)).status).toBe(400)
    const r = await fetch(`${b}/email-sink?to=ana%40example.com`)
    expect(r.status).toBe(200)
    const { messages } = (await r.json()) as { messages: Array<{ subject: string; text: string }> }
    expect(messages.map((m) => m.subject)).toEqual(['Ya estás dentro de Mimoia'])
    expect(messages[0].text).toBe('x')
  })
})
