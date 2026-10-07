#!/usr/bin/env node
/**
 * Post-build guard for the generated service worker (public/sw.js).
 *
 * `api-cache` stores API responses keyed by URL only — not by user. It is safe
 * only if every route writing to it (a) is anchored on the API origin
 * (Workbox silently ignores a cross-origin regex that doesn't match at index
 * 0, which is how the old `/\/menu\/.*$/` rule cached nothing from the API
 * and only page shells) and (b) is NetworkFirst, so online users always get
 * fresh data for their own token. See next.config.ts and
 * lib/pwa/sessionData.ts. Exits 1 on any violation.
 */
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const swPath = process.argv[2] ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sw.js')

if (!existsSync(swPath)) {
  // next-pwa is disabled in development builds; nothing to check.
  console.log(`[verify-sw] ${swPath} not found — PWA disabled, skipping`)
  process.exit(0)
}

const sw = readFileSync(swPath, 'utf8')

/** Each `registerRoute(<matcher>, <handler>, "<METHOD>")` call, as raw text. */
function routes(source) {
  const out = []
  let at = source.indexOf('registerRoute(')
  while (at !== -1) {
    let depth = 0
    let i = at + 'registerRoute'.length
    for (; i < source.length; i++) {
      const c = source[i]
      if (c === '(') depth++
      else if (c === ')') {
        depth--
        if (depth === 0) break
      }
    }
    out.push(source.slice(at, i + 1))
    at = source.indexOf('registerRoute(', i)
  }
  return out
}

const all = routes(sw)
const apiRoutes = all.filter((r) => /cacheName:\s*["']api-cache["']/.test(r))
const problems = []

if (apiRoutes.length < 3) {
  problems.push(`expected ≥ 3 api-cache routes (recipes, menu, shopping-list), found ${apiRoutes.length}`)
}
for (const r of apiRoutes) {
  const matcher = r.slice('registerRoute('.length).trimStart()
  if (!/^\/\^https?:/.test(matcher)) problems.push(`api-cache route not anchored on the API origin: ${r.slice(0, 160)}`)
  if (!/NetworkFirst/.test(r)) problems.push(`api-cache route must be NetworkFirst: ${r.slice(0, 160)}`)
}

if (problems.length > 0) {
  console.error('[verify-sw] service worker caching is unsafe:\n - ' + problems.join('\n - '))
  process.exit(1)
}
console.log(`[verify-sw] ok — ${apiRoutes.length} api-cache routes, all anchored + NetworkFirst`)
