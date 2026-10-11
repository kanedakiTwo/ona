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
