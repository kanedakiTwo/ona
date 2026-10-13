/**
 * PRO-55 «Mimo, manos libres» in cook mode (specs/cooking-mode.md,
 * specs/voice-mode.md): the button opens Mimo listening in hands-free; in
 * cook mode a silence doesn't end it (Mimo listens again and sends nothing
 * to transcribe); leaving cook mode turns it off.
 *
 * The mic is simulated with a silent stream, so every turn is a silence.
 */
import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.use({ viewport: { width: 390, height: 844 } })

test.beforeEach(async ({ page }) => {
  // Silent microphone: a muted oscillator into a MediaStream.
  await page.addInitScript(() => {
    const silent = async () => {
      const ctx = new AudioContext()
      const dest = ctx.createMediaStreamDestination()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      gain.gain.value = 0
      osc.connect(gain).connect(dest)
      osc.start()
      return dest.stream
    }
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = silent
  })
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('cook mode: «Mimo, manos libres» survives a silence and ends when leaving /cook', async ({ page }) => {
  test.setTimeout(90_000)
  let sttCalls = 0
  await page.route('**/stt', (route) => {
    sttCalls++
    return route.fulfill({ json: { text: '' } })
  })

  await page.goto('/recipes')
  const card = page.getByRole('main').locator('a[href^="/recipes/"]:not([href="/recipes/new"])').first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  await Promise.all([page.waitForURL(/\/recipes\/[0-9a-f-]{36}(\?|$)/), card.click()])
  await Promise.all([
    page.waitForURL(/\/cook(\?|$)/),
    page.getByTestId('recipe-action-bar').getByRole('link', { name: /^empezar a cocinar$/i }).click(),
  ])

  const start = page.getByTestId('cook-handsfree')
  await expect(start).toBeVisible({ timeout: 10_000 })
  await expect(start).toHaveText(/mimo, manos libres/i)
  await expect(start).toHaveAttribute('aria-pressed', 'false')
  await start.click()

  const toggle = page.getByTestId('mimo-handsfree')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('mimo-listening')).toBeVisible()

  // Nobody speaks for longer than the 8 s no-speech limit: still on, listening again.
  await page.waitForTimeout(10_000)
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByTestId('mimo-listening')).toBeVisible()
  expect(sttCalls).toBe(0)

  // Leave cook mode (back to the recipe): hands-free turns off.
  await page.goBack()
  await page.waitForURL((url) => !/\/cook(\/|$)/.test(url.pathname))
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('mimo-listening')).toHaveCount(0)
})

test('cook mode: «Parar» ends hands-free', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/recipes')
  const card = page.getByRole('main').locator('a[href^="/recipes/"]:not([href="/recipes/new"])').first()
  await expect(card).toBeVisible({ timeout: 10_000 })
  const id = (await card.getAttribute('href'))!.match(/\/recipes\/([^/?#]+)/)![1]
  await page.goto(`/recipes/${id}/cook`)

  await page.getByTestId('cook-handsfree').click()
  const toggle = page.getByTestId('mimo-handsfree')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  // Tap «Parar» once Mimo is really listening, as a person would. The panel
  // starts the mic 150 ms after it opens (MimoProvider `open({ listen })`); a
  // tap inside that window found nothing to cancel, the mic opened anyway and
  // stayed on until the 8 s no-speech limit (flaky in CI, PRO-77).
  await expect(page.getByTestId('mimo-listening')).toBeVisible()
  await page.getByTestId('mimo-stop').click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByTestId('mimo-listening')).toHaveCount(0)
})
