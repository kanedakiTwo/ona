/**
 * PRO-228 · /profile/pantry groups what's at home by place (Nevera,
 * Congelador, Despensa). Adding with «Dónde está» puts it in its group, the
 * freezer says since when, and the row's «···» moves it.
 */
import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

test('the pantry groups by place and moves things between them', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  await page.goto('/profile/pantry')

  const add = async (name: string, place: string) => {
    await page.getByLabel('Nombre', { exact: true }).fill(name)
    await page.getByLabel('Dónde está').selectOption({ label: place })
    await page.getByRole('button', { name: 'Añadir a despensa' }).click()
    await expect(page.getByRole('button', { name: new RegExp(`Opciones de ${name}`) })).toBeVisible({ timeout: 10_000 })
  }
  await expect(page.getByLabel('Nombre', { exact: true })).toBeVisible({ timeout: 20_000 })
  await add('Arroz bomba', 'Despensa')
  await add('Merluza', 'Congelador')
  await add('Nata', 'Nevera')

  const fridge = page.getByTestId('pantry-group-nevera')
  const freezer = page.getByTestId('pantry-group-congelador')
  const pantry = page.getByTestId('pantry-group-despensa')
  await expect(fridge).toContainText('Nata')
  await expect(freezer).toContainText('Merluza')
  await expect(freezer).toContainText('En el congelador desde el')
  await expect(pantry).toContainText('Arroz bomba')
  await expect(pantry).not.toContainText('Merluza')
  // Order on the page: nevera → congelador → despensa.
  const tops = await Promise.all([fridge, freezer, pantry].map(async (g) => (await g.boundingBox())!.y))
  expect(tops[0]).toBeLessThan(tops[1])
  expect(tops[1]).toBeLessThan(tops[2])

  // Move the rice to the freezer from its «···».
  await pantry.getByRole('button', { name: /Opciones de Arroz bomba/ }).click()
  await page.getByRole('group', { name: 'Dónde está' }).getByRole('button', { name: 'Congelador' }).click()
  await page.keyboard.press('Escape')
  await expect(freezer).toContainText('Arroz bomba', { timeout: 10_000 })
  await expect(page.getByTestId('pantry-group-despensa')).toHaveCount(0)
})
