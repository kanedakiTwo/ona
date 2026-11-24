/**
 * 24-nov: in the web panel Mimo's `[[opciones: Comida | Cena]]` was shown as
 * written. Now the line is never shown: its options are buttons under Mimo's
 * last message, and tapping one sends it. The assistant reply is mocked.
 */
import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

test('Mimo\'s options are buttons, never the raw line; tapping one answers', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  const sent: string[] = []
  await page.route('**/assistant/*/chat', async (route) => {
    const body = route.request().postDataJSON() as { message: string }
    sent.push(body.message)
    await route.fulfill({
      json: sent.length === 1
        ? { message: '¿La pongo en la comida o en la cena?\n\n[[opciones: Comida | Cena]]', actionTaken: false }
        : { message: 'Ya está: el jueves cenáis Rösti de patatas.', actionTaken: false },
    })
  })

  await page.goto('/menu')
  await page.getByTestId('mimo-button').click()
  const panel = page.getByTestId('mimo-panel')
  await page.getByTestId('mimo-input').fill('Ponla el jueves')
  await page.getByRole('button', { name: 'Enviar' }).click()

  await expect(panel.getByText('¿La pongo en la comida o en la cena?')).toBeVisible()
  await expect(panel).not.toContainText('[[')
  await expect(panel).not.toContainText('opciones:')
  const options = panel.getByTestId('mimo-option')
  await expect(options).toHaveText(['Comida', 'Cena'])

  await options.nth(1).click()
  await expect(panel.getByText('Ya está: el jueves cenáis Rösti de patatas.')).toBeVisible()
  expect(sent).toEqual(['Ponla el jueves', 'Cena'])
  // answered: the buttons of the earlier question are gone
  await expect(panel.getByTestId('mimo-option')).toHaveCount(0)
})
