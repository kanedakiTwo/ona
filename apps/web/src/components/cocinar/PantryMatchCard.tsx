"use client"

/**
 * «Con lo que tienes» on /cocinar (specs/cook-now.md): up to three recipes
 * the household can cook now with what is at home, from the same search as
 * the proposal (default answers, only what uses the pantry). Hidden while
 * loading, with nothing to show, or when all of them miss something
 * essential (`fallback`: that isn't «con lo que tienes»).
 */
import Link from "next/link"
import { cookNowHitLine } from "@ona/shared"
import { useCookNowPantryMatches } from "@/hooks/useCookNow"
import { SUB_EYEBROW, SUB_LIST } from "@/components/profile/SubPage"

export function PantryMatchCard({ servings }: { servings: number }) {
  const { data } = useCookNowPantryMatches(servings)
  if (!data || data.fallback || data.items.length === 0) return null

  return (
    <section aria-labelledby="con-lo-que-tienes" className="mt-8 lg:max-w-[760px]" data-testid="cook-now-pantry-match">
      <p className={SUB_EYEBROW}>Con lo que tienes</p>
      <h2 id="con-lo-que-tienes" className="mt-1 font-serif-text text-[22px] font-[650] leading-tight text-ink">
        Puedes cocinar <span className="italic text-terracotta-deep">esto</span>
      </h2>
      <ul className={`${SUB_LIST} mt-3`}>
        {data.items.slice(0, 3).map((item) => (
          <li key={item.recipe.id}>
            <Link
              href={`/recipes/${item.recipe.id}`}
              className="flex min-h-[64px] items-center gap-3 px-3 py-2.5 transition-colors hover:bg-cream-deep"
            >
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-cream-deep">
                {item.recipe.imageUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.recipe.imageUrl} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-[15px] text-ink">{item.recipe.name}</div>
                <div className="mt-0.5 truncate text-[13px] text-ink-soft">{cookNowHitLine(item)}</div>
              </div>
              {item.recipe.totalTime != null && (
                <span className="shrink-0 font-mono text-[12px] tabular-nums text-ink-muted">{item.recipe.totalTime} min</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
