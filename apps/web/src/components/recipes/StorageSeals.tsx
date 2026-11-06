import { Refrigerator, Snowflake } from "lucide-react"

interface StorageSealsProps {
  freezable?: boolean | null
  fridgeDays?: number | null
}

/** True when the recipe has at least one of the two seals (PRO-372). */
export function hasStorageSeals({ freezable, fridgeDays }: StorageSealsProps): boolean {
  return freezable != null || (fridgeDays != null && fridgeDays > 0)
}

/**
 * PRO-372: «Se puede congelar» / «No se congela» and «Aguanta N días en
 * nevera» on the ficha, next to «Conservación». Each seal only shows when the
 * recipe has the data (`recipe.freezable`, `recipe.fridgeDays`).
 */
export function StorageSeals({ freezable, fridgeDays }: StorageSealsProps) {
  if (!hasStorageSeals({ freezable, fridgeDays })) return null
  const pill =
    "inline-flex items-center gap-1.5 rounded-full border border-[#2D6A4F]/30 bg-[#2D6A4F]/[0.06] px-3 py-1.5 text-[13px] leading-none text-[#1A1612]"
  return (
    <ul data-testid="storage-seals" className="flex flex-wrap gap-2" aria-label="Conservación">
      {freezable != null && (
        <li data-testid="seal-freezable" className={pill}>
          <Snowflake size={14} className="shrink-0 text-[#2D6A4F]" aria-hidden />
          {freezable ? "Se puede congelar" : "No se congela"}
        </li>
      )}
      {fridgeDays != null && fridgeDays > 0 && (
        <li data-testid="seal-fridge-days" className={pill}>
          <Refrigerator size={14} className="shrink-0 text-[#2D6A4F]" aria-hidden />
          {fridgeDays === 1 ? "Aguanta 1 día en nevera" : `Aguanta ${fridgeDays} días en nevera`}
        </li>
      )}
    </ul>
  )
}
