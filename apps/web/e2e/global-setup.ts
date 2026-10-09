/**
 * Closed beta (PRO-27): the API runs with REGISTRATION_MODE=invite, so every
 * spec signs up through an "e2e" campaign link. This registers the e2e admin
 * (admins can always sign up; its email is in the API's ADMIN_EMAILS), logs
 * in (which grants the admin role) and creates that campaign. The code goes
 * to `process.env.E2E_CAMPAIGN_CODE`, which the workers inherit.
 */
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

export default async function globalSetup() {
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
}
