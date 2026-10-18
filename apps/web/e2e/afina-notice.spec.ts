/**
 * PRO-205 at 390×844: the «Afina tu menú» notice in the app — a card above
 * the menu with Legal's text until «Entendido», which closes it for the
 * household. Who sees it is decided by the API (afinaNotice.smoke.ts); here
 * the API answer is stubbed so the card shows for a fresh account.
 */
import { test, expect } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const TEXT = '¡Hola! Un aviso rápido: si usaste «Afina tu menú» estos días, puede que te enseñara algún plato que no encaja con lo que nos dijiste (alergias o cosas que no coméis en casa).'

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
})

test('/menu: the notice card until «Entendido»', async ({ page }) => {
  test.setTimeout(90_000)
  let dismissed = 0
  await page.route(/\/notices\/afina$/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(dismissed ? { show: false } : { show: true, text: TEXT }) }),
  )
  await page.route(/\/notices\/afina\/dismiss$/, (route) => {
    dismissed += 1
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
  })
  await registerFreshUser(page)
  await completeOnboarding(page)
  await page.goto('/menu')

  const card = page.getByTestId('afina-notice')
  await expect(card).toBeVisible({ timeout: 20_000 })
  await expect(card.getByRole('heading', { name: /un fallo en «afina tu menú», ya arreglado/i })).toBeVisible()
  await expect(card).toContainText('¡Hola! Un aviso rápido')
  await expect(card.getByRole('link', { name: 'Ir a mi perfil' })).toHaveAttribute('href', '/profile')
  const box = (await card.boundingBox())!
  expect(box.x).toBeGreaterThanOrEqual(0)
  expect(box.x + box.width).toBeLessThanOrEqual(390)

  await card.getByRole('button', { name: 'Entendido' }).click()
  await expect(card).toHaveCount(0)
  expect(dismissed).toBe(1)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('afina-notice')).toHaveCount(0)
})
