/**
 * Email switches (BASKET_EXTENSION_EMAILS, RED_TIENDAS_EMAILS): empty list =
 * nobody (unlike WhatsApp's). Entries are an exact email or `@domain`,
 * compared without case.
 */
export function isEmailAllowed(email: string | null | undefined, allowed: readonly string[]): boolean {
  if (!email || allowed.length === 0) return false
  const e = email.trim().toLowerCase()
  if (!e) return false
  return allowed.some((raw) => {
    const a = raw.trim().toLowerCase()
    if (!a) return false
    return a.startsWith('@') ? e.endsWith(a) : e === a
  })
}
