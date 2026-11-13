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
  'recipe.allergens_recompute': 'Alérgenos de la receta recalculados',
  'user.suspend': 'Usuario suspendido',
  'user.unsuspend': 'Usuario reactivado',
  'user.reset_password.generate': 'Enlace de reset generado',
  'app_error.resolve': 'Error marcado como resuelto',
  'waitlist.invite': 'Tanda de la lista de espera invitada',
  'invite_campaign.create': 'Enlace de invitación creado',
  'invite_campaign.delete': 'Enlace de invitación eliminado',
  'newsletter.send': 'Newsletter enviada',
  'newsletter.template_save': 'Plantilla de la newsletter guardada',
  'newsletter.preview': 'Vista previa de la newsletter',
  'newsletter.proof': 'Prueba de la newsletter enviada',
  'newsletter.schedule': 'Newsletter programada o desprogramada',
  'catalog_draft.publish': 'Receta del catálogo publicada',
  'catalog_draft.discard': 'Borrador del catálogo descartado',
  'catalog_draft.restore': 'Borrador del catálogo recuperado',
  'catalog_batch.publish': 'Tanda del catálogo publicada',
  'catalog_import.start': 'Importación de una tanda lanzada',
  'catalog_collection.import': 'Colección del catálogo subida',
  'catalog_recipe.source': 'Enlace o crédito de una receta cambiado',
  'whatsapp_question.send': 'Pregunta única enviada por WhatsApp',
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
