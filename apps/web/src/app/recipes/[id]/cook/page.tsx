"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { useRecipe } from "@/hooks/useRecipes"
import { useAuth } from "@/lib/auth"
import { householdToDinersOrNull } from "@/lib/recipeView"
import { CookingShell } from "@/components/cooking/CookingShell"

/**
 * Cooking-mode route entry point.
 *
 * URL: `/recipes/[id]/cook?servings=N`
 *
 * The route is rendered as a fullscreen overlay by `<CookingShell>`
 * (`fixed inset-0 z-[100]`), which sits on top of the global bottom
 * navigation. We chose this over a per-segment `layout.tsx` because
 * `Navbar` is mounted from the root `app/layout.tsx`; nested layouts
 * can't suppress siblings of the root layout. Cooking shell's z-index
 * is the cheapest, most local fix.
 */
export default function CookPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()

  // We avoid `useSearchParams` (which forces a Suspense boundary at
  // build time and broke a sibling route in 5c1af4c). Reading from
  // `window.location.search` is safe because this page is inside a
  // dynamic `[id]` segment and is rendered as `"use client"`.
  const urlServings = useMemo(() => {
    if (typeof window === "undefined") return null
    const raw = new URLSearchParams(window.location.search).get("servings")
    if (!raw) return null
    const n = parseInt(raw, 10)
    return Number.isFinite(n) && n > 0 ? n : null
  }, [])

  const [servings, setServings] = useState<number | null>(urlServings)
  const seededRef = useRef(urlServings != null)

  const { data: recipe, isLoading, error } = useRecipe(
    params.id,
    servings ?? undefined,
  )

  // Seed the scaler once we know the recipe and the user (only if the
  // URL didn't already pin a value). Preference order matches the spec:
  //   URL ?servings → user.householdSize → recipe.servings → 2.
  useEffect(() => {
    if (seededRef.current) return
    if (!recipe) return
    const fromHousehold = householdToDinersOrNull({
      adults: user?.adults,
      kidsCount: user?.kidsCount,
      householdSize: user?.householdSize,
    })
    const initial = fromHousehold ?? recipe.servings ?? 2
    setServings(initial)
    seededRef.current = true
  }, [recipe, user?.adults, user?.kidsCount, user?.householdSize])

  // Keep the URL in sync with the live scaler value so refresh / share
  // preserves the chosen portion size.
  useEffect(() => {
    if (servings == null) return
    if (typeof window === "undefined") return
    const next = new URLSearchParams(window.location.search)
    if (next.get("servings") === String(servings)) return
    next.set("servings", String(servings))
    router.replace(`/recipes/${params.id}/cook?${next.toString()}`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servings, params.id])

  if (error) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#FAF6EE] px-6 text-center">
        <div className="max-w-sm">
          <p className="font-display text-2xl text-[#1A1612]">
            No hemos podido cargar la receta.
          </p>
          <button
            onClick={() => router.push(`/recipes/${params.id}`)}
            className="mt-6 rounded-full bg-[#1A1612] px-5 py-2 text-sm text-[#FAF6EE] active:scale-95"
          >
            Volver
          </button>
        </div>
      </div>
    )
  }

  if (isLoading || !recipe || servings == null) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#FAF6EE]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-[#DDD6C5] border-t-[#1A1612]" />
      </div>
    )
  }

  return (
    <CookingShell
      recipe={recipe}
      servings={servings}
      onServingsChange={setServings}
    />
  )
}
