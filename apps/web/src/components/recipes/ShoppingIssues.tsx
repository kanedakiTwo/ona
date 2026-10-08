import Link from "next/link"
import { ShoppingBasket } from "lucide-react"
import type { RecipeShoppingIssue } from "@ona/shared"

/**
 * "Para hacer la compra": the BUY_* checks the API runs on a recipe
 * (specs/recipe-quality.md → Shoppability). Shown to the author / admins on
 * the detail and edit pages; nothing when the recipe is ready to shop.
 */
export function ShoppingIssues({ issues, editHref }: { issues?: RecipeShoppingIssue[]; editHref?: string }) {
  if (!issues?.length) return null
  return (
    <section
      aria-label="Para hacer la compra"
      data-testid="shopping-issues"
      className="mt-8 rounded-2xl border border-[#C65D38]/30 bg-[#C65D38]/[0.06] p-4"
    >
      <h3 className="flex items-center gap-2 text-[12px] uppercase tracking-[0.12em] text-[#C65D38]">
        <ShoppingBasket size={14} />
        Para hacer la compra
      </h3>
      <p className="mt-1 text-[13px] text-[#4A4239]">
        {issues.length === 1 ? "Un ingrediente no saldrá bien" : `${issues.length} ingredientes no saldrán bien`} en la lista o en el pedido a la tienda:
      </p>
      <ul className="mt-3 space-y-2">
        {issues.map((i) => (
          <li key={`${i.rowId}-${i.code}`} className="text-[14px] leading-snug text-[#1A1612]">
            {i.message}
          </li>
        ))}
      </ul>
      {editHref && (
        <Link href={editHref} className="mt-3 inline-block text-[12px] uppercase tracking-[0.12em] text-[#1A1612] underline underline-offset-4">
          Corregir en la receta
        </Link>
      )}
    </section>
  )
}
