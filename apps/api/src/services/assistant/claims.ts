/**
 * Spanish past-tense "I did it" claims. Only checked when no tool ran this
 * turn, so a legit "He cambiado la cena" after swap_meal never trips it.
 * Since 2026-10-12 it only flags the turn for the daily review.
 */
const ACTION_CLAIM_RE =
  /\b(?:he|hemos|ya)\s+(?:cambiado|generado|guardado|marcado|a[ñn]adido|actualizado|apuntado|creado|quitado|eliminado|borrado|puesto|sustituido|registrado)\b|(?:^|[.!?,;]\s*)(?:hecho|listo|cambiado|guardado|apuntado)\s*[.!,:]/im

export function claimsAction(text: string): boolean {
  return ACTION_CLAIM_RE.test(text)
}
