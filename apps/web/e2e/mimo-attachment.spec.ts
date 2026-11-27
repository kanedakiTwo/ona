/**
 * 2026-11-26: «pásale a Mimo la dieta de tu nutricionista». In Mimo's chat the
 * clip attaches one photo or PDF; it goes with the message as multipart
 * (`file`), the conversation shows «[Adjunto]» instead of the file, and a type
 * Mimo can't read is refused before sending. The allergies screen opens Mimo
 * with the message started. The chat route is mocked (no model).
 */
import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

test.use({ viewport: { width: 390, height: 844 } })

test('a PDF goes to Mimo with the message; the chat keeps «[Adjunto]»', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  const requests: { contentType: string; body: string }[] = []
  await page.route('**/assistant/*/chat', async (route) => {
    const req = route.request()
    requests.push({ contentType: req.headers()['content-type'] ?? '', body: req.postDataBuffer()?.toString('latin1') ?? '' })
    await route.fulfill({
      json: {
        message: 'He apuntado lo que puedo de la dieta de tu nutricionista:\n- Sin lactosa\nNo puedo aplicar todavía las cantidades exactas.',
        actionTaken: true,
      },
    })
  })

  // From the allergies screen: «Mandársela a Mimo» opens the chat with the message started.
  await page.goto('/profile/casa/alergias?next=/profile')
  await expect(page.getByTestId('nutritionist-diet')).toContainText('¿Sigues la dieta de un nutricionista? Mándasela a Mimo.')
  await page.getByRole('button', { name: 'Mandársela a Mimo' }).click()
  const panel = page.getByTestId('mimo-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByTestId('mimo-input')).toHaveValue('Te mando la dieta de mi nutricionista.')

  // A file Mimo can't read is refused before sending.
  await page.getByTestId('mimo-file-input').setInputFiles({ name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') })
  await expect(panel.getByTestId('mimo-attachment')).toContainText('Solo puedo leer fotos (JPG, PNG o WebP) o un PDF.')

  // The PDF: a chip with its name, then sent with the words.
  await page.getByTestId('mimo-file-input').setInputFiles({ name: 'dieta.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n%dieta\n') })
  await expect(panel.getByTestId('mimo-attachment')).toContainText('dieta.pdf')
  await panel.getByRole('button', { name: 'Enviar' }).click()

  const messages = panel.getByTestId('mimo-messages')
  await expect(messages.getByText('[Adjunto] Te mando la dieta de mi nutricionista.')).toBeVisible()
  await expect(messages.getByText(/He apuntado lo que puedo de la dieta de tu nutricionista/)).toBeVisible()
  await expect(panel.getByTestId('mimo-attachment')).toHaveCount(0)

  expect(requests).toHaveLength(1)
  expect(requests[0].contentType).toMatch(/^multipart\/form-data/)
  expect(requests[0].body).toContain('filename="dieta.pdf"')
  expect(requests[0].body).toContain('Content-Type: application/pdf')
  expect(requests[0].body).toContain('Te mando la dieta de mi nutricionista.')

  // The next message goes as JSON, with «[Adjunto]» in the history and no file.
  await page.getByTestId('mimo-input').fill('Gracias')
  await panel.getByRole('button', { name: 'Enviar' }).click()
  await expect.poll(() => requests.length).toBe(2)
  expect(requests[1].contentType).toMatch(/^application\/json/)
  const next = JSON.parse(requests[1].body)
  expect(next.history[0]).toEqual({ role: 'user', content: '[Adjunto] Te mando la dieta de mi nutricionista.' })
})
