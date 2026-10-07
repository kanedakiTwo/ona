import type { NextConfig } from 'next'
import withPWA from 'next-pwa'

const nextConfig: NextConfig = {
  transpilePackages: ['@ona/shared'],
  output: 'standalone',
  env: {
    // Build id sent with client error reports (specs/errors.md). Explicit
    // value wins; else Railway's commit SHA (git deploys) or deployment id
    // (`railway up`), when Railway exposes them at build time.
    NEXT_PUBLIC_RELEASE:
      process.env.NEXT_PUBLIC_RELEASE || process.env.RAILWAY_GIT_COMMIT_SHA || process.env.RAILWAY_DEPLOYMENT_ID || '',
  },
  images: {
    // No server-side image optimizer. Recipe images live on arbitrary
    // third-party hosts (blogs, YouTube thumbnails, our API volume), and an
    // open optimizer (`remotePatterns: '**'`) is an unauthenticated
    // fetch-and-decode endpoint for any URL — it carried a critical RCE
    // (GHSA-2xp9-vwfh-vxw4, AVIF/libheif) in Next < 15.5.24. The app renders
    // recipe photos with plain <img>; next/image (one call site) just emits
    // the original URL.
    unoptimized: true,
  },
  // One canonical host. Railway serves both mimoia.com and www.mimoia.com
  // (each with its own cert); www bounces to the apex keeping path + query.
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'www.mimoia.com' }],
        destination: 'https://mimoia.com/:path*',
        permanent: true,
      },
    ]
  },
}

// API responses carry the user's data and the cache keys them by URL only
// (no Authorization). So: patterns anchored on the API origin (a cross-origin
// regex that doesn't match at index 0 is silently ignored by Workbox), and
// NetworkFirst — online you always get fresh data for *your* token; the cache
// is only the offline fallback. lib/pwa/sessionData.ts wipes `api-cache` on
// login / register / logout / rejected token. scripts/verify-sw.mjs checks the
// generated sw.js on every build.
const API_ORIGIN = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/+$/, '')
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const apiRoute = (resource: string) => new RegExp(`^${escapeRegExp(API_ORIGIN)}/${resource}(?:[/?]|$)`)

const apiNetworkFirst = (resource: string) => ({
  urlPattern: apiRoute(resource),
  handler: 'NetworkFirst' as const,
  method: 'GET' as const,
  options: {
    cacheName: 'api-cache',
    networkTimeoutSeconds: 5,
    expiration: { maxEntries: 150, maxAgeSeconds: 7 * 24 * 60 * 60 },
    cacheableResponse: { statuses: [200] },
  },
})

const runtimeCaching = [
  // Opened recipes, this week's menu and shopping list stay readable offline.
  apiNetworkFirst('recipes'),
  apiNetworkFirst('menu'),
  apiNetworkFirst('shopping-list'),
  // App pages (HTML shells — the session lives in localStorage, so they carry
  // no user data): last version offline, `/offline` fallback otherwise.
  {
    urlPattern: ({ request, url }: { request: Request; url: URL }) =>
      request.mode === 'navigate' && url.origin === self.location.origin,
    handler: 'NetworkFirst' as const,
    method: 'GET' as const,
    options: {
      cacheName: 'pages',
      networkTimeoutSeconds: 5,
      expiration: { maxEntries: 50, maxAgeSeconds: 7 * 24 * 60 * 60 },
      cacheableResponse: { statuses: [200] },
    },
  },
  // Recipe images — cache-first (LRU 200 entries / ~50MB / 30 days)
  {
    urlPattern: /\/images\/recipes\/.*\.(?:jpg|jpeg|png|webp)$/i,
    handler: 'CacheFirst' as const,
    method: 'GET' as const,
    options: {
      cacheName: 'recipe-images',
      expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
  // Mutations always go to the network
  {
    urlPattern: /.*/,
    handler: 'NetworkOnly' as const,
    method: 'POST' as const,
    options: {},
  },
  {
    urlPattern: /.*/,
    handler: 'NetworkOnly' as const,
    method: 'PUT' as const,
    options: {},
  },
  {
    urlPattern: /.*/,
    handler: 'NetworkOnly' as const,
    method: 'DELETE' as const,
    options: {},
  },
]

export default withPWA({
  dest: 'public',
  register: true,
  skipWaiting: true,
  disable: process.env.NODE_ENV === 'development',
  // Next.js generates `app-build-manifest.json` for build introspection
  // but does NOT serve it in `output: 'standalone'` mode. next-pwa lists
  // it in the precache regardless, so the service worker install crashes
  // with `bad-precaching-response :: status 404` and never activates —
  // which is exactly why every Web Push subscribe attempt has been
  // hanging at the `sw-ready` phase. Exclude the file from the manifest.
  buildExcludes: [/app-build-manifest\.json$/],
  runtimeCaching,
  // @ts-expect-error - @types/next-pwa requires all FallbackRoutes fields, but next-pwa accepts a partial object
  // Note: next-pwa's fallback worker is compiled with babel-loader, so `babel-loader`
  // must remain in devDependencies (it's a transitive requirement of next-pwa@5).
  fallbacks: {
    document: '/offline',
  },
})(
  // @types/next-pwa's `next` peer is pinned to the app's Next via a pnpm
  // override (it used to drag in a vulnerable Next 13 and its NextConfig type).
  nextConfig,
)
