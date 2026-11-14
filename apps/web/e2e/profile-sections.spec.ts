/**
 * PRO-1202 · el perfil, reordenado (maqueta 2026-11-12-perfil). Mobile (390×844).
 *
 * /profile shows what Mimo knows of the house in five sections, in this
 * order: Vuestra semana, Quién come, Cómo cocináis, Lo que os gusta, La
 * compra; no «Guardar cambios». The gear opens Ajustes with its four blocks
 * (Mimo, Avisos, Plan, Cuenta y privacidad). «Mis recetas» and «Recetarios»
 * live in Recetas; the old links still land somewhere; «Cerrar sesión»
 * signs out.
 */
import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
})

test('the profile in five sections, Ajustes behind the gear, Mis recetas in Recetas, and signing out', async ({ page }) => {
  test.setTimeout(180_000)
  await registerFreshUser(page)
  await completeOnboarding(page)

  // Perfil: the five sections, in order.
  await page.goto('/profile')
  const sections = ['week-type-head', 'who-eats', 'profile-cooking', 'profile-likes', 'profile-shopping']
  for (const id of sections) await expect(page.getByTestId(id)).toBeVisible({ timeout: 20_000 })
  const tops: number[] = []
  for (const id of sections) tops.push((await page.getByTestId(id).boundingBox())!.y)
  expect(tops).toEqual([...tops].sort((a, b) => a - b))
  await expect(page.getByTestId('week-type-head').getByRole('heading', { name: 'Vuestra semana' })).toBeVisible()
  await expect(page.getByTestId('who-eats')).toContainText('Quién come')
  await expect(page.getByRole('heading', { name: 'Cómo cocináis' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Lo que os gusta' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'La compra' })).toBeVisible()
  // What each section holds.
  for (const row of ['Tiempo', 'Aparatos', 'Nivel']) await expect(page.getByTestId('profile-cooking').getByRole('link', { name: new RegExp(`^${row}`) })).toBeVisible()
  await expect(page.getByTestId('profile-cooking-style')).toBeVisible()
  for (const row of ['Cocinas', 'No os gusta', 'Lo que os importa', 'Afina tu menú']) {
    await expect(page.getByTestId('profile-likes').getByRole('link', { name: new RegExp(`^${row}`) })).toBeVisible()
  }
  await expect(page.getByTestId('profile-likes').getByRole('link', { name: /^Afina tu menú/ })).toContainText(/\d+ de \d+ recetas valoradas/)
  await expect(page.getByTestId('profile-shopping').getByRole('link', { name: /^Básicos fijos/ })).toHaveAttribute('href', '/profile/staples')
  await expect(page.getByTestId('profile-shopping').getByRole('link', { name: /^Tus tiendas/ })).toHaveAttribute('href', '/compra/tiendas')
  // Strip under the name: «Cuéntale más» and the way to «Tu ficha».
  await expect(page.getByTestId('profile-ficha').getByRole('button', { name: 'Cuéntale más' })).toBeVisible()
  // Out of the profile: no «Guardar cambios», no settings, no recipes, no pantry.
  const main = page.locator('main')
  await expect(main.getByRole('button', { name: /guardar cambios/i })).toHaveCount(0)
  for (const gone of [/^Mis recetas/, /^Recetarios/, /^Despensa/, /^Suscripción/]) await expect(main.getByRole('link', { name: gone })).toHaveCount(0)
  await expect(main.getByRole('button', { name: /cerrar sesión|salir/i })).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  // The gear: Ajustes, with its four blocks.
  await page.getByTestId('profile-settings-link').click()
  await expect(page).toHaveURL(/\/profile\/ajustes$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible({ timeout: 15_000 })
  const blocks: Array<[string, string]> = [
    ['settings-mimo', 'Mimo'],
    ['settings-avisos', 'Avisos'],
    ['settings-plan', 'Plan'],
    ['settings-cuenta', 'Cuenta y privacidad'],
  ]
  for (const [id, title] of blocks) await expect(page.getByTestId(id).getByRole('heading', { name: title, exact: true })).toBeVisible()
  await expect(page.getByTestId('profile-mimo-voice')).toBeVisible()
  await expect(page.getByTestId('settings-mimo').getByRole('link', { name: /Cuéntaselo de una vez/ })).toHaveAttribute('href', '/onboarding/voz')
  await expect(page.getByTestId('profile-avisos-link')).toBeVisible()
  await expect(page.getByTestId('profile-newsletter')).toBeVisible()
  await expect(page.getByTestId('settings-plan').getByRole('link', { name: /Suscripción/ })).toHaveAttribute('href', '/profile/suscripcion')
  await expect(page.getByTestId('settings-health-consent')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Borrar mi cuenta' })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  // Its way back.
  await page.locator('main').getByRole('link', { name: 'Perfil', exact: true }).first().click()
  await expect(page).toHaveURL(/\/profile$/)

  // Recetas: «Mis recetas» and «Recetarios».
  await page.goto('/recipes')
  const yours = page.getByTestId('recipes-yours')
  await expect(yours.getByRole('link', { name: /^Mis recetas/ })).toBeVisible({ timeout: 20_000 })
  await yours.getByRole('link', { name: /^Mis recetas/ }).click()
  await expect(page).toHaveURL(/\/recipes\/mias$/)
  await expect(page.getByRole('heading', { level: 1, name: /creado tú/ })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Solo con pendientes')).toBeVisible({ timeout: 15_000 })
  await page.locator('main').getByRole('link', { name: 'Recetas', exact: true }).first().click()
  await expect(page).toHaveURL(/\/recipes$/)
  // «Este mes» and the counts load above and inside the links: click again until it lands.
  await expect(async () => {
    await page.getByTestId('recipes-yours').getByRole('link', { name: /^Recetarios/ }).click()
    await expect(page).toHaveURL(/\/recipes\/recetarios$/, { timeout: 3_000 })
  }).toPass({ timeout: 20_000 })
  await expect(page.getByRole('heading', { level: 1, name: /recetarios/ })).toBeVisible({ timeout: 15_000 })

  // The old links still work.
  await page.goto('/profile/cookbooks')
  await expect(page).toHaveURL(/\/recipes\/recetarios$/, { timeout: 15_000 })
  await page.goto('/profile/avisos')
  await expect(page.getByRole('heading', { name: /Qué te llega y por dónde/ })).toBeVisible({ timeout: 15_000 })
  await expect(page.locator('main').getByRole('link', { name: 'Ajustes', exact: true }).first()).toHaveAttribute('href', '/profile/ajustes')
  await page.goto('/profile/suscripcion')
  await expect(page.getByRole('heading', { level: 1, name: /Suscripción/ })).toBeVisible({ timeout: 15_000 })
  await page.goto('/profile/casa')
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 })

  // «Cerrar sesión», from Ajustes: back to the landing with the session gone.
  await page.goto('/profile/ajustes')
  await page.getByRole('button', { name: 'Cerrar sesión' }).click()
  await page.waitForURL((url) => url.pathname === '/', { timeout: 15_000 })
  expect(await page.evaluate(() => localStorage.getItem('ona_token'))).toBeNull()
})
