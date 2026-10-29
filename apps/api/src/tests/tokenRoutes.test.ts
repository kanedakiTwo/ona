/**
 * Every route the read-only metrics token opens (specs/metrics.md). Pinned from
 * the source so that a new route behind `metricsAuth` (directly or through a
 * `readAuth` / `statsAuth` dependency that defaults to it) fails here until
 * someone has checked what it gives the token — services/agentView.ts is where
 * text written by or about users is reduced to counts and closed lists.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..')
const ROUTES = join(SRC, 'routes')

function tokenRoutes(): { files: string[]; routes: string[] } {
  const files: string[] = []
  const routes: string[] = []
  for (const name of readdirSync(ROUTES).filter((f) => f.endsWith('.ts')).sort()) {
    const text = readFileSync(join(ROUTES, name), 'utf8')
    if (!/\bmetricsAuth\b/.test(text)) continue
    files.push(name)
    // Dependencies that default to the token guard: `readAuth: metricsAuth`, `statsAuth: metricsAuth as …`.
    const deps = [...text.matchAll(/(\w+):\s*metricsAuth\b/g)].map((m) => m[1])
    const guard = new RegExp(`^(?:metricsAuth|\\w+\\.(?:${deps.join('|') || '(?!)'}))$`)
    for (const m of text.matchAll(/\.(get|post|put|patch|delete|all)\(\s*(['"`])([^'"`]+)\2\s*,\s*([\w.]+)/g)) {
      if (guard.test(m[4])) routes.push(`${m[1].toUpperCase()} ${m[3]}`)
    }
  }
  return { files, routes: routes.sort() }
}

describe('routes open to the read token', () => {
  it('are exactly these fourteen GETs: a new one needs its token view checked (services/agentView.ts) and this list updated', () => {
    const { files, routes } = tokenRoutes()
    expect(files).toEqual([
      'appErrors.ts',
      'blindComparison.ts',
      'catalogWishes.ts',
      'feedback.ts',
      'metrics.ts',
      'newsletter.ts',
      'notices.ts',
      'priceSurvey.ts',
      'waitlist.ts',
    ])
    expect(routes).toEqual([
      'GET /admin/assistant-reviews/flags',
      'GET /admin/catalog-wishes',
      'GET /admin/errors',
      'GET /admin/extension-gaps',
      'GET /admin/extension-sends',
      'GET /admin/feature-usage',
      'GET /admin/feedback',
      'GET /admin/menu-planner/comparison',
      'GET /admin/metrics',
      'GET /admin/newsletter/stats',
      'GET /admin/price-survey',
      'GET /admin/usage',
      'GET /admin/waitlist',
      'GET /notices/afina/stats',
    ])
  })
})
