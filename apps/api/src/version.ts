import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const SHA = /^[0-9a-f]{40}$/
/**
 * How many folders above the start folder to look. The API starts at the
 * upload's root, where the file is; the web's standalone server chdirs to
 * apps/web/.next/standalone/apps/web, four below apps/web (same walk in
 * apps/web/src/lib/versionSha.ts).
 */
export const VERSION_SHA_LEVELS = 6

/**
 * PRO-OF-2: which commit this deploy serves. Whoever deploys writes the full
 * sha to a `VERSION_SHA` file at the root of the uploaded tree and in
 * apps/api and apps/web (git-ignored, never committed); it is looked up from
 * the start folder upwards. No file, or something that isn't a full sha →
 * null (e.g. a plain `scripts/deploy.sh`, which doesn't write it).
 */
export function versionSha(from: string = process.cwd()): string | null {
  let dir = from
  for (let i = 0; i <= VERSION_SHA_LEVELS; i++) {
    try {
      const s = readFileSync(join(dir, 'VERSION_SHA'), 'utf8').trim()
      if (SHA.test(s)) return s
    } catch {
      // not here: one folder up
    }
    const up = dirname(dir)
    if (up === dir) break
    dir = up
  }
  return null
}
