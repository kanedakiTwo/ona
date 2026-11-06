/**
 * The deployed commit (PRO-365, specs/version.md): the deploy leaves
 * `VERSION_SHA` (40 hex chars and a newline) at the top of the tree it
 * uploads. Anything else, or no file, is null. Same rule as the API's
 * version route.
 */
import { readFileSync } from "fs"
import path from "path"

// `next build` and `next dev` run in apps/web (pnpm --filter @ona/web).
export const VERSION_SHA_FILE = path.resolve(process.cwd(), "../../VERSION_SHA")

export function readVersionSha(file: string = VERSION_SHA_FILE): string | null {
  let text: string
  try {
    text = readFileSync(file, "utf8")
  } catch {
    return null
  }
  const sha = text.trim().toLowerCase()
  return /^[0-9a-f]{40}$/.test(sha) ? sha : null
}
