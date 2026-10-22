/**
 * One-line statuses of the /profile hub cards, pure so the API's vitest
 * covers them (apps/api/src/tests/profileStatus.test.ts).
 */

/** «Ninguna apuntada» / «pimiento, gluten» / «pimiento, gluten y 2 más». */
export function allergiesStatus(restrictions: unknown, failed = false): string {
  if (!Array.isArray(restrictions)) return failed ? 'Tus alergias' : '…'
  const list = restrictions.filter((r): r is string => typeof r === 'string' && r.trim() !== '')
  if (list.length === 0) return 'Ninguna apuntada'
  const shown = list.slice(0, 2).join(', ')
  return list.length > 2 ? `${shown} y ${list.length - 2} más` : shown
}
