/**
 * PRO-334 at 390×844: the Sean Ellis survey card on /menu — four answers,
 * an optional «¿Por qué?», «Enviar» files it and «Ahora no» closes it for
 * good. Who sees it is decided by the API (seanEllisSurvey.test.ts and
 * .smoke.ts); here its answer is stubbed so the card shows for a fresh account.
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const SURVEY = {
  show: true,
  question: 'Si mañana Mimoia dejara de existir, ¿cómo te sentirías?',
  options: [
    { key: 'muy', label: 'Muy decepcionado/a' },
    { key: 'algo', label: 'Algo decepcionado/a' },
    { key: 'nada', label: 'Nada decepcionado/a (no me resulta tan útil)' },
    { key: 'ya_no', label: 'Ya no la uso' },
  ],
  why: '¿Por qué?',
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
})

async function stub(page: Page) {
  const calls = { answers: [] as unknown[], dismissed: 0 }
  await page.route(/\/sean-ellis$/, (route) => {
    if (route.request().method() === 'POST') {
      calls.answers.push(route.request().postDataJSON())
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true,"saved":true}' })
    }
    const done = calls.answers.length > 0 || calls.dismissed > 0
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(done ? { show: false } : SURVEY) })
  })
  await page.route(/\/sean-ellis\/dismiss$/, (route) => {
    calls.dismissed += 1
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  return calls
}

test('/menu: one answer and the «¿Por qué?», then thanks; it does not come back', async ({ page }) => {
  test.setTimeout(90_000)
  const calls = await stub(page)
  await registerFreshUser(page)
  await completeOnboarding(page)
  await page.goto('/menu')

  const card = page.getByTestId('sean-ellis')
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(card.getByRole('heading', { name: SURVEY.question })).toBeVisible()
  const send = card.getByRole('button', { name: 'Enviar' })
  await expect(send).toBeDisabled()
  await expect(card.getByRole('radio')).toHaveCount(4)
  const box = (await card.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)

  await card.getByRole('radio', { name: 'Muy decepcionado/a' }).click()
  await expect(card.getByRole('radio', { name: 'Muy decepcionado/a' })).toHaveAttribute('aria-checked', 'true')
  await card.getByLabel('¿Por qué? (opcional)').fill('Me ahorra pensar la cena')
  await send.click()
  await expect(card).toHaveAttribute('role', 'status')
  await expect(card).toContainText('¡Gracias!')
  expect(calls.answers).toEqual([{ answer: 'muy', why: 'Me ahorra pensar la cena', channel: 'app' }])
  await card.getByRole('button', { name: 'Cerrar' }).click()
  await expect(page.getByTestId('sean-ellis')).toHaveCount(0)

  await page.reload()
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('sean-ellis')).toHaveCount(0)
})

test('/menu: «Ahora no» closes it for good', async ({ page }) => {
  test.setTimeout(90_000)
  const calls = await stub(page)
  await registerFreshUser(page)
  await completeOnboarding(page)
  await page.goto('/menu')

  const card = page.getByTestId('sean-ellis')
  await expect(card).toBeVisible({ timeout: 20_000 })
  await card.getByRole('button', { name: 'Ahora no' }).click()
  await expect(card).toHaveCount(0)
  expect(calls.dismissed).toBe(1)
  expect(calls.answers).toEqual([])
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('sean-ellis')).toHaveCount(0)
})
