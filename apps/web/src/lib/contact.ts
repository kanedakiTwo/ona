import { BRAND_SUPPORT_EMAIL, supportPhone, supportPhoneNote } from "@ona/shared"

/**
 * Public contact address shown in the footer and `/terminos`:
 * `NEXT_PUBLIC_SUPPORT_EMAIL` (inlined at build time, also read by
 * `/privacidad`), falling back to hola@mimoia.com so a build without the var
 * never shows a dead address.
 */
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || BRAND_SUPPORT_EMAIL

/**
 * Support phone (D-071, PRO-249), shown in `/aviso-legal` and `/terminos`:
 * `NEXT_PUBLIC_SUPPORT_PHONE` (inlined at build time). Unset → null and no
 * phone line anywhere; the number is never written in the code.
 */
export const CONTACT_PHONE = supportPhone(process.env.NEXT_PUBLIC_SUPPORT_PHONE)

/** «de lunes a viernes, de 10:00 a 13:00; fuera de ese horario, escríbenos a …». */
export const CONTACT_PHONE_NOTE = supportPhoneNote(CONTACT_EMAIL)
