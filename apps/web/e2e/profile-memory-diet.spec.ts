/**
 * PRO-201: «Lo que recuerdo de ti» shows the diet, the allergies and who eats
 * at home from the profile, with a link to change them there — not an empty
 * «Restricciones · Añadir» for a vegetarian, nor «Adultos en casa · Añadir»
 * for a house of two (Laura, Marta y Jorge, 2026-10-17).
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('the memory shows the diet and the people of the profile', async ({ page }) => {
  await page.route('**/households/me/people', (route) =>
    route.fulfill({
      json: {
        people: [
          { id: 'me', kind: 'me', name: 'Laura', role: 'owner', ageBand: null, group: 'adult', restrictions: ['vegetariano'], answered: true, dislikes: [], canEdit: true },
          { id: 'u-2', kind: 'member', name: 'Jorge', role: 'member', ageBand: null, group: 'adult', restrictions: null, answered: null, dislikes: null, canEdit: false },
        ],
        counts: { adults: 2, kidsCount: 0 },
        healthConsent: true,
        canEdit: true,
      },
    }),
  )
  await page.goto('/profile/memoria')

  const diet = page.getByTestId('memory-profile-diet')
  await expect(diet).toContainText('vegetariano', { timeout: 15_000 })
  await expect(diet).toHaveAttribute('href', '/profile/quien/me')
  await expect(page.getByTestId('memory-profile-people')).toContainText('Laura (tú) y Jorge · 2 adultos')

  // No empty memory rows that contradict the profile.
  await expect(page.getByRole('heading', { name: 'Perfil físico' })).toBeVisible()
  await expect(page.getByText('Adultos en casa')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Restricciones.*Añadir/ })).toHaveCount(0)
})
