/**
 * Closed beta (PRO-27): the API runs with REGISTRATION_MODE=invite, so every
 * spec signs up through an "e2e" campaign link. This registers the e2e admin
 * (admins can always sign up; its email is in the API's ADMIN_EMAILS), logs
 * in (which grants the admin role) and creates that campaign. The code goes
 * to `process.env.E2E_CAMPAIGN_CODE`, which the workers inherit.
 *
 * Simulated email (PRO-97): with `E2E_MAIL_URL` set (CI and test-e2e.sh,
 * together with RESEND_API_KEY=fake + RESEND_BASE_URL=<same URL> on the API),
 * this also starts a fake Resend that keeps every message in memory. Specs
 * read them with `GET <E2E_MAIL_URL>/__messages?to=<email>`.
 */
import http from 'node:http'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'
export const E2E_ADMIN = { username: 'e2e_admin', email: 'e2e-admin@test.local', password: 'e2e-admin-pass' }

async function post(path: string, body: unknown, token?: string) {
  const r = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any }
}

/** Fake Resend: POST /emails and /emails/batch are stored; GET /__messages lists them. */
async function startMailMock(url: string): Promise<() => Promise<void>> {
  const messages: Array<Record<string, any>> = []
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json')
      if (req.method === 'POST' && (req.url === '/emails' || req.url === '/emails/batch')) {
        const parsed = JSON.parse(body || 'null')
        const list = Array.isArray(parsed) ? parsed : [parsed]
        const ids = list.map((m) => {
          const id = `e2e_${messages.length + 1}`
          messages.push({ ...m, id })
          return { id }
        })
        res.end(JSON.stringify(Array.isArray(parsed) ? { data: ids } : ids[0]))
        return
      }
      if (req.method === 'GET' && req.url?.startsWith('/__messages')) {
        const to = new URL(req.url, 'http://mock').searchParams.get('to')
        res.end(JSON.stringify(messages.filter((m) => !to || (m.to ?? []).includes(to))))
        return
      }
      res.statusCode = 404
      res.end('{}')
    })
  })
  const { port, hostname } = new URL(url)
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(Number(port), hostname, () => resolve())
  })
  return () => new Promise<void>((resolve) => server.close(() => resolve()))
}

export default async function globalSetup() {
  const stopMail = process.env.E2E_MAIL_URL ? await startMailMock(process.env.E2E_MAIL_URL) : null
  await post('/register', { ...E2E_ADMIN, ageConfirmed: true }) // 409 on re-runs: fine
  const login = await post('/login', { username: E2E_ADMIN.username, password: E2E_ADMIN.password })
  if (login.status !== 200) throw new Error(`e2e admin login failed: ${login.status} ${JSON.stringify(login.json)}`)
  process.env.E2E_ADMIN_TOKEN = login.json.token
  const created = await post('/admin/invite-campaigns', { name: 'e2e' }, login.json.token)
  if (created.status === 201) {
    process.env.E2E_CAMPAIGN_CODE = created.json.code
  } else {
    // Not an admin (ADMIN_EMAILS missing on the API): specs only pass on an API with REGISTRATION_MODE=open.
    console.warn(`[e2e] could not create the e2e campaign (${created.status}); assuming REGISTRATION_MODE=open`)
  }
  // Playwright runs the returned function as the global teardown.
  return stopMail ?? undefined
}
