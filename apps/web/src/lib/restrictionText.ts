/**
 * Free text of the allergies box (`RestrictionsPicker`). Pure so the API's
 * vitest covers it (apps/api/src/tests/restrictionText.test.ts).
 */

/**
 * «nada», «ninguna», «no tengo» — or «nada. como d todo, el crio tb», as a
 * test household wrote (2026-10-22) — say there is none: not a restriction.
 * «nada de cerdo» and «no como cerdo» are one.
 */
export function saysNone(text: string): boolean {
  const t = text.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  if (/^nada de\b/.test(t)) return false
  return /^(nada|ningun[ao]?s?)\b/.test(t) || /^no( tengo( ningun[ao]?)?)?[.!]*$/.test(t)
}

/** The list plus what is typed in the box and not added yet («Guardar» without Enter). */
export function withTyped(restrictions: readonly string[], typed: string): string[] {
  const t = typed.trim().toLowerCase()
  if (!t || saysNone(t) || restrictions.includes(t)) return [...restrictions]
  return [...restrictions, t]
}
