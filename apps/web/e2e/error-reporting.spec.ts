/**
 * In-house error tracker (specs/errors.md): an error the user hits in the
 * browser must reach POST /client-errors — once per page load, with the path
 * but never the query string. The endpoint is mocked here; the API side
 * (validation, scrubbing, grouping) is covered by the vitest suite.
 */

import { test, expect, type Page } from '@playwright/test'

interface Captured {
  body: { kind?: string; message?: string; path?: string; stack?: string }
  raw: string
  contentType: string | undefined
}

async function captureReports(page: Page): Promise<Captured[]> {
  const reports: Captured[] = []
  // `next dev` keeps the reporter off unless forced (production has it on).
  await page.addInitScript(() => {
    ;(window as Window & { __ONA_ERROR_REPORTING__?: boolean }).__ONA_ERROR_REPORTING__ = true
  })
  await page.route('**/client-errors', async (route) => {
    const req = route.request()
    const raw = req.postData() ?? ''
    reports.push({ body: JSON.parse(raw || '{}'), raw, contentType: req.headers()['content-type'] })
    await route.fulfill({ status: 204 })
  })
  return reports
}

test('an uncaught error is reported once, with the path and without the query string', async ({ page }) => {
  const reports = await captureReports(page)
  await page.goto('/?utm_source=e2e&token=secreto')

  const boom = () => reports.filter((r) => r.body.message?.includes('e2e-boom'))
  // The listener is installed after hydration: throw (via setTimeout, so it
  // is a real uncaught error) until the first report arrives.
  await expect(async () => {
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('e2e-boom')
      }, 0)
    })
    await page.waitForTimeout(150)
    expect(boom().length).toBeGreaterThan(0)
  }).toPass({ timeout: 20_000 })

  const [report] = boom()
  expect(report.body).toMatchObject({ kind: 'client', message: 'e2e-boom', path: '/' })
  expect(report.raw).not.toContain('secreto')
  expect(report.raw).not.toContain('utm_source')
  expect(report.contentType).toContain('text/plain')

  // Same error, same place, same page load → not sent again.
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('e2e-boom')
      }, 0)
    })
  }
  await page.waitForTimeout(500)
  expect(boom()).toHaveLength(1)
})

test('an unhandled promise rejection is reported too', async ({ page }) => {
  const reports = await captureReports(page)
  await page.goto('/')

  await expect(async () => {
    await page.evaluate(() => {
      void Promise.reject(new TypeError('e2e-rejected'))
    })
    await page.waitForTimeout(150)
    expect(reports.some((r) => r.body.message === 'TypeError: e2e-rejected')).toBe(true)
  }).toPass({ timeout: 20_000 })
})
