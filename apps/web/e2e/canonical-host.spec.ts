/**
 * mimoia.com is the canonical host. Railway serves www.mimoia.com too, so the
 * app itself must bounce www to the apex (permanent, path + query kept) —
 * otherwise search engines and shared links split across two origins (and two
 * separate localStorage sessions). Rule lives in next.config.ts `redirects()`.
 */

import { test, expect } from '@playwright/test'

test('www.mimoia.com redirects permanently to mimoia.com keeping path and query', async ({ request }) => {
  const res = await request.get('/recipes?tab=mine', {
    headers: { host: 'www.mimoia.com' },
    maxRedirects: 0,
  })
  expect(res.status()).toBe(308)
  expect(res.headers()['location']).toBe('https://mimoia.com/recipes?tab=mine')
})

test('the apex host is served directly, without a redirect', async ({ request }) => {
  const res = await request.get('/login', {
    headers: { host: 'mimoia.com' },
    maxRedirects: 0,
  })
  expect(res.status()).toBe(200)
})
