/**
 * Content shows as soon as it's ready: no splash, no full-screen loader.
 *
 * Until 2026-10-08 every full page load mounted `ClientSplash` (a fixed
 * `inset-0 z-[200]` ink-drop animation on a hard-coded ~2.4 s timer, with the
 * old wordmark even on the public Mimoia site), and `app/loading.tsx`
 * was a `fixed inset-0 z-[120]` cream takeover that hid the whole app —
 * bottom nav included — on every route transition. Both are gone; the global
 * loading state is now a 2 px terracotta bar at the top that only fades in
 * after 300 ms.
 *
 * A recorder installed before any page script notes every element that, at
 * any moment, is a fixed full-viewport layer stacked at z-index ≥ 100 — the
 * shape of both removed loaders.
 */

import { test, expect, type Locator, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

type OverlayWindow = Window & { __overlays: string[] }

function recordFullScreenOverlays() {
  const w = window as unknown as OverlayWindow
  w.__overlays = []
  const check = (el: Element) => {
    if (!(el instanceof HTMLElement)) return
    const cs = getComputedStyle(el)
    if (cs.position !== 'fixed') return
    const z = Number.parseInt(cs.zIndex, 10)
    if (!(z >= 100)) return
    const r = el.getBoundingClientRect()
    if (r.width >= innerWidth * 0.9 && r.height >= innerHeight * 0.9) {
      w.__overlays.push(`<${el.tagName.toLowerCase()} class="${el.className}"> z=${z} at ${Math.round(performance.now())} ms`)
    }
  }
  new MutationObserver((records) => {
    for (const rec of records) {
      rec.addedNodes.forEach((n) => {
        if (!(n instanceof Element)) return
        check(n)
        n.querySelectorAll('*').forEach(check)
      })
    }
  }).observe(document, { childList: true, subtree: true })
}

function overlays(page: Page): Promise<string[]> {
  return page.evaluate(() => (window as unknown as OverlayWindow).__overlays)
}

/** True when nothing is painted over the element's centre. */
function isTopmost(locator: Locator): Promise<boolean> {
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    return !!hit && (hit === el || el.contains(hit))
  })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(recordFullScreenOverlays)
})

test('the landing paints its hero right away, with no splash on top', async ({ page }) => {
  await page.goto('/', { waitUntil: 'domcontentloaded' })

  const hero = page.getByRole('heading', { name: /es decidir/i })
  await expect(hero).toBeVisible()
  // The hero's entrance animation runs once React has hydrated (motion
  // server-renders it at opacity 0). The old splash mounted at that same
  // moment and sat on top for ~2.4 s.
  const lastLine = page.getByText('Es decidir.')
  await expect
    .poll(() => lastLine.evaluate((el) => getComputedStyle(el).opacity), { timeout: 20_000 })
    .toBe('1')

  expect(await overlays(page)).toEqual([])
  expect(await isTopmost(lastLine)).toBe(true)
})

test('moving between app tabs keeps the nav on screen: no full-screen loader', async ({ page }) => {
  await registerFreshUser(page)
  await completeOnboarding(page)

  const recetas = page
    .getByRole('navigation')
    .getByRole('link', { name: 'Recetas', exact: true })
  await expect(recetas).toBeVisible({ timeout: 20_000 })

  // The route's loading state is on screen while the page's JS chunk loads.
  // Hold that chunk so it stays up long enough to inspect, however fast the
  // server is (`next dev`: app/recipes/page.js, build: page-<hash>.js).
  let release!: () => void
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  await page.route(/\/_next\/static\/chunks\/app\/recipes\/page/, async (route) => {
    await held
    await route.continue()
  })

  // Only judge the navigation itself (the first test covers the full load).
  await page.evaluate(() => {
    ;(window as unknown as OverlayWindow).__overlays = []
  })
  await recetas.click()
  await expect(page).toHaveURL(/\/recipes$/)
  expect(await overlays(page)).toEqual([])

  // The loading indicator is a thin bar that fades in after its grace period.
  const bar = page.getByRole('progressbar', { name: 'Cargando' })
  await expect(bar).toBeVisible()
  await expect.poll(() => bar.evaluate((el) => getComputedStyle(el).opacity)).toBe('1')
  const box = await bar.boundingBox()
  expect(box?.height ?? 0).toBeLessThanOrEqual(4)

  // The nav is still there and nothing covers it.
  await expect(recetas).toBeVisible()
  expect(await isTopmost(recetas)).toBe(true)

  release()
  await expect(bar).toHaveCount(0, { timeout: 20_000 })
  expect(await overlays(page)).toEqual([])
})
