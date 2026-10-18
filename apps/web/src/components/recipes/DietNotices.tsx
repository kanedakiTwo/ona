import { Info } from "lucide-react"

/**
 * Notices for the signed-in household on the recipe detail (PRO-196), e.g.
 * «Elige embutido sin gluten» for a coeliac household when the recipe has a
 * cured meat whose gluten depends on the brand. The API decides
 * (`recipe.dietNotices`); nothing when none apply.
 */
export function DietNotices({ notices }: { notices?: string[] }) {
  if (!notices?.length) return null
  return (
    <ul data-testid="diet-notices" className="mb-4 space-y-2">
      {notices.map((n) => (
        <li
          key={n}
          className="flex items-start gap-2 rounded-2xl border border-[#2D6A4F]/30 bg-[#2D6A4F]/[0.06] px-4 py-3 text-[14px] leading-snug text-[#1A1612]"
        >
          <Info size={16} className="mt-0.5 shrink-0 text-[#2D6A4F]" aria-hidden />
          <span>{n}</span>
        </li>
      ))}
    </ul>
  )
}
