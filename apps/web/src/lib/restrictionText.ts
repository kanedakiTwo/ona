/**
 * Free text of the allergies box (`RestrictionsPicker`). Pure so the API's
 * vitest covers it (apps/api/src/tests/restrictionText.test.ts).
 */
import { saysNone } from "@ona/shared"

// «nada», «ninguna», «no tengo»… say there is none (lives in @ona/shared:
// the API's reading of the box uses it too, PRO-347).
export { saysNone }

/** The list plus what is typed in the box and not added yet («Guardar» without Enter). */
export function withTyped(restrictions: readonly string[], typed: string): string[] {
  const t = typed.trim().toLowerCase()
  if (!t || saysNone(t) || restrictions.includes(t)) return [...restrictions]
  return [...restrictions, t]
}
