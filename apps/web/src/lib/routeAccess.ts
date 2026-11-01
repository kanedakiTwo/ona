/**
 * Who can open which page, and with which chrome (specs/auth.md → "Public vs
 * protected routes", specs/design-system.md → "Page shells").
 *
 * One rule: every page needs an account unless it is listed here. A signed-out
 * visitor on any other page is sent to `/login?next=<path+query>` (RootShell),
 * so a new page is protected by default.
 *
 * Pure module (no React): the root layout and RootShell use it, and
 * apps/api/src/tests/routeAccess.test.ts pins the lists.
 */
import { isCollectionRoute, publicRecipeRoute } from "./recipeShell"

/**
 * Drawn without the app shell for everyone, signed in or not (a bare
 * `<main>`; the marketing pages add PublicNavbar + Footer through
 * `app/(public)/layout.tsx`, the auth pages draw AuthShell).
 */
const BARE_ROUTES = new Set([
  "/",
  "/como-funciona",
  "/precios",
  "/privacidad",
  "/terminos",
  "/aviso-legal",
  "/blog",
  "/login",
  "/register",
  "/reset",
  "/recuperar",
  "/onboarding",
  "/newsletter/baja",
  "/offline",
])
/** Bare sections with dynamic segments: waitlist page + opt-out, household invitations, blog articles, newsletter opt-out. */
const BARE_PREFIXES = ["/lista/", "/invites/", "/blog/", "/newsletter/"]

/**
 * Open without an account, but their chrome depends on the session: signed
 * out, the public chrome (PublicNavbar + Footer); signed in, the app shell.
 * `/recipes/<id>` and its cook mode join them through `publicRecipeRoute`, and
 * the catalogue collections `/recipes/coleccion/<slug>` through `isCollectionRoute`.
 */
const SESSION_ROUTES = new Set(["/recipes", "/whatsapp/conectar"])

/** Bare pages that still need an account (they draw their own full-screen flow). */
const BARE_BUT_PRIVATE = new Set(["/onboarding"])

/**
 * Link handlers (route.ts, never rendered by RootShell): campaign links
 * `/i/<code>`, waitlist invitations `/entrar/<token>`, shop-order short links
 * `/c/<token>`. Listed so the rule reads complete.
 */
const HANDLER_PREFIXES = ["/i/", "/entrar/", "/c/"]

function normalise(pathname: string | null | undefined): string {
  const p = pathname ?? ""
  return p.length > 1 && p.endsWith("/") ? p.slice(0, -1) : p
}

/** Same page and chrome for everyone, no session needed to decide (the marketing site, the auth pages, onboarding…). */
export function isBareRoute(pathname: string | null | undefined): boolean {
  const p = normalise(pathname)
  return BARE_ROUTES.has(p) || BARE_PREFIXES.some((prefix) => p.startsWith(prefix))
}

/** Signed-out chrome of a page that is open to everyone but looks different with a session, or null. */
export type SignedOutChrome = "page" | "recipe" | "fullscreen"

export function signedOutChrome(pathname: string | null | undefined): SignedOutChrome | null {
  const p = normalise(pathname)
  if (SESSION_ROUTES.has(p) || isCollectionRoute(p)) return "page"
  const recipe = publicRecipeRoute(p)
  if (recipe === "detail") return "recipe"
  if (recipe === "cook") return "fullscreen"
  return null
}

/** True when a signed-out visitor must log in first: everything not explicitly open. */
export function needsAccount(pathname: string | null | undefined): boolean {
  const p = normalise(pathname)
  if (BARE_BUT_PRIVATE.has(p)) return true
  if (isBareRoute(p)) return false
  if (signedOutChrome(p)) return false
  if (HANDLER_PREFIXES.some((prefix) => p.startsWith(prefix))) return false
  return true
}

/** `/login?next=<path+query>` for a protected page (the login form sends the person back there). */
export function loginHrefFor(pathWithQuery: string): string {
  return `/login?next=${encodeURIComponent(pathWithQuery)}`
}
