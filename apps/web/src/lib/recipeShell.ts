/**
 * One recipe page for everyone (specs/recipes.md → "Página de receta"):
 * `/recipes/<id>` and its cook mode open without an account for catalogue
 * recipes. Signed out they get the public chrome; signed in, the app shell.
 * The root layout asks these helpers which case a pathname is.
 */

/** `/recipes/<id>` (not `/recipes/new` nor the collections, `/recipes/coleccion/…`). */
const RECIPE_DETAIL = /^\/recipes\/(?!(new|coleccion)\/?$)[^/]+\/?$/
/** `/recipes/<id>/cook`. */
const RECIPE_COOK = /^\/recipes\/(?!(new|coleccion)\/)[^/]+\/cook\/?$/
/** Everything under `/recipes/<id>` — the segment whose layout sets the link-preview metadata. */
const RECIPE_SEGMENT = /^\/recipes\/(?!(new|coleccion)(\/|$))[^/]+(\/|$)/
/** `/recipes/coleccion/<slug>` (PRO-374): a collection, open to everyone. */
const COLLECTION_PAGE = /^\/recipes\/coleccion\/[^/]+\/?$/

/** A catalogue collection's page. */
export function isCollectionRoute(pathname: string | null | undefined): boolean {
  return COLLECTION_PAGE.test(pathname ?? "")
}

export type PublicRecipeRoute = "detail" | "cook"

/** Recipe routes that a signed-out visitor sees with the public chrome, or null. */
export function publicRecipeRoute(pathname: string | null | undefined): PublicRecipeRoute | null {
  const p = pathname ?? ""
  if (RECIPE_DETAIL.test(p)) return "detail"
  if (RECIPE_COOK.test(p)) return "cook"
  return null
}

/**
 * `app/recipes/[id]/layout.tsx` sets title / description / Open Graph /
 * canonical for the whole segment, so the root layout must not add its
 * default `<title>` and description there (they would be duplicated).
 */
export function isRecipeSegment(pathname: string | null | undefined): boolean {
  return RECIPE_SEGMENT.test(pathname ?? "")
}
