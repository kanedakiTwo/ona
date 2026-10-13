/**
 * Cloudflare Web Analytics beacon (specs/privacy.md): only with a token, and
 * the token can never break out of the attribute's JSON.
 */
import { describe, expect, it } from 'vitest'
import { CF_BEACON_SRC, cfBeaconAttr } from '../../../web/src/lib/cfBeacon'

describe('cfBeaconAttr', () => {
  it('builds the data-cf-beacon JSON for a token', () => {
    expect(cfBeaconAttr('0123456789abcdef0123456789abcdef')).toBe('{"token":"0123456789abcdef0123456789abcdef"}')
    expect(cfBeaconAttr('  abcdef0123456789  ')).toBe('{"token":"abcdef0123456789"}')
  })

  it('no beacon when the token is unset, empty or malformed', () => {
    for (const t of [undefined, null, '', '   ', 'short', 'x"};alert(1);//aaaaaaaa', 'a'.repeat(80)]) {
      expect(cfBeaconAttr(t)).toBeNull()
    }
  })

  it('loads Cloudflare’s beacon over https', () => {
    expect(CF_BEACON_SRC).toBe('https://static.cloudflareinsights.com/beacon.min.js')
  })
})
