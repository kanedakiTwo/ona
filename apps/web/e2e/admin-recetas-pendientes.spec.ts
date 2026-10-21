/**
 * Admin → «Recetas pendientes» (/admin/recetas, specs/catalog-import.md):
 * Miguel sees the catalogue drafts by batch, publishes one (it opens for
 * everyone), discards another (it stays hidden, apart), and a batch file
 * that is wrong is told in Spanish before anything is imported. The import
 * itself needs the AI, so the drafts are seeded as the import leaves them
 * (_catalogDrafts.ts). 390×844, and once on desktop.
 */

import { test, expect, type Page } from '@playwright/test'
import { E2E_ADMIN } from './global-setup'
import { uniqueId } from './_helpers'
import { removeCatalogDrafts, seedCatalogDrafts, testDatabaseUrl } from './_catalogDrafts'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

async function loginAsAdmin(page: Page): Promise<string> {
  const r = await page.request.post(`${API_URL}/login`, { data: { username: E2E_ADMIN.username, password: E2E_ADMIN.password } })
  expect(r.ok()).toBeTruthy()
  const { token, user } = await r.json()
  test.skip(user?.role !== 'admin', 'needs ADMIN_EMAILS on the API (see global-setup.ts)')
  await page.addInitScript(
    ([t, u]) => {
      localStorage.setItem('ona_token', t)
      localStorage.setItem('ona_user', u)
    },
    [token, JSON.stringify(user)] as const,
  )
  return token
}

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('publish one draft, discard another, and a broken batch file is explained', async ({ page }) => {
    test.skip(!testDatabaseUrl(), 'needs DATABASE_URL (the API test database) to seed drafts')
    test.setTimeout(90_000)
    const tag = uniqueId().toLowerCase()
    const batch = `e2e-${tag}`.replace(/[^a-z0-9-]/g, '-').slice(0, 60)
    const guiso = `Guiso de prueba ${tag}`
    const crema = `Crema de prueba ${tag}`
    const ids = await seedCatalogDrafts(batch, [{ name: guiso, allergenDoubt: true, credit: 'Receta de la tía Inventada' }, { name: crema }])
    const [guisoId, cremaId] = ids
    try {
      await loginAsAdmin(page)
      // Nobody sees a draft yet.
      expect((await page.request.get(`${API_URL}/recipes/${guisoId}`)).status()).toBe(404)

      await page.goto('/admin/recetas')
      await expect(page.getByRole('heading', { level: 1, name: 'Recetas pendientes' })).toBeVisible({ timeout: 20_000 })
      const chapter = page.getByTestId('catalog-batch').filter({ has: page.getByRole('heading', { name: batch }) })
      await expect(chapter).toBeVisible({ timeout: 15_000 })
      const guisoRow = chapter.getByTestId('draft-row').filter({ hasText: guiso })
      const cremaRow = chapter.getByTestId('draft-row').filter({ hasText: crema })
      await expect(guisoRow).toBeVisible()
      await expect(cremaRow).toBeVisible()
      // Allergen doubts first, with the credit line and a link to the recipe.
      await expect(chapter.getByTestId('draft-row').first()).toContainText(guiso)
      await expect(guisoRow.getByText('Duda de alérgenos')).toBeVisible()
      await expect(guisoRow.getByText('Receta de la tía Inventada')).toBeVisible()
      await expect(guisoRow.getByRole('link', { name: guiso })).toHaveAttribute('href', `/recipes/${guisoId}`)
      // The page never scrolls sideways.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

      // «Publicar»: out of the list, and anyone opens it now.
      await guisoRow.getByRole('button', { name: `Publicar ${guiso}` }).click()
      await expect(page.getByRole('status').filter({ hasText: `«${guiso}» publicada.` })).toBeVisible({ timeout: 10_000 })
      await expect(guisoRow).toHaveCount(0)
      expect((await page.request.get(`${API_URL}/recipes/${guisoId}`)).status()).toBe(200)

      // «Descartar»: apart, under «Descartadas», still hidden for everyone.
      await cremaRow.getByRole('button', { name: `Descartar ${crema}` }).click()
      await expect(page.getByRole('status').filter({ hasText: `«${crema}» descartada` })).toBeVisible({ timeout: 10_000 })
      await expect(cremaRow).toHaveCount(0)
      await chapter.getByText('Descartadas (1)').click()
      await expect(chapter.getByTestId('discarded-row').filter({ hasText: crema })).toBeVisible()
      expect((await page.request.get(`${API_URL}/recipes/${cremaId}`)).status()).toBe(404)

      // A batch file that is not right: told in Spanish, nothing imported.
      const panel = page.getByTestId('catalog-import')
      await panel.getByRole('button', { name: 'Subir un JSON' }).click()
      await panel.getByTestId('catalog-import-file').setInputFiles({
        name: '2026-10-21-tanda-rota.json',
        mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify({ source: { origin: 'cocina' }, recipes: [{ name: 'Plato roto de prueba', ingredients: [], steps: ['Un paso.'] }] })),
      })
      await expect(panel.getByLabel('Nombre de la tanda')).toHaveValue('tanda-rota')
      await expect(panel.getByText('2026-10-21-tanda-rota.json')).toBeVisible()
      await panel.getByRole('button', { name: 'Comprobar' }).click()
      const problems = panel.getByTestId('catalog-import-problems')
      await expect(problems).toContainText('Receta 1 («Plato roto de prueba»): no tiene ingredientes.')
      await expect(panel.getByTestId('catalog-import-ready')).toHaveCount(0)

      // Not even JSON.
      await panel.getByLabel('O pega el JSON').fill('{ "recipes": [ { "name": "Sin cerrar" ')
      await panel.getByRole('button', { name: 'Comprobar' }).click()
      await expect(problems).toContainText('No es un JSON válido')
    } finally {
      await removeCatalogDrafts(ids, batch)
    }
  })
})

test.describe('desktop', () => {
  test.use({ viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false })

  test('the sidebar opens it, with the index of batches on the left', async ({ page }) => {
    test.skip(!testDatabaseUrl(), 'needs DATABASE_URL (the API test database) to seed drafts')
    test.setTimeout(60_000)
    const tag = uniqueId().toLowerCase()
    const batch = `e2e-${tag}`.replace(/[^a-z0-9-]/g, '-').slice(0, 60)
    const ids = await seedCatalogDrafts(batch, [{ name: `Ensalada de prueba ${tag}`, auditIssues: ['sin_pasos'] }])
    try {
      await loginAsAdmin(page)
      await page.goto('/admin')
      const adminNav = page.getByRole('navigation', { name: 'Admin', exact: true })
      await expect(adminNav).toBeVisible({ timeout: 15_000 })
      await adminNav.getByRole('link', { name: 'Recetas pendientes' }).click()
      await expect(page).toHaveURL(/\/admin\/recetas$/)
      await expect(adminNav.getByRole('link', { name: 'Recetas pendientes' })).toHaveAttribute('aria-current', 'page')
      await expect(page.getByRole('navigation', { name: 'Índice de tandas' }).getByRole('link', { name: new RegExp(batch) })).toBeVisible({ timeout: 15_000 })
      // The audit holds it: «Publicar» is off and says why.
      const row = page.getByTestId('draft-row').filter({ hasText: `Ensalada de prueba ${tag}` })
      await expect(row.getByText('Auditoría: sin pasos')).toBeVisible()
      await expect(row.getByRole('button', { name: `Publicar Ensalada de prueba ${tag}` })).toBeDisabled()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1440)
    } finally {
      await removeCatalogDrafts(ids, batch)
    }
  })
})
