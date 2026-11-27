import type { MetadataRoute } from "next"
import { SITE_URL } from "./site"

/**
 * The rules of /robots.txt (`app/robots.ts`): search engines may crawl
 * everything but the private or account zones — the app behind login, admin,
 * personal links (shop orders, invitations, newsletter clicks, waitlist
 * pages) and the forms to sign in. The public pages and recipes stay open and
 * the sitemap is the one `app/sitemap.ts` serves (PRO-1077). Pure, so the
 * tests can check it without a server.
 */
export const PRIVATE_PATHS = [
  "/admin",
  "/api/",
  "/profile",
  "/menu",
  "/shopping",
  "/compra",
  "/cocinar",
  "/afinar",
  "/advisor",
  "/onboarding",
  "/whatsapp",
  "/cookbooks",
  "/curator",
  "/debug-advisor",
  "/invites",
  "/offline",
  "/login",
  "/register",
  "/recuperar",
  "/reset",
  "/entrar/",
  "/c/",
  "/i/",
  "/n/",
  "/lista/",
  "/newsletter/",
  "/recipes/new",
  "/recipes/*/edit",
]

export function robotsRules(siteUrl = SITE_URL): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: PRIVATE_PATHS }],
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
