/**
 * The deployed commit (PRO-365, specs/version.md). The deploy leaves
 * `VERSION_SHA` (40 hex chars and a newline) at the top of the tree it
 * uploads; without it, or with anything else in it, the answer is null.
 * Public and never cached: the office checks that staging serves the commit
 * it deployed.
 */
import { Router } from 'express'
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

// src/routes/ (dev) and dist/routes/ (build) sit at the same depth under the
// repo root (apps/api/…/routes).
export const VERSION_SHA_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../VERSION_SHA')

export function readVersionSha(file: string = VERSION_SHA_FILE): string | null {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return null
  }
  const sha = text.trim().toLowerCase()
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null
}

export function createVersionRouter(sha: string | null): Router {
  const router = Router()
  router.get('/version', (_request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    response.json({ sha })
  })
  return router
}

// Read once: the file only changes with a new deploy (a new process).
export default createVersionRouter(readVersionSha())
