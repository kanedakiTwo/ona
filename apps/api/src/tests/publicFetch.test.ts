/**
 * SSRF guard for recipe imports from a user-supplied URL. If any of these
 * regress, "guárdame esta receta: http://169.254.169.254/…" (or a host that
 * resolves to Railway's private network) reads internal services back to the
 * user through the import.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import http from 'node:http'
import zlib from 'node:zlib'
import type { AddressInfo } from 'node:net'
import type dns from 'node:dns'
import {
  PageFetchError,
  UnsafeUrlError,
  assertPublicUrl,
  fetchPublicPage,
  isPrivateAddress,
  publicOnlyLookup,
  type PublicFetchGuards,
} from '../services/net/publicFetch.js'

describe('isPrivateAddress', () => {
  it.each([
    '127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '100.127.255.254', '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1',
    '::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'ff02::1', '::ffff:127.0.0.1',
    '::ffff:10.0.0.1', '::ffff:a9fe:a9fe', '64:ff9b::a9fe:a9fe', '2001:db8::1', 'not-an-ip',
  ])('blocks %s', (ip) => {
    expect(isPrivateAddress(ip)).toBe(true)
  })

  it.each(['8.8.8.8', '1.1.1.1', '172.32.0.1', '100.128.0.1', '151.101.1.69', '2606:4700::1111', '::ffff:8.8.8.8'])(
    'allows %s',
    (ip) => {
      expect(isPrivateAddress(ip)).toBe(false)
    },
  )
})

describe('assertPublicUrl', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/x',
    'gopher://example.com/',
    'http://localhost/',
    'http://LOCALHOST./',
    'http://api.localhost/',
    'http://127.0.0.1/',
    'http://2130706433/', // decimal 127.0.0.1
    'http://0x7f000001/', // hex 127.0.0.1
    'http://[::1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/',
    'http://ona-api.railway.internal/',
    'http://metadata.google.internal/',
    'http://printer.local/',
    'http://postgres/',
    'http://example.com:8000/',
    'http://user:pass@example.com/',
    'not a url',
  ])('rejects %s', (raw) => {
    expect(() => assertPublicUrl(raw)).toThrow(UnsafeUrlError)
  })

  it.each(['https://www.gipsychef.es/receta', 'http://example.com:80/a', 'https://example.com:443/', 'https://8.8.8.8/'])(
    'accepts %s',
    (raw) => {
      expect(assertPublicUrl(raw).toString()).toContain(new URL(raw).hostname)
    },
  )
})

describe('publicOnlyLookup (checked at connect time → defeats DNS rebinding)', () => {
  const fakeResolve =
    (answers: dns.LookupAddress[]) =>
    ((_host: string, _opts: unknown, cb: (e: null, a: dns.LookupAddress[]) => void) => cb(null, answers)) as any

  const run = (answers: dns.LookupAddress[], all = false) =>
    new Promise<{ err: unknown; address: unknown; family?: number }>((resolve) =>
      publicOnlyLookup('example.com', { all }, (err, address, family) => resolve({ err, address, family }), fakeResolve(answers)),
    )

  it('refuses a name that resolves to a private address', async () => {
    const r = await run([{ address: '10.0.0.7', family: 4 }])
    expect(r.err).toBeInstanceOf(UnsafeUrlError)
  })

  it('refuses when ANY answer is private', async () => {
    const r = await run([{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }], true)
    expect(r.err).toBeInstanceOf(UnsafeUrlError)
  })

  it('passes public answers through in both callback shapes', async () => {
    const one = await run([{ address: '8.8.8.8', family: 4 }])
    expect(one).toMatchObject({ err: null, address: '8.8.8.8', family: 4 })
    const all = await run([{ address: '2606:4700::1111', family: 6 }], true)
    expect(all.err).toBeNull()
    expect(all.address).toEqual([{ address: '2606:4700::1111', family: 6 }])
  })
})

describe('fetchPublicPage', () => {
  it('refuses a loopback server with the real guards', async () => {
    await expect(fetchPublicPage('http://127.0.0.1/')).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  // Against a local server we have to relax the guards; the redirect test
  // keeps a vetUrl that refuses one specific path to prove every hop is vetted.
  let base = ''
  let server: http.Server
  const relaxed: PublicFetchGuards = {
    vetUrl: (u) => {
      const url = new URL(String(u))
      if (url.pathname === '/internal') throw new UnsafeUrlError()
      return url
    },
    lookup: ((host: string, opts: any, cb: any) =>
      opts?.all ? cb(null, [{ address: '127.0.0.1', family: 4 }]) : cb(null, '127.0.0.1', 4)) as any,
  }

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      const path = req.url ?? '/'
      if (path === '/page') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end('<h1>Lentejas</h1>')
      } else if (path === '/latin1') {
        res.writeHead(200, { 'content-type': 'text/html; charset=iso-8859-1' })
        res.end(Buffer.from('<p>Piñones</p>', 'latin1'))
      } else if (path === '/gzip') {
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })
        res.end(zlib.gzipSync('<p>comprimida</p>'))
      } else if (path === '/to-page') {
        res.writeHead(302, { location: '/page' })
        res.end()
      } else if (path === '/to-internal') {
        res.writeHead(302, { location: '/internal' })
        res.end()
      } else if (path === '/loop') {
        res.writeHead(302, { location: '/loop' })
        res.end()
      } else if (path === '/huge') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.end('x'.repeat(5000))
      } else if (path === '/bomb') {
        res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' })
        res.end(zlib.gzipSync(Buffer.alloc(5000, 0x61)))
      } else if (path === '/pdf') {
        res.writeHead(200, { 'content-type': 'application/pdf' })
        res.end('%PDF')
      } else if (path === '/slow') {
        res.writeHead(200, { 'content-type': 'text/html' })
        res.write('<p>')
        // never ends
      } else {
        res.writeHead(404)
        res.end()
      }
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })
  afterAll(() => {
    server.closeAllConnections()
    server.close()
  })

  it('returns the decoded body, honouring charset and gzip', async () => {
    expect((await fetchPublicPage(`${base}/page`, {}, relaxed)).body).toBe('<h1>Lentejas</h1>')
    expect((await fetchPublicPage(`${base}/latin1`, {}, relaxed)).body).toBe('<p>Piñones</p>')
    expect((await fetchPublicPage(`${base}/gzip`, {}, relaxed)).body).toBe('<p>comprimida</p>')
  })

  it('follows a redirect and re-vets every hop', async () => {
    const page = await fetchPublicPage(`${base}/to-page`, {}, relaxed)
    expect(page.url).toBe(`${base}/page`)
    await expect(fetchPublicPage(`${base}/to-internal`, {}, relaxed)).rejects.toBeInstanceOf(UnsafeUrlError)
  })

  it('stops after maxRedirects', async () => {
    await expect(fetchPublicPage(`${base}/loop`, { maxRedirects: 3 }, relaxed)).rejects.toThrow(/redirige/)
  })

  it('caps the body size, after decompression too', async () => {
    await expect(fetchPublicPage(`${base}/huge`, { maxBytes: 1000 }, relaxed)).rejects.toThrow(/demasiado grande/)
    await expect(fetchPublicPage(`${base}/bomb`, { maxBytes: 1000 }, relaxed)).rejects.toThrow(/demasiado grande/)
  })

  it('refuses non-HTML content and HTTP errors', async () => {
    await expect(fetchPublicPage(`${base}/pdf`, {}, relaxed)).rejects.toThrow(/no es una página web/)
    await expect(fetchPublicPage(`${base}/nope`, {}, relaxed)).rejects.toThrow(/HTTP 404/)
  })

  it('gives up on a page that never finishes', async () => {
    const err = await fetchPublicPage(`${base}/slow`, { timeoutMs: 300 }, relaxed).catch((e) => e)
    expect(err).toBeInstanceOf(PageFetchError)
    expect(err.message).toMatch(/tardó demasiado/)
  })
})
