/**
 * PRO-365 (specs/version.md): the API says the commit of the deploy, read
 * from `VERSION_SHA` at the top of the tree, or null without a valid file.
 * Public and never cached.
 */
import express from 'express'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { fileURLToPath } from 'url'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, describe, expect, it } from 'vitest'
import { VERSION_SHA_FILE, createVersionRouter, readVersionSha } from '../routes/version.js'

const SHA = '61fdd5b52667e2f7de607d3f9bb8877a4fedf944'
const dir = mkdtempSync(path.join(tmpdir(), 'ona-version-'))
const servers: Server[] = []

async function serve(sha: string | null): Promise<string> {
  const app = express()
  app.use(createVersionRouter(sha))
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

afterAll(() => {
  for (const s of servers) {
    s.closeAllConnections()
    s.close()
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('readVersionSha', () => {
  const file = (name: string, text: string) => {
    const p = path.join(dir, name)
    writeFileSync(p, text)
    return p
  }

  it('reads the 40-char sha with its newline', () => {
    expect(readVersionSha(file('ok', `${SHA}\n`))).toBe(SHA)
  })

  it('is null without the file', () => {
    expect(readVersionSha(path.join(dir, 'missing'))).toBeNull()
  })

  it('is null when the file holds anything else', () => {
    expect(readVersionSha(file('short', 'abc123\n'))).toBeNull()
    expect(readVersionSha(file('empty', ''))).toBeNull()
    expect(readVersionSha(file('junk', `${SHA}\n<script>\n`))).toBeNull()
  })

  it('looks for VERSION_SHA at the root of the repo', () => {
    expect(path.basename(VERSION_SHA_FILE)).toBe('VERSION_SHA')
    const here = path.dirname(fileURLToPath(import.meta.url))
    expect(path.dirname(VERSION_SHA_FILE)).toBe(path.resolve(here, '../../../..'))
  })
})

describe('the version route', () => {
  it('answers the sha, without auth and without cache', async () => {
    const res = await fetch(`${await serve(SHA)}/version`)
    expect(res.status).toBe(200)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.json()).toEqual({ sha: SHA })
  })

  it('answers null when there is no sha', async () => {
    const res = await fetch(`${await serve(null)}/version`)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ sha: null })
  })
})
