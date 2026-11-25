/**
 * PRO-397: the real catalogue for e2e (`real-catalog.spec.ts`).
 *
 * The suite runs on a small seed (~170 recipes): the 2026-11-03 picker bug
 * (it loaded the first 100 of 389) never showed in it. This fixture gives a
 * spec a copy of staging's catalogue — staging carries production's, the
 * `sync-staging-catalog.sh` copy — in a database of its own, behind a second
 * API, so every other spec keeps the seed:
 *
 *   - `realCatalog` (worker): `apps/api/scripts/e2eRealCatalog.ts` creates
 *     `<suite db>_catalogo_real` next to the suite's database, migrates it
 *     and copies the catalogue through staging's public API (once per
 *     machine: later workers find it filled), then boots the API on it at
 *     REAL_CATALOG_API_PORT (8766). Killed when the worker ends.
 *   - `catalogApi` (test): the browser's calls to the suite's API go to that
 *     one instead (the web was built with NEXT_PUBLIC_API_URL baked in), and
 *     `process.env.API_URL`, which `_helpers.ts` reads on every call, points
 *     at it for the test. Recipe photos (production's and staging's hosts)
 *     are not loaded.
 *
 * Projects (playwright.config.ts) set `displayMode: 'standalone'` for the
 * installed app: Chromium can't emulate `display-mode` (not in CDP's
 * emulated media), so `matchMedia('(display-mode: standalone)')` answers
 * true and the stylesheets' `@media (display-mode: standalone)` rules apply.
 *
 * Env: DATABASE_URL (the suite's, as in CI) or REAL_CATALOG_DATABASE_URL;
 * REAL_CATALOG_SOURCE (default staging's API). Without either database URL
 * the specs skip — except in CI, where that is a failure.
 */
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { test as base, expect } from '@playwright/test'

export type DisplayMode = 'browser' | 'standalone'

export interface RealCatalog {
  /** The API serving the copy. */
  api: string
  /** Published catalogue recipes in the copy. */
  recipes: number
}

const SUITE_API = (process.env.API_URL ?? 'http://localhost:8765').replace(/\/+$/, '')
const PORT = Number(process.env.REAL_CATALOG_API_PORT ?? 8766)
const API_DIR = path.resolve(__dirname, '../../api')

/** Same rule as `realCatalogDatabaseUrl` in apps/api/scripts/e2eRealCatalog.ts. */
function catalogueDatabaseUrl(): string | null {
  if (process.env.REAL_CATALOG_DATABASE_URL) return process.env.REAL_CATALOG_DATABASE_URL
  if (!process.env.DATABASE_URL) return null
  const u = new URL(process.env.DATABASE_URL)
  u.pathname = `/${u.pathname.replace(/^\//, '') || 'postgres'}_catalogo_real`
  return u.toString()
}

async function waitForHealth(url: string, api: ChildProcess, log: () => string): Promise<void> {
  for (let i = 0; i < 90; i++) {
    if (api.exitCode != null) throw new Error(`the real-catalogue API exited (${api.exitCode}):\n${log()}`)
    try {
      if ((await fetch(`${url}/health`)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 1_000))
  }
  throw new Error(`the real-catalogue API never answered /health:\n${log()}`)
}

export const test = base.extend<
  { displayMode: DisplayMode; catalogApi: string },
  { realCatalog: RealCatalog | null }
>({
  displayMode: ['browser', { option: true }],

  realCatalog: [
    async ({}, use) => {
      const target = catalogueDatabaseUrl()
      if (!target) {
        if (process.env.CI) throw new Error('DATABASE_URL is not set: the real-catalogue e2e needs it')
        await use(null)
        return
      }
      const args = ['exec', 'tsx', 'scripts/e2eRealCatalog.ts']
      if (process.env.REAL_CATALOG_SOURCE) args.push('--source', process.env.REAL_CATALOG_SOURCE)
      const prepared = spawnSync('pnpm', args, {
        cwd: API_DIR,
        env: {
          ...process.env,
          DATABASE_URL: target,
          ...(process.env.REAL_CATALOG_DATABASE_URL ? {} : { CREATE_FROM_DATABASE_URL: process.env.DATABASE_URL }),
        },
        encoding: 'utf8',
        timeout: 240_000,
      })
      const summary = prepared.stdout.trim().split('\n').pop() ?? ''
      if (prepared.status !== 0) {
        throw new Error(`could not prepare the real catalogue (${prepared.status}):\n${prepared.stderr.slice(-3000)}`)
      }
      const { recipes } = JSON.parse(summary) as { recipes: number }

      const url = `http://localhost:${PORT}`
      let out = ''
      const api = spawn('pnpm', ['exec', 'tsx', 'src/index.ts'], {
        cwd: API_DIR,
        env: { ...process.env, DATABASE_URL: target, API_PORT: String(PORT), API_URL: url, REGISTRATION_MODE: 'open' },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      })
      const keep = (c: Buffer) => {
        out = (out + c.toString()).slice(-5000)
      }
      api.stdout?.on('data', keep)
      api.stderr?.on('data', keep)
      try {
        await waitForHealth(url, api, () => out)
        await use({ api: url, recipes })
      } finally {
        // pnpm → tsx → node: the whole group.
        try {
          if (api.pid) process.kill(-api.pid, 'SIGTERM')
        } catch {
          // already gone
        }
      }
    },
    { scope: 'worker', timeout: 300_000 },
  ],

  catalogApi: async ({ context, realCatalog }, use) => {
    base.skip(!realCatalog, 'no DATABASE_URL / REAL_CATALOG_DATABASE_URL: no real-catalogue copy')
    if (!realCatalog) return
    const before = process.env.API_URL
    process.env.API_URL = realCatalog.api
    await context.route(`${SUITE_API}/**`, (route) =>
      route.continue({ url: realCatalog.api + route.request().url().slice(SUITE_API.length) }),
    )
    await context.route(/^https:\/\/ona-api-(production|staging)\.up\.railway\.app\//, (route) => route.abort())
    try {
      await use(realCatalog.api)
    } finally {
      if (before === undefined) delete process.env.API_URL
      else process.env.API_URL = before
    }
  },

  page: async ({ page, displayMode }, use) => {
    if (displayMode === 'standalone') {
      await page.addInitScript(() => {
        const STANDALONE = /display-mode:\s*standalone/
        const real = window.matchMedia.bind(window)
        window.matchMedia = (q: string) =>
          STANDALONE.test(q)
            ? ({ matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => false } as unknown as MediaQueryList)
            : real(q)
        // The CSS side: those @media rules apply to every screen.
        const applyRules = () => {
          for (const sheet of Array.from(document.styleSheets)) {
            let rules: CSSRuleList
            try {
              rules = sheet.cssRules
            } catch {
              continue // another origin's
            }
            for (const rule of Array.from(rules)) {
              if (rule instanceof CSSMediaRule && STANDALONE.test(rule.media.mediaText)) rule.media.mediaText = 'all'
            }
          }
        }
        // Next adds its stylesheets to <head> as the routes load.
        new MutationObserver((records) => {
          for (const r of records) {
            for (const n of Array.from(r.addedNodes)) {
              if (n instanceof HTMLStyleElement) applyRules()
              if (n instanceof HTMLLinkElement) n.addEventListener('load', applyRules)
            }
          }
        }).observe(document, { childList: true, subtree: true })
        document.addEventListener('DOMContentLoaded', applyRules)
        window.addEventListener('load', applyRules)
      })
    }
    await use(page)
  },
})

export { expect }
