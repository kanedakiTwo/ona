/**
 * Admin areas, shared by the desktop sidebar (admins only, under the normal
 * items) and `/admin/[[...seccion]]`. Each area has its own URL so the
 * sidebar can mark the active one from the pathname alone.
 */
export type AdminArea = "catalogo" | "usuarios" | "invitaciones" | "auditoria" | "voz"

export const ADMIN_AREAS: Array<{ area: AdminArea; href: string; label: string }> = [
  { area: "catalogo", href: "/admin", label: "Catálogo" },
  { area: "usuarios", href: "/admin/usuarios", label: "Usuarios" },
  { area: "invitaciones", href: "/admin/invitaciones", label: "Invitaciones" },
  { area: "auditoria", href: "/admin/auditoria", label: "Auditoría" },
  { area: "voz", href: "/admin/voz", label: "Voz" },
]

/** `/admin` and `/admin/catalogo` → catálogo; an unknown slug falls back to it. */
export function adminAreaFromSlug(slug: string | undefined): AdminArea {
  const hit = ADMIN_AREAS.find((a) => a.area === slug)
  return hit ? hit.area : "catalogo"
}

/** Area of a pathname, or null when it isn't an admin page. */
export function adminAreaFromPath(pathname: string | null | undefined): AdminArea | null {
  if (!pathname) return null
  const m = pathname.match(/^\/admin(?:\/([^/?#]+))?\/?$/)
  return m ? adminAreaFromSlug(m[1]) : null
}
