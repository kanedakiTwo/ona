/**
 * 23-nov, a friend of Miguel's on iPhone: «no me recordaba ni el usuario» and
 * «el link me manda al registro, no al acceso» (an invitation `/i/<code>` →
 * /register). The sign-up saves the EMAIL as the password manager's username
 * (what people type to log in), says «¿Ya tienes cuenta? Entra» at the top,
 * and someone already signed in in this browser goes in instead.
 */
import { test, expect } from '@playwright/test'
import { registerFreshUser } from './_helpers'

test('the password manager saves the email with the password', async ({ page }) => {
  await page.goto('/register')
  await expect(page.getByLabel('Email')).toHaveAttribute('autocomplete', 'username')
  await expect(page.getByLabel('Nombre de usuario')).toHaveAttribute('autocomplete', 'nickname')
  await expect(page.getByLabel('Contraseña')).toHaveAttribute('autocomplete', 'new-password')
})

test('«¿Ya tienes cuenta? Entra» at the top goes to login', async ({ page }) => {
  await page.goto('/register?campana=abcd2345')
  const link = page.getByTestId('register-login-link')
  await expect(link).toBeVisible()
  await link.click()
  await expect(page).toHaveURL(/\/login/)
})

test('signed in already: an invitation link to /register goes to the menu', async ({ page }) => {
  await registerFreshUser(page)
  await page.goto('/register?campana=abcd2345')
  await expect(page).toHaveURL(/\/menu/, { timeout: 10_000 })
})
