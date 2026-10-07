import type { NextConfig } from 'next'
import withPWA from 'next-pwa'

const nextConfig: NextConfig = {
  transpilePackages: ['@ona/shared'],
  output: 'standalone',
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
}

const runtimeCaching = [
  // GET /recipes (and /recipes/:id, query strings) — stale-while-revalidate
  {
    urlPattern: /\/recipes(\/.*)?(\?.*)?$/,
    handler: 'StaleWhileRevalidate' as const,
    method: 'GET' as const,
    options: {
      cacheName: 'api-cache',
      expiration: { maxEntries: 100, maxAgeSeconds: 24 * 60 * 60 },
      cacheableResponse: { statuses: [0, 200] },
    },
  },
  // GET /menu/* — stale-while-revalidate
  {
    urlPattern: /\/menu\/.*$/,
    handler: 'StaleWhileRevalidate' as const,
    method: 'GET' as const,
    options: {
      cacheName: 'api-cache',
      expiration: { maxEntries: 100, maxAgeSeconds: 24 * 60 * 60 },
      cacheableResponse: { statuses: [0, 200] },
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
  // @ts-expect-error - @types/next-pwa ships a Next 13 NextConfig type that conflicts with Next 15
  nextConfig,
)
