/**
 * Global loading state — App Router shows this while a route segment isn't
 * ready yet (its JS chunk is still loading on a client navigation, or the
 * streamed HTML on a full load hasn't caught up).
 *
 * Deliberately unobtrusive: a 2 px terracotta bar pinned under the status
 * bar (`.route-loading-bar` in globals.css). It starts transparent and only
 * fades in after 300 ms, so quick navigations show nothing at all. Nothing
 * covers the page or the nav; the segment area just stays cream and empty
 * until the content arrives.
 *
 * Until 2026-10-08 this was a full-screen ink-drop takeover (z-120) that hid
 * the whole app, bottom nav included — see e2e/no-splash.spec.ts.
 */
export default function Loading() {
  return (
    <div className="min-h-[60vh]" aria-busy="true">
      <div role="progressbar" aria-label="Cargando" className="route-loading-bar" />
    </div>
  )
}
