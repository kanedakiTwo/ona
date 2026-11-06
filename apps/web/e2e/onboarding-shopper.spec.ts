/**
 * PRO-383 (D-158): «¿Quién hace la compra?» in the web sign-up, right after
 * «¿Para cuántos cocinas?», only with 2 adults or more. «Otra persona de
 * casa» or «Nos turnamos» lead to «Invítale y le llegará la lista cada
 * semana»: «Mandar invitación» prepares the household invitation from the
 * sign-up (`source: alta`) with its own message and link, and «Ahora no»
 * goes on. It took the place of the «Familia en el mismo hogar» card of step
 * 1, so like it, it is offered once. 390×844.
 */
import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser } from './_helpers'

const API = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

async function startWebQuestions(page: Page) {
  const web = page.getByRole('button', { name: /prefiero la web/i })
  const household = page.getByRole('heading', { name: /para cuántos cocinas/i })
  await expect(web.or(household)).toBeVisible({ timeout: 15_000 })
  if (await web.isVisible()) await web.click()
  await expect(household).toBeVisible()
}

async function auth(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user'))) ?? '{}')
  return { headers: { Authorization: `Bearer ${token}` }, userId: user.id as string }
}

/** From «¿Cómo cocináis en casa?» to the end, with the fewest taps; returns the sign-up's body. */
async function finishSignUp(page: Page): Promise<Record<string, unknown>> {
  const next = page.getByRole('button', { name: /siguiente/i })
  await page.getByRole('button', { name: /^cocino cada día/i }).click()
  await next.click()
  await page.getByRole('button', { name: /sin prisa/i }).click()
  await next.click()
  const onboarding = page.waitForRequest((r) => r.method() === 'POST' && /\/user\/[^/]+\/onboarding$/.test(r.url()))
  await page.getByRole('button', { name: /empezar/i }).click() // no restrictions
  const body = JSON.parse((await onboarding).postData() ?? '{}')
  await expect(page).toHaveURL(/\/menu/, { timeout: 30_000 })
  return body
}

test('2 adults: the question, «Otra persona de casa» → the invitation with its link', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await page.goto('/onboarding')
  await startWebQuestions(page)
  // No card on the household step any more (PRO-261's sign-up offer is this screen now).
  await expect(page.getByTestId('family-invite-offer-alta')).toHaveCount(0)

  const next = page.getByRole('button', { name: /siguiente/i })
  await expect(page.locator('[aria-live="polite"]').nth(0)).toHaveText('2')
  await next.click()

  const step = page.getByTestId('onboarding-shopper')
  await expect(step.getByRole('heading', { name: /quién hace la compra/i })).toBeVisible()
  await expect(page.getByText('Primeros pasos · 2 de 5')).toBeVisible()
  await expect(next).toBeDisabled()
  for (const label of ['Yo', 'Otra persona de casa', 'Nos turnamos']) {
    await expect(step.getByRole('button', { name: label, exact: true })).toBeVisible()
  }
  await step.getByRole('button', { name: 'Otra persona de casa', exact: true }).click()
  await expect(step.getByRole('button', { name: 'Otra persona de casa', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await next.click()

  // The invitation, one more step.
  const invite = page.getByTestId('onboarding-shopper-invite')
  await expect(invite.getByRole('heading', { name: /invítale y le llegará la lista cada semana/i })).toBeVisible()
  await expect(page.getByText('Primeros pasos · 3 de 6')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Ahora no' })).toBeVisible()

  const created = page.waitForResponse((r) => r.url().endsWith('/households/me/invites') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Mandar invitación' }).click()
  const res = await created
  expect(res.status()).toBe(201)
  expect(JSON.parse(res.request().postData() ?? '{}')).toMatchObject({ source: 'alta', role: 'member' })
  const { token } = await res.json()

  const message = page.getByTestId('shopper-invite-message')
  await expect(message).toContainText('Te he metido en nuestra casa de Mimoia: ahí tendrás el menú y la lista de la compra de cada semana. Entra aquí:')
  await expect(message).toContainText(`/invites/${token}`)
  const whatsapp = invite.getByTestId('family-invite-whatsapp')
  const href = (await whatsapp.getAttribute('href'))!
  expect(href.startsWith('https://wa.me/?text=')).toBe(true)
  expect(decodeURIComponent(href)).toContain('Te he metido en nuestra casa de Mimoia')
  expect(decodeURIComponent(href)).toContain(`/invites/${token}`)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  // On with the questions.
  await next.click()
  await expect(page.getByRole('heading', { name: /cómo cocináis en casa/i })).toBeVisible()
  const body = await finishSignUp(page)
  expect(body.shopper).toBe('other')

  // Offered once: the sign-up's moment is spent.
  const { headers } = await auth(page)
  expect(await (await page.request.get(`${API}/households/me/family-offer`, { headers })).json()).toMatchObject({ alta: false })
})

test('«Nos turnamos» → «Ahora no» goes on without an invitation', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await page.goto('/onboarding')
  await startWebQuestions(page)
  const invites: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().endsWith('/households/me/invites')) invites.push(r.url())
  })

  await page.getByRole('button', { name: /siguiente/i }).click()
  await page.getByTestId('onboarding-shopper').getByRole('button', { name: 'Nos turnamos', exact: true }).click()
  await page.getByRole('button', { name: /siguiente/i }).click()
  await expect(page.getByRole('heading', { name: /invítale y le llegará la lista cada semana/i })).toBeVisible()
  await page.getByRole('button', { name: 'Ahora no' }).click()
  await expect(page.getByRole('heading', { name: /cómo cocináis en casa/i })).toBeVisible()
  const body = await finishSignUp(page)
  expect(body.shopper).toBe('shared')
  expect(invites).toEqual([])
})

test('1 adult: no «¿Quién hace la compra?»', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await page.goto('/onboarding')
  await startWebQuestions(page)

  await page.getByRole('button', { name: 'Quitar adulto' }).click()
  await expect(page.locator('[aria-live="polite"]').nth(0)).toHaveText('1')
  await expect(page.getByText('Primeros pasos · 1 de 4')).toBeVisible()
  await page.getByRole('button', { name: /siguiente/i }).click()

  await expect(page.getByRole('heading', { name: /cómo cocináis en casa/i })).toBeVisible()
  await expect(page.getByText('Primeros pasos · 2 de 4')).toBeVisible()
  await expect(page.getByTestId('onboarding-shopper')).toHaveCount(0)
  const body = await finishSignUp(page)
  expect(body).not.toHaveProperty('shopper')
})
