/**
 * Chat read-aloud with ElevenLabs (specs/advisor.md → Voice): when the API
 * offers voices, the chat shows "Voz de Mimo" and picking one asks the API
 * for audio in that voice (a short preview). The API is mocked: no
 * ElevenLabs call, no cost.
 */
import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

test('picking a voice in the chat previews it through POST /tts', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await page.route(`${API_URL}/tts/voices`, (route) =>
    route.fulfill({
      json: { enabled: true, voices: [{ key: 'sara', name: 'Sara' }, { key: 'carolina', name: 'Carolina' }], defaultVoice: 'sara' },
    }),
  )
  const ttsBodies: Array<{ text: string; voice?: string }> = []
  await page.route(`${API_URL}/tts`, (route) => {
    ttsBodies.push(route.request().postDataJSON())
    return route.fulfill({ status: 200, contentType: 'audio/mpeg', body: Buffer.from([]) })
  })

  await page.goto('/advisor')
  const select = page.getByTestId('tts-voice-select')
  await expect(select).toBeVisible({ timeout: 15_000 })
  await expect(select).toHaveValue('sara')

  await select.selectOption('carolina')
  await expect.poll(() => ttsBodies.length).toBeGreaterThan(0)
  expect(ttsBodies[0]).toMatchObject({ voice: 'carolina' })
  expect(ttsBodies[0].text).toContain('soy Mimo')
})
