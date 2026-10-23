/**
 * PRO-OF-2: which commit the web serves (`{ sha }`, null if the deploy wrote
 * no VERSION_SHA). Public, no cache, no API call: the deploy checks it after
 * publishing, next to the API's `GET /version`.
 */
import { versionSha } from "@/lib/versionSha"

export const dynamic = "force-dynamic"

export function GET() {
  return Response.json({ sha: versionSha() }, { headers: { "Cache-Control": "no-store" } })
}
