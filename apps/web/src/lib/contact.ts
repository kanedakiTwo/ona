import { BRAND_SUPPORT_EMAIL } from "@ona/shared"

/**
 * Public contact address shown in the footer and `/terminos`:
 * `NEXT_PUBLIC_SUPPORT_EMAIL` (inlined at build time, also read by
 * `/privacidad`), falling back to hola@mimoia.com so a build without the var
 * never shows a dead address.
 */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || BRAND_SUPPORT_EMAIL
