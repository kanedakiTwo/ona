/**
 * One public grid (2026-10-15, specs/design-system.md → "Public grid").
 *
 * Before this, the public site used four horizontal grids: the navbar's
 * 1200 px box, the footer's 1024 px, /como-funciona's 1280 px and the legal
 * pages' centred 720 px column, so the navbar logo, the page title and the
 * footer logo never lined up. Now every public page sits on the
 * `public-container` utility (globals.css: 1200 px content, 24 px gutter on
 * mobile, 40 px from md).
 *
 * Desktop (1440 and 1920): navbar logo x == footer logo x == h1 x (±2) and
 * navbar right edge == footer right edge (±2). Reading pages (legal + blog
 * article) keep a ~720 px column, left-aligned on the same grid line.
 * Mobile (390): the same 24 px gutter everywhere and no horizontal scroll.
 */

import { test, expect, type Page } from '@playwright/test'

const BLOG_ARTICLE = '/blog/articulo-de-prueba-publicado'

/** Pages whose main title must start on the grid line. */
const WIDE_PAGES = [
  '/',
  '/como-funciona',
  '/precios',
  '/blog',
  '/lista/codigo-que-no-existe',
  '/lista/baja',
  '/newsletter/baja',
]

/** Reading pages: a ~720 px text column, left-aligned on the grid line. */
const READING_PAGES = ['/privacidad', '/terminos', '/aviso-legal', BLOG_ARTICLE]

const TOLERANCE = 2

async function box(page: Page, selector: string) {
  const loc = page.locator(selector).first()
  await expect(loc).toBeVisible({ timeout: 15_000 })
  const b = await loc.boundingBox()
  if (!b) throw new Error(`no box for ${selector}`)
  return { left: b.x, right: b.x + b.width, width: b.width }
}

async function gridLines(page: Page, path: string) {
  await page.goto(path)
  const navLogo = await box(page, '[data-testid="public-logo"]')
  const navRight = await box(page, '[data-testid="public-nav-cta"]')
  const footLogo = await box(page, '[data-testid="footer-logo"]')
  const footRight = await box(page, '[data-testid="footer-meta"]')
  const h1 = await box(page, 'h1')
  return { navLogo, navRight, footLogo, footRight, h1 }
}

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test.describe(`desktop ${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, isMobile: false, hasTouch: false })

    test('wide public pages: logo, title and footer share the grid line', async ({ page }) => {
      test.setTimeout(120_000)
      // Content box is 1200 px centred: the line sits at (vw − 1200) / 2.
      const expectedLeft = (viewport.width - 1200) / 2
      for (const path of WIDE_PAGES) {
        const g = await gridLines(page, path)
        expect(Math.abs(g.navLogo.left - expectedLeft), `${path} navbar logo x`).toBeLessThanOrEqual(TOLERANCE)
        expect(Math.abs(g.footLogo.left - g.navLogo.left), `${path} footer logo x`).toBeLessThanOrEqual(TOLERANCE)
        expect(Math.abs(g.h1.left - g.navLogo.left), `${path} h1 x`).toBeLessThanOrEqual(TOLERANCE)
        expect(Math.abs(g.footRight.right - g.navRight.right), `${path} right edge`).toBeLessThanOrEqual(TOLERANCE)
        expect(Math.abs(g.navRight.right - (viewport.width - expectedLeft)), `${path} navbar right`).toBeLessThanOrEqual(TOLERANCE)
      }
    })

    test('reading pages: a ~720 px column left-aligned on the grid line', async ({ page }) => {
      test.setTimeout(90_000)
      for (const path of READING_PAGES) {
        const g = await gridLines(page, path)
        const column = await box(page, '[data-testid="reading-column"]')
        expect(Math.abs(g.footLogo.left - g.navLogo.left), `${path} footer logo x`).toBeLessThanOrEqual(TOLERANCE)
        expect(Math.abs(g.footRight.right - g.navRight.right), `${path} right edge`).toBeLessThanOrEqual(TOLERANCE)
        expect(Math.abs(column.left - g.navLogo.left), `${path} column x`).toBeLessThanOrEqual(TOLERANCE)
        expect(Math.abs(g.h1.left - g.navLogo.left), `${path} h1 x`).toBeLessThanOrEqual(TOLERANCE)
        expect(column.width, `${path} column width`).toBeGreaterThanOrEqual(680)
        expect(column.width, `${path} column width`).toBeLessThanOrEqual(722)
      }
    })
  })
}

test.describe('mobile 390×844', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('every public page: same 24 px gutter and no horizontal scroll', async ({ page }) => {
    test.setTimeout(120_000)
    for (const path of [...WIDE_PAGES, ...READING_PAGES]) {
      await page.goto(path)
      const logo = await box(page, '[data-testid="public-logo"]')
      const h1 = await box(page, 'h1')
      expect(Math.abs(logo.left - 24), `${path} navbar logo x`).toBeLessThanOrEqual(TOLERANCE)
      expect(Math.abs(h1.left - 24), `${path} h1 x`).toBeLessThanOrEqual(TOLERANCE)
      // Let lazy sections (counter, in-view animations) mount before measuring.
      await page.getByTestId('site-footer').scrollIntoViewIfNeeded()
      const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth)
      expect(scrollWidth, `${path} scrollWidth`).toBeLessThanOrEqual(390)
    }
  })
})
