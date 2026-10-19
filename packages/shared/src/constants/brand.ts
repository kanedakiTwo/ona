/**
 * Brand (decision D-012, 2026-10; coordinated rename 2026-10-08): the product
 * is **Mimoia** (mimoia.com) everywhere — public site, logged-in app, PWA,
 * WhatsApp, prompts, logs, comments and docs — and its AI assistant (chat,
 * voice, WhatsApp) is **Mimo**. The project's original codename survives only
 * in technical identifiers that would break if renamed: package names
 * (@ona/*), env vars, DB tables, localStorage keys, route paths, code symbols.
 * New user-facing strings should use these constants instead of hard-coding.
 */
export const BRAND_NAME = 'Mimoia'

/** The assistant's name: "Hola, soy Mimo, de Mimoia". */
export const ASSISTANT_NAME = 'Mimo'

/**
 * Public contact address. The web reads `NEXT_PUBLIC_SUPPORT_EMAIL` first;
 * this is the fallback so a build without the var never shows a dead address.
 */
export const BRAND_SUPPORT_EMAIL = 'hola@mimoia.com'

/**
 * Support phone (D-071, PRO-249): the number is never written in the code
 * (the repo is public). It comes from `NEXT_PUBLIC_SUPPORT_PHONE` (web) and
 * `SUPPORT_PHONE` (API); without it no phone line is shown anywhere.
 */
export const SUPPORT_PHONE_HOURS = 'de lunes a viernes, de 10:00 a 13:00'

/** What goes in brackets after the number: hours and the email outside them. */
export function supportPhoneNote(email: string = BRAND_SUPPORT_EMAIL): string {
  return `${SUPPORT_PHONE_HOURS}; fuera de ese horario, escríbenos a ${email}`
}

/** Trimmed phone, or null when unset/blank (→ show no phone line at all). */
export function supportPhone(raw: string | null | undefined): string | null {
  const phone = (raw ?? '').trim()
  return phone ? phone : null
}

/** «Teléfono: <número> (de lunes a viernes…)», or null without a number. */
export function supportPhoneLine(raw: string | null | undefined, email: string = BRAND_SUPPORT_EMAIL): string | null {
  const phone = supportPhone(raw)
  return phone ? `Teléfono: ${phone} (${supportPhoneNote(email)})` : null
}

/** Mimoia's public social accounts (waitlist success screen, footer). */
export const BRAND_SOCIAL_LINKS = [
  { network: 'Instagram', handle: '@conmimoia', url: 'https://www.instagram.com/conmimoia/' },
  { network: 'Facebook', handle: 'Mimoia', url: 'https://www.facebook.com/1486113887915173' },
] as const
