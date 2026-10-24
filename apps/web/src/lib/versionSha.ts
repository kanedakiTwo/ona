import { readFileSync } from "node:fs"
import { dirname, join } from "node:path"

const SHA = /^[0-9a-f]{40}$/
/**
 * How many folders above the start folder to look: the standalone server
 * (`node apps/web/.next/standalone/apps/web/server.js`) chdirs to its own
 * folder, four below apps/web, so a `VERSION_SHA` there or at the upload's
 * root is found. Same walk as apps/api/src/version.ts.
 */
export const VERSION_SHA_LEVELS = 6

/**
 * PRO-OF-2: which commit the web serves, from the `VERSION_SHA` file the
 * deploy writes (git-ignored). Server only (reads the disk). null when the
 * deploy didn't write one.
 */
export function versionSha(from: string = process.cwd()): string | null {
  let dir = from
  for (let i = 0; i <= VERSION_SHA_LEVELS; i++) {
    try {
      const s = readFileSync(join(dir, "VERSION_SHA"), "utf8").trim()
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
