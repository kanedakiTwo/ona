/**
 * PRO-1305: allergies said in the web chat get fixed messages written by the
 * code (not the model), after Mimo's reply: the notice, and once the question
 * for permission with two buttons. Tapping one posts it to `/health-consent`,
 * shows what that answers and hides the buttons. Both routes are mocked.
 */
import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

test('allergy notices follow Mimo\'s reply; the permission buttons answer once', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  await page.route('**/assistant/*/chat', (route) =>
    route.fulfill({
      json: {
        message: 'Entendido, nada de gluten en casa.',
        actionTaken: false,
        healthMessages: [
          { id: 'n1', text: 'Apuntado en la ficha de tu casa: sin gluten. No saldrá en tus menús. Si quieres que lo borre, dímelo.' },
          {
            id: 'q1',
            text: '¿Me das permiso para guardar este dato de salud?',
            buttons: [
              { id: 'consent:yes', title: 'Sí, doy mi permiso' },
              { id: 'consent:no', title: 'No, gracias' },
            ],
          },
        ],
      },
    }),
  )
  const answers: unknown[] = []
  await page.route('**/assistant/*/health-consent', async (route) => {
    answers.push(route.request().postDataJSON())
    await route.fulfill({ json: { healthMessages: [{ id: 'a1', text: 'Apuntado: tengo tu permiso. Gracias.' }] } })
  })

  await page.goto('/menu')
  await page.getByTestId('mimo-button').click()
  const panel = page.getByTestId('mimo-panel')
  await page.getByTestId('mimo-input').fill('En casa somos celíacos')
  await page.getByRole('button', { name: 'Enviar' }).click()

  const messages = panel.getByTestId('mimo-messages')
  await expect(messages.getByText('Entendido, nada de gluten en casa.')).toBeVisible()
  await expect(messages.getByText(/Apuntado en la ficha de tu casa: sin gluten/)).toBeVisible()
  await expect(messages.getByText('¿Me das permiso para guardar este dato de salud?')).toBeVisible()
  // In order: the reply, then the notice, then the question.
  const text = (await messages.innerText()).replace(/\s+/g, ' ')
  expect(text.indexOf('Entendido')).toBeLessThan(text.indexOf('Apuntado en la ficha'))
  expect(text.indexOf('Apuntado en la ficha')).toBeLessThan(text.indexOf('¿Me das permiso'))

  const buttons = panel.getByTestId('mimo-health-button')
  await expect(buttons).toHaveText(['Sí, doy mi permiso', 'No, gracias'])
  await panel.getByRole('button', { name: 'Sí, doy mi permiso' }).click()

  await expect(messages.getByText('Apuntado: tengo tu permiso. Gracias.')).toBeVisible()
  expect(answers).toEqual([{ buttonId: 'consent:yes', title: 'Sí, doy mi permiso' }])
  await expect(panel.getByTestId('mimo-health-button')).toHaveCount(0)
})
