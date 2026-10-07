/**
 * Fetch a page from a URL a user handed us ("guárdame esta receta: <url>"),
 * without letting that URL reach anything that isn't the public internet.
 *
 * Without this, a user (or a prompt-injected assistant) could point the API at
 * http://169.254.169.254/, http://localhost:8000/admin/…, a *.railway.internal
 * service or the Postgres host, and read the answer back through the import.
 *
 * Guards:
 *  - http/https only, default ports only, no credentials in the URL;
 *  - hostname blocklist (localhost, *.internal, *.local, …) and IP literals
 *    checked against private / loopback / link-local / CGNAT / ULA ranges;
 *  - every DNS answer checked AT CONNECT TIME (custom `lookup`), so a host that
 *    resolves to a public IP for a pre-check and a private one for the real
 *    connection (DNS rebinding) is still refused;
 *  - redirects followed by hand (max 3), each hop re-checked;
 *  - 10 s overall deadline, 2 MB cap on the (decompressed) body, HTML-ish
 *    content types only.
 */
import http from 'node:http'
import https from 'node:https'
import dns from 'node:dns'
import net from 'node:net'
import zlib from 'node:zlib'
import type { Readable } from 'node:stream'

export class UnsafeUrlError extends Error {
  constructor(message = 'Ese enlace no apunta a una página pública.') {
    super(message)
    this.name = 'UnsafeUrlError'
  }
}

export class PageFetchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PageFetchError'
  }
}

const BLOCKED_HOSTS = new Set(['localhost', 'metadata', 'metadata.google.internal'])
const BLOCKED_SUFFIXES = ['.localhost', '.local', '.internal', '.lan', '.home', '.corp', '.intranet']

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0
}

const V4_BLOCKED: Array<[string, number]> = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // CGNAT (Railway's private network lives here)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local / cloud metadata
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // TEST-NET-1
  ['192.88.99.0', 24], // 6to4 relay
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // TEST-NET-2
  ['203.0.113.0', 24], // TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved + broadcast
]

function isBlockedV4(ip: string): boolean {
  const n = ipv4ToInt(ip)
  return V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
    return ((n & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0)
  })
}

/** Expand an IPv6 address to 8 16-bit groups (handles `::` and a trailing dotted IPv4). */
function ipv6Groups(ip: string): number[] {
  let addr = ip.toLowerCase().split('%')[0]
  const dotted = addr.match(/(\d+\.\d+\.\d+\.\d+)$/)
  if (dotted) {
    const n = ipv4ToInt(dotted[1])
    addr = addr.slice(0, -dotted[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`
  }
  const [head, tail] = addr.split('::')
  const h = head ? head.split(':') : []
  const t = tail !== undefined && tail !== '' ? tail.split(':') : []
  const missing = addr.includes('::') ? 8 - h.length - t.length : 0
  return [...h, ...Array(missing).fill('0'), ...t].map((g) => parseInt(g || '0', 16))
}

function isBlockedV6(ip: string): boolean {
  const g = ipv6Groups(ip)
  const embeddedV4 = () => `${g[6] >> 8}.${g[6] & 0xff}.${g[7] >> 8}.${g[7] & 0xff}`
  if (g.every((x) => x === 0)) return true // ::
  if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true // ::1
  // IPv4-mapped (::ffff:a.b.c.d) and IPv4-compatible (::a.b.c.d)
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isBlockedV4(embeddedV4())
  // NAT64 (64:ff9b::/96) → judge the embedded IPv4
  if (g[0] === 0x64 && g[1] === 0xff9b && g.slice(2, 6).every((x) => x === 0)) return isBlockedV4(embeddedV4())
  if ((g[0] & 0xfe00) === 0xfc00) return true // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true // documentation
  return false
}

/** True for any address the API must never connect to on a user's behalf. */
export function isPrivateAddress(ip: string): boolean {
  const kind = net.isIP(ip)
  if (kind === 4) return isBlockedV4(ip)
  if (kind === 6) return isBlockedV6(ip)
  return true // not an IP at all → refuse
}

/** Parse + statically vet a user-supplied URL. Throws UnsafeUrlError. */
export function assertPublicUrl(raw: string | URL): URL {
  let url: URL
  try {
    url = new URL(String(raw))
  } catch {
    throw new UnsafeUrlError('Ese enlace no es válido.')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new UnsafeUrlError()
  if (url.username || url.password) throw new UnsafeUrlError()
  if (url.port && url.port !== '80' && url.port !== '443') throw new UnsafeUrlError()
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '')
  if (!host) throw new UnsafeUrlError()
  if (net.isIP(host)) {
    if (isPrivateAddress(host)) throw new UnsafeUrlError()
    return url
  }
  // A bare name ("intranet", "postgres") only resolves inside a private network.
  if (!host.includes('.')) throw new UnsafeUrlError()
  if (BLOCKED_HOSTS.has(host) || BLOCKED_SUFFIXES.some((s) => host.endsWith(s))) throw new UnsafeUrlError()
  return url
}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void

/** `lookup` for http(s).request: resolves, then refuses if ANY answer is private. */
export function publicOnlyLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: LookupCallback,
  resolve: typeof dns.lookup = dns.lookup,
): void {
  resolve(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '')
    const list = addresses as dns.LookupAddress[]
    if (list.length === 0 || list.some((a) => isPrivateAddress(a.address))) {
      return callback(new UnsafeUrlError(), '')
    }
    if (options.all) return callback(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

export interface PublicFetchOptions {
  headers?: Record<string, string>
  timeoutMs?: number
  maxBytes?: number
  maxRedirects?: number
}

export interface PublicPage {
  /** Final URL after redirects. */
  url: string
  contentType: string
  body: string
}

const HTMLISH = /^(text\/html|application\/xhtml\+xml|text\/plain|application\/xml|text\/xml)\b/i

function decoderFor(contentType: string): TextDecoder {
  const charset = contentType.match(/charset=["']?([\w-]+)/i)?.[1]
  try {
    return new TextDecoder(charset || 'utf-8')
  } catch {
    return new TextDecoder('utf-8')
  }
}

/** The two guards, injectable so tests can exercise redirects/caps against a local server. */
export interface PublicFetchGuards {
  vetUrl: (url: string | URL) => URL
  lookup: typeof publicOnlyLookup
}

const SAFE_GUARDS: PublicFetchGuards = { vetUrl: assertPublicUrl, lookup: publicOnlyLookup }

function requestOnce(
  url: URL,
  headers: Record<string, string>,
  signal: AbortSignal,
  lookup: typeof publicOnlyLookup,
): Promise<http.IncomingMessage> {
  const mod = url.protocol === 'https:' ? https : http
  return new Promise((resolve, reject) => {
    const req = mod.request(url, {
      method: 'GET',
      headers: { 'Accept-Encoding': 'gzip, deflate, br', ...headers },
      lookup: lookup as unknown as net.LookupFunction,
      signal,
    })
    req.on('response', resolve)
    req.on('error', reject)
    req.end()
  })
}

function readCapped(res: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  const enc = String(res.headers['content-encoding'] ?? '').toLowerCase()
  let stream: Readable = res
  if (enc === 'gzip' || enc === 'x-gzip') stream = res.pipe(zlib.createGunzip())
  else if (enc === 'deflate') stream = res.pipe(zlib.createInflate())
  else if (enc === 'br') stream = res.pipe(zlib.createBrotliDecompress())
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    stream.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        res.destroy()
        stream.destroy()
        reject(new PageFetchError('La página es demasiado grande para importarla.'))
        return
      }
      chunks.push(chunk)
    })
    let ended = false
    stream.on('end', () => {
      ended = true
      resolve(Buffer.concat(chunks))
    })
    stream.on('error', reject)
    res.on('error', reject)
    // Socket torn down mid-body (timeout abort, server hang-up): don't hang.
    res.on('close', () => {
      if (!ended && !res.complete) reject(new PageFetchError('No se pudo descargar la página.'))
    })
  })
}

/**
 * GET a public web page. Throws UnsafeUrlError for anything non-public and
 * PageFetchError (Spanish message) for HTTP / size / type failures.
 */
export async function fetchPublicPage(
  rawUrl: string,
  opts: PublicFetchOptions = {},
  guards: PublicFetchGuards = SAFE_GUARDS,
): Promise<PublicPage> {
  const { headers = {}, timeoutMs = 10_000, maxBytes = 2 * 1024 * 1024, maxRedirects = 3 } = opts
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    let url = guards.vetUrl(rawUrl)
    for (let hop = 0; ; hop++) {
      let res: http.IncomingMessage
      try {
        res = await requestOnce(url, headers, ctrl.signal, guards.lookup)
      } catch (err) {
        if (err instanceof UnsafeUrlError) throw err
        if (ctrl.signal.aborted) throw new PageFetchError('La página tardó demasiado en responder.')
        throw new PageFetchError('No se pudo descargar la página.')
      }
      const status = res.statusCode ?? 0
      if (status >= 300 && status < 400 && res.headers.location) {
        res.resume()
        if (hop >= maxRedirects) throw new PageFetchError('La página redirige demasiadas veces.')
        url = guards.vetUrl(new URL(res.headers.location, url))
        continue
      }
      if (status < 200 || status >= 300) {
        res.resume()
        throw new PageFetchError(`No se pudo descargar la página (HTTP ${status}).`)
      }
      const contentType = String(res.headers['content-type'] ?? '')
      if (contentType && !HTMLISH.test(contentType)) {
        res.resume()
        throw new PageFetchError('El enlace no es una página web.')
      }
      const bytes = await readCapped(res, maxBytes)
      return { url: url.toString(), contentType, body: decoderFor(contentType).decode(bytes) }
    }
  } catch (err) {
    if (ctrl.signal.aborted && !(err instanceof UnsafeUrlError) && !(err instanceof PageFetchError)) {
      throw new PageFetchError('La página tardó demasiado en responder.')
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
