/**
 * The deployed commit as JSON (PRO-365, specs/version.md): the hash, or null.
 * Rendered once during the build from `VERSION_SHA`, so the standalone server
 * needs no file at run time.
 */
import { readVersionSha } from "@/lib/versionSha"

export const dynamic = "force-static"

export function GET() {
  return Response.json({ sha: readVersionSha() })
}
