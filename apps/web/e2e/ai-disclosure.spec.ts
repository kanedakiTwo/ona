/**
 * EU AI Act art. 50: a user must know they are talking to an AI no later than
 * the first interaction. The chat must show the disclosure before the user
 * sends anything, and keep it visible once the conversation has started.
 * (WhatsApp's first messages are pinned in whatsappInbound.test.ts.)
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('the advisor chat discloses it is an AI before and during the conversation', async ({ page }) => {
  // The assistant reply is mocked: this spec is about the disclosure, not the LLM.
  await page.route('**/assistant/*/chat', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Hoy toca lentejas con verduras.' }),
    }),
  )

  await page.goto('/advisor')
  const disclosure = page.getByTestId('ai-disclosure')
  await expect(disclosure).toBeVisible({ timeout: 10_000 })
  await expect(disclosure).toContainText(/inteligencia artificial/i)
  // The assistant is Mimo (rename 2026-10-08), never the old "Ona".
  await expect(disclosure).toContainText('Mimo es un asistente de inteligencia artificial (IA)')
  await expect(page.getByText('Soy Mimo, tu asistente de IA. Escribe o habla.')).toBeVisible()
  await expect(page.getByText(/\bOna\b/)).toHaveCount(0)

  await page.getByRole('button', { name: /qu[ée] toca cocinar hoy/i }).click()
  await expect(page.getByText('Hoy toca lentejas con verduras.')).toBeVisible()
  await expect(disclosure).toBeVisible()
})
