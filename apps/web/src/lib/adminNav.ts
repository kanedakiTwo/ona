/**
 * Admin areas, shared by the desktop sidebar (admins only, under the normal
 * items) and `/admin/[[...seccion]]`. Each area has its own URL so the
 * sidebar can mark the active one from the pathname alone.
 */
export type AdminArea = "catalogo" | "recetas" | "usuarios" | "invitaciones" | "lista-espera" | "tiendas" | "opiniones" | "auditoria" | "voz"

export const ADMIN_AREAS: Array<{ area: AdminArea; href: string; label: string }> = [
  { area: "catalogo", href: "/admin", label: "Catálogo" },
  { area: "recetas", href: "/admin/recetas", label: "Recetas pendientes" },
  { area: "usuarios", href: "/admin/usuarios", label: "Usuarios" },
  { area: "invitaciones", href: "/admin/invitaciones", label: "Invitaciones" },
  { area: "lista-espera", href: "/admin/lista-espera", label: "Lista de espera" },
  { area: "tiendas", href: "/admin/tiendas", label: "Tiendas de Mimoia" },
  { area: "opiniones", href: "/admin/opiniones", label: "Opiniones" },
  { area: "auditoria", href: "/admin/auditoria", label: "Auditoría" },
  { area: "voz", href: "/admin/voz", label: "Voz" },
]

/** Areas listed in the sidebar. «Voz» is history of the retired voice mode
 * (D-023): still reachable at /admin/voz, not worth a menu entry. */
export const ADMIN_MENU = ADMIN_AREAS.filter((a) => a.area !== "voz")

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
