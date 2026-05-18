"use client"

/**
 * "Con lo que tienes" — small card on /menu showing the top 3 recipes
 * the household can cook with what's already in the pantry (PR 12).
 *
 * Hides itself when the pantry is empty or no recipe matches. Otherwise
 * shows up to 3 thumbnails with a coverage badge ("3/5 ingredientes").
 */
import Link from "next/link"
import { ChefHat } from "lucide-react"
import { usePantryMatches } from "@/hooks/usePantryMatch"

export function PantryMatchCard() {
  const { data, isLoading } = usePantryMatches(3)
  if (isLoading) return null
  if (!data || data.length === 0) return null

  return (
    <section className="px-5 mt-8">
      <div className="rounded-2xl bg-[#1A1612] p-5 text-[#FAF6EE]">
        <div className="flex items-center gap-2 text-eyebrow text-[#FAF6EE]/60">
          <ChefHat size={12} />
          Con lo que tienes
        </div>
        <h2 className="mt-2 font-display text-xl leading-tight">
          Puedes cocinar <span className="italic text-[#C65D38]">esto</span>
        </h2>
        <ul className="mt-4 space-y-2">
          {data.map((hit) => (
            <li key={hit.recipe.id}>
              <Link
                href={`/recipes/${hit.recipe.id}`}
                className="flex items-center gap-3 rounded-xl bg-[#FAF6EE]/5 backdrop-blur-sm p-2.5 transition-colors hover:bg-[#FAF6EE]/10"
              >
                <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg bg-[#FAF6EE]/10">
                  {hit.recipe.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={hit.recipe.imageUrl}
                      alt={hit.recipe.name}
                      className="h-full w-full object-cover"
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] leading-tight truncate">{hit.recipe.name}</div>
                  <div className="mt-0.5 text-[10px] uppercase tracking-[0.12em] text-[#FAF6EE]/60">
                    {hit.matchedCount}/{hit.totalRequired} ingredientes
                    {hit.recipe.totalTime != null && <span> · {hit.recipe.totalTime} min</span>}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-base font-medium tabular-nums">
                    {Math.round(hit.coverage * 100)}
                    <span className="text-[10px] text-[#FAF6EE]/60">%</span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
