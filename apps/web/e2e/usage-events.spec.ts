/**
 * PRO-120: the web sign-up reports each step seen and passed, and screens
 * are counted once per person, screen and day by the API (Legal: the cap is
 * on the server; the browser stores nothing for it).
 */

import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

type Sent = { name: string; props: Record<string, unknown>; counted: boolean | null }

function recordUsage(page: Page): Sent[] {
  const sent: Sent[] = []
  page.on('response', async (r) => {
    if (!r.url().endsWith('/usage/event') || r.request().method() !== 'POST') return
    const body = JSON.parse(r.request().postData() ?? '{}')
    const json = await r.json().catch(() => null)
    sent.push({ name: body.name, props: body.props, counted: json?.counted ?? null })
  })
  return sent
}

test('the web sign-up records every step, seen and done', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  const sent = recordUsage(page)
  await page.goto('/onboarding')

  const next = page.getByRole('button', { name: /siguiente/i })
  await next.click()
  await page.getByRole('button', { name: /3-4 veces/i }).click()
  await next.click()
  await page.getByRole('button', { name: /^cocino cada día/i }).click()
  await next.click()
  await page.getByRole('button', { name: /sin prisa/i }).click()
  await next.click()
  await next.click() // no restrictions
  await page.getByRole('button', { name: /salud/i }).click()
  await page.getByRole('button', { name: /empezar/i }).click()
  await expect(page).toHaveURL(/\/menu/, { timeout: 30_000 })

  const steps = () => sent.filter((e) => e.name === 'onboarding_step').map((e) => `${e.props.step}:${e.props.action}`)
  for (const step of ['hogar', 'frecuencia', 'cocina', 'tiempo', 'dieta', 'prioridad']) {
    await expect.poll(steps, { timeout: 10_000 }).toContain(`${step}:visto`)
    await expect.poll(steps, { timeout: 10_000 }).toContain(`${step}:hecho`)
  }
  // Only closed words travel: no answers, no text.
  for (const e of sent) expect(Object.keys(e.props).every((k) => ['step', 'action', 'via', 'screen', 'from'].includes(k))).toBe(true)
  // Landing on /menu counts the screen.
  await expect.poll(() => sent.some((e) => e.name === 'screen_viewed' && e.props.screen === 'menu' && e.counted === true), { timeout: 10_000 }).toBe(true)
})

test('a screen is counted once a day, however many times it is opened', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  const sent = recordUsage(page)
  await page.goto('/shopping')
  await expect.poll(() => sent.filter((e) => e.props?.screen === 'lista').length, { timeout: 15_000 }).toBe(1)
  await page.goto('/profile')
  await page.goto('/shopping')
  await expect.poll(() => sent.filter((e) => e.props?.screen === 'lista').length, { timeout: 15_000 }).toBe(2)
  expect(sent.filter((e) => e.props?.screen === 'lista').map((e) => e.counted)).toEqual([true, false])
  // Nothing about it is kept in the browser.
  const keys = await page.evaluate(() => Object.keys(localStorage))
  expect(keys.filter((k) => /usage|screen|pantalla/i.test(k))).toEqual([])
})
