/**
 * PRO-1124 (D-179): the household's postal code, asked once in «Hazme la
 * compra» and changed in Perfil → Tu casa. Spanish codes only: five digits,
 * the first two a province (01–52). Only the code, never the street (LEG-506).
 */

/** Legal's wording (LEG-506, 2026-11-06), word for word: web and Mimo. */
export const POSTAL_CODE_QUESTION = '¿Cuál es tu código postal?'
export const POSTAL_CODE_WHY = 'Lo usamos para buscarte tiendas de barrio cerca. Puedes saltarlo.'

export const POSTAL_CODE_INVALID = 'Escribe un código postal de España: 5 cifras, como 28012.'

/** «28012», « 28 012 » → «28012»; anything else (or a province outside 01–52) → null. */
export function normalizePostalCode(raw: unknown): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null
  const s = String(raw).replace(/[\s.]/g, '')
  if (!/^\d{5}$/.test(s)) return null
  const province = Number(s.slice(0, 2))
  return province >= 1 && province <= 52 ? s : null
}
