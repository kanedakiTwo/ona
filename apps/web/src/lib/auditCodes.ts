/**
 * Spanish phrase map for admin audit-log action codes.
 *
 * Keep in sync with the `AdminAction` union in
 * `apps/api/src/services/auditLog.ts`. Unknown codes fall back to the
 * raw string so missing entries are obvious in the UI.
 */

export const ACTION_LABELS: Record<string, string> = {
  'ingredient.create': 'Ingrediente creado',
  'ingredient.update': 'Ingrediente actualizado',
  'ingredient.remap': 'Re-mapeo de ingrediente',
  'ingredient.estimate_nutrition': 'Nutrición estimada',
  'recipe.update': 'Receta actualizada',
  'recipe.delete': 'Receta eliminada',
  'user.suspend': 'Usuario suspendido',
  'user.unsuspend': 'Usuario reactivado',
  'user.reset_password.generate': 'Enlace de reset generado',
}

export function actionLabel(code: string): string {
  return ACTION_LABELS[code] ?? code
}

/**
 * Action codes available in the audit-log filter dropdown. We list every
 * known code; the API will simply return zero rows if a code isn't
 * present in the table.
 */
export const ACTION_CODES: string[] = Object.keys(ACTION_LABELS)
