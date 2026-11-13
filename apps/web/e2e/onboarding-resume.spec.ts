/**
 * PRO-178: a sign-up left halfway resumes where it was. Before, someone who
 * answered two questions, closed the browser and came back through «Iniciar
 * sesión» landed on /menu with «Tu semana está en blanco» (a menu without
 * their answers), and /onboarding started again at «1 de 5» (four questions
 * since 2026-11-03).
 * Now every «Siguiente» saves the step and the answers on the account, and
 * /menu without the sign-up finished goes to /onboarding. At 390×844.
 */
import { test, expect, type Page } from '@playwright/test'
import { answerShopper, registerFreshUser, submitLoginForm } from './_helpers'

test.use({ viewport: { width: 390, height: 844 } })

async function startWebQuestions(page: Page) {
  const web = page.getByRole('button', { name: /prefiero la web/i })
  const household = page.getByRole('heading', { name: /para cuántos cocinas/i })
  await expect(web.or(household)).toBeVisible({ timeout: 15_000 })
  if (await web.isVisible()) await web.click()
  await expect(household).toBeVisible()
}

/** Logs out the way the app does (token and cached account gone) and back in. */
async function logOutAndIn(page: Page, creds: { username: string; password: string }) {
  await page.evaluate(() => {
    localStorage.removeItem('ona_token')
    localStorage.removeItem('ona_user')
  })
  await page.goto('/login')
  await submitLoginForm(page, creds)
}

test('three questions answered, log out, log in → /onboarding on the fourth with the answers', async ({ page }) => {
  test.setTimeout(90_000)
  const creds = await registerFreshUser(page)
  await page.goto('/onboarding')
  await startWebQuestions(page)

  const next = page.getByRole('button', { name: /siguiente/i })
  // 1 de 5: three adults, one child.
  await page.getByRole('button', { name: 'Añadir adulto' }).click()
  await page.getByRole('button', { name: 'Añadir niño' }).click()
  await next.click()
  // 2 de 5 (PRO-383): who does the shopping, «Yo» (no invitation after it).
  await expect(page.getByText('Primeros pasos · 2 de 5')).toBeVisible()
  await answerShopper(page)
  // 3 de 5 (PRO-217; since 2026-11-03 no «¿Cuántas veces…?» before it): batch
  // cooking. «Siguiente» saves the next step with the answers.
  await expect(page.getByText('Primeros pasos · 3 de 5')).toBeVisible()
  await page.getByRole('button', { name: /^batch cooking/i }).click()
  const saved = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/onboarding-draft$/.test(r.url()))
  await next.click()
  expect((await saved).ok()).toBe(true)
  await expect(page.getByText('Primeros pasos · 4 de 5')).toBeVisible()

  await logOutAndIn(page, creds)

  // Not /menu with a blank week: back to the sign-up, on the weekday time question.
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 20_000 })
  await expect(page.getByText('Primeros pasos · 4 de 5')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: /entre semana, ¿cómo te gusta cocinar/i })).toBeVisible()

  // What they answered is still there.
  await page.getByRole('button', { name: 'Atrás' }).click()
  await expect(page.getByText('Primeros pasos · 3 de 5')).toBeVisible()
  await expect(page.getByRole('button', { name: /^batch cooking/i })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Atrás' }).click()
  await expect(page.getByText('Primeros pasos · 2 de 5')).toBeVisible()
  await expect(page.getByTestId('onboarding-shopper').getByRole('button', { name: 'Yo', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Atrás' }).click()
  await expect(page.getByText('Primeros pasos · 1 de 5')).toBeVisible()
  const counters = page.locator('[aria-live="polite"]')
  await expect(counters.nth(0)).toHaveText('3')
  await expect(counters.nth(1)).toHaveText('1')
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  // Finishing the sign-up still lands on the menu, and /menu then stays.
  await next.click()
  await next.click()
  await next.click()
  await page.getByRole('button', { name: /^rápido/i }).click()
  await next.click()
  await page.getByRole('button', { name: /empezar/i }).click() // no restrictions
  await expect(page).toHaveURL(/\/menu/, { timeout: 30_000 })
  await logOutAndIn(page, creds)
  await expect(page).toHaveURL(/\/menu/, { timeout: 20_000 })
  await page.waitForTimeout(1_500)
  await expect(page).toHaveURL(/\/menu/)
})

test('/menu without the sign-up finished goes to /onboarding (no empty week created)', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  const created: string[] = []
  page.on('request', (r) => {
    if (r.method() === 'POST' && /\/menu\/generate$/.test(r.url())) created.push(r.url())
  })
  await page.goto('/menu')
  await expect(page).toHaveURL(/\/onboarding/, { timeout: 20_000 })
  await expect(page.getByText('Tu semana está en blanco')).toHaveCount(0)
  expect(created).toEqual([])
})
