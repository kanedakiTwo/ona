/**
 * PRO-92: public blog (specs/blog.md). Articles are Markdown files; only
 * `publicado: true` ones are listed and readable, the rest 404.
 *
 * Runs against the fixtures in e2e/fixtures/blog (one published, one not):
 * the e2e web server boots with BLOG_CONTENT_DIR=e2e/fixtures/blog (ci.yml,
 * scripts/test-e2e.sh), so nothing real has to be published for the suite.
 */

import { test, expect } from '@playwright/test'

const PUBLISHED = { slug: 'articulo-de-prueba-publicado', title: 'Artículo de prueba publicado' }
const DRAFT = { slug: 'borrador-de-prueba', title: 'Borrador de prueba sin publicar' }

test.use({ viewport: { width: 390, height: 844 } })

test('footer → /blog lists only the published articles', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('site-footer').getByRole('link', { name: 'Blog' }).click()
  await expect(page).toHaveURL(/\/blog$/, { timeout: 15_000 })
  await expect(page.getByRole('heading', { level: 1 })).toContainText('blog')
  await expect(page).toHaveTitle('Blog · Mimoia')

  const items = page.getByTestId('blog-item')
  await expect(items, 'arranca la web con BLOG_CONTENT_DIR=e2e/fixtures/blog').toHaveCount(1)
  await expect(items.first()).toContainText(PUBLISHED.title)
  await expect(page.getByText(DRAFT.title)).toHaveCount(0)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://mimoia.com/blog')
})

test('a published article reads with its title, SEO tags and the waitlist call', async ({ page }) => {
  await page.goto('/blog')
  await page.getByTestId('blog-item').first().getByRole('link').click()
  await expect(page).toHaveURL(new RegExp(`/blog/${PUBLISHED.slug}$`), { timeout: 15_000 })

  await expect(page.getByRole('heading', { level: 1, name: PUBLISHED.title })).toBeVisible()
  await expect(page.getByTestId('blog-body')).toContainText('Primer párrafo del artículo de prueba')
  await expect(page.getByTestId('blog-body').getByRole('heading', { level: 2, name: 'Una sección' })).toBeVisible()
  await expect(page.getByTestId('blog-body').getByRole('listitem')).toHaveCount(2)

  await expect(page).toHaveTitle(`${PUBLISHED.title} · Mimoia`)
  await expect(page.locator('meta[name="description"]')).toHaveCount(1)
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    'href',
    `https://mimoia.com/blog/${PUBLISHED.slug}`,
  )
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute('content', PUBLISHED.title)
  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'article')

  const cta = page.getByTestId('blog-cta')
  await cta.scrollIntoViewIfNeeded()
  await expect(cta).toBeVisible()
  await expect(cta.getByRole('link', { name: /lista de espera/i })).toHaveAttribute(
    'href',
    '/?ref=blog#lista-de-espera',
  )
})

test('an article with publicado: false is a 404', async ({ page }) => {
  const res = await page.goto(`/blog/${DRAFT.slug}`)
  expect(res?.status()).toBe(404)
  await expect(page.getByText('Este texto no debe verse nunca.')).toHaveCount(0)

  const unknown = await page.goto('/blog/no-existe')
  expect(unknown?.status()).toBe(404)
})

test('the sitemap lists /blog and the published article, not the draft', async ({ request }) => {
  const res = await request.get('/sitemap.xml')
  expect(res.status()).toBe(200)
  const xml = await res.text()
  expect(xml).toContain('<loc>https://mimoia.com/blog</loc>')
  expect(xml).toContain(`<loc>https://mimoia.com/blog/${PUBLISHED.slug}</loc>`)
  expect(xml).not.toContain(DRAFT.slug)
})
