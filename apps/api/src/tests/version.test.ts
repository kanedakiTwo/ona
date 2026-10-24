/**
 * PRO-OF-2: which commit a deploy serves, from the VERSION_SHA file the deploy
 * writes (root of the uploaded tree, apps/api and apps/web). API: `GET
 * /version`; web: `/version.json`, whose standalone server runs four folders
 * below apps/web.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { versionSha } from '../version.js'
import { versionSha as webVersionSha } from '../../../web/src/lib/versionSha'

const dirs: string[] = []
const tree = () => {
  const d = mkdtempSync(join(tmpdir(), 'version-'))
  dirs.push(d)
  return d
}
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

describe('versionSha (API)', () => {
  it('reads it from the start folder or above, and only a full sha', () => {
    const root = tree()
    const api = join(root, 'apps', 'api')
    mkdirSync(api, { recursive: true })
    expect(versionSha(api)).toBeNull()
    writeFileSync(join(root, 'VERSION_SHA'), `${'a'.repeat(40)}\n`)
    expect(versionSha(api)).toBe('a'.repeat(40))
    expect(versionSha(root)).toBe('a'.repeat(40))
    writeFileSync(join(api, 'VERSION_SHA'), 'not-a-sha\n')
    expect(versionSha(api)).toBe('a'.repeat(40))
    writeFileSync(join(api, 'VERSION_SHA'), `${'b'.repeat(40)}\n`)
    expect(versionSha(api)).toBe('b'.repeat(40))
    writeFileSync(join(api, 'VERSION_SHA'), `${'B'.repeat(40)}\n`)
    expect(versionSha(api)).toBe('a'.repeat(40))
  })
})

describe('versionSha (web)', () => {
  it("finds apps/web's file from the standalone server's folder (it chdirs four below apps/web)", () => {
    const root = tree()
    const standalone = join(root, 'apps', 'web', '.next', 'standalone', 'apps', 'web')
    mkdirSync(standalone, { recursive: true })
    expect(webVersionSha(standalone)).toBeNull()
    writeFileSync(join(root, 'VERSION_SHA'), `${'c'.repeat(40)}\n`)
    expect(webVersionSha(standalone)).toBe('c'.repeat(40))
    writeFileSync(join(root, 'apps', 'web', 'VERSION_SHA'), `${'d'.repeat(40)}\n`)
    expect(webVersionSha(standalone)).toBe('d'.repeat(40))
    expect(versionSha(standalone)).toBe('d'.repeat(40))
  })
})
