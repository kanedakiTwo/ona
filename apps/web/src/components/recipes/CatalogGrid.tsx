"use client"

import { motion } from "motion/react"
import Link from "next/link"
import { seasonLabel } from "@/lib/labels"
import { publicTagsOf } from "@/lib/recipeView"

// Inline EditorialRecipeCard — moved verbatim from /recipes/page.tsx.
// Keep it co-located here for now; it isn't reused elsewhere (the
// /cookbooks/[id] page has its own different card style).
function EditorialRecipeCard({ recipe, userId }: { recipe: any; userId?: string }) {
  const fallbackImg = `https://images.unsplash.com/photo-${recipe.id?.slice(0, 4) === "abcd" ? "1546069901-ba9599a7e63c" : "1490645935967-10de6ba17061"}?w=600&q=80&auto=format&fit=crop`
  const img = recipe.imageUrl || fallbackImg

  const firstSeason = recipe.seasons?.[0]
  const visibleTags = publicTagsOf(recipe)
  const ownership: 'mine' | 'ona' | 'other' =
    recipe.authorId == null
      ? 'ona'
      : userId && recipe.authorId === userId
        ? 'mine'
        : 'other'

  return (
    <Link href={`/recipes/${recipe.id}`} className="group block">
      <div className="relative overflow-hidden rounded-2xl bg-[#EFE8D8]">
        <div className="aspect-[4/5] overflow-hidden">
          <img
            src={img}
            alt={recipe.name}
            className="h-full w-full object-cover transition-transform duration-700 ease-[cubic-bezier(0.19,1,0.22,1)] group-hover:scale-105"
            loading="lazy"
          />
        </div>
        {recipe.prepTime != null && recipe.prepTime > 0 ? (
          <div className="absolute right-2 top-2 rounded-full bg-[#FAF6EE]/95 px-2 py-0.5 text-[10px] font-medium text-[#1A1612] backdrop-blur-sm">
            {recipe.prepTime}'
          </div>
        ) : null}
        {firstSeason && (
          <div className="absolute left-2 top-2 rounded-full bg-[#1A1612]/70 px-2 py-0.5 text-[9px] uppercase tracking-[0.15em] text-[#FAF6EE] backdrop-blur-sm">
            {seasonLabel(firstSeason)}
          </div>
        )}
        {/* Ownership badge — bottom-left so it doesn't collide with prepTime
            top-right or season top-left. Only "mine" + "ona" get a chip; "other"
            (someone else's user recipe) is ambiguous in catalog and we leave it
            unlabelled. */}
        {ownership !== 'other' && (
          <div
            className={`absolute bottom-2 left-2 rounded-full px-2 py-0.5 text-[9px] uppercase tracking-[0.15em] backdrop-blur-sm ${
              ownership === 'mine'
                ? 'bg-[#C65D38] text-[#FAF6EE]'
                : 'bg-[#FAF6EE]/95 text-[#1A1612]'
            }`}
          >
            {ownership === 'mine' ? 'Tuya' : 'ONA'}
          </div>
        )}
      </div>
      <div className="mt-2.5 space-y-1">
        <h3 className="font-display text-[15px] leading-tight text-[#1A1612] group-hover:text-[#2D6A4F] transition-colors line-clamp-2">
          {recipe.name}
        </h3>
        {visibleTags.length > 0 && (
          <p className="text-[10px] uppercase tracking-[0.15em] text-[#7A7066] truncate">
            {visibleTags.slice(0, 2).join(" · ")}
          </p>
        )}
      </div>
    </Link>
  )
}

type Props = {
  recipes: any[]
  userId?: string
  isLoading: boolean
  emptyState: React.ReactNode
}

export default function CatalogGrid({ recipes, userId, isLoading, emptyState }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="space-y-2">
            <div className="aspect-[4/5] rounded-2xl bg-[#EFE8D8] animate-pulse" />
            <div className="h-3 w-3/4 rounded bg-[#EFE8D8] animate-pulse" />
            <div className="h-2 w-1/2 rounded bg-[#EFE8D8] animate-pulse" />
          </div>
        ))}
      </div>
    )
  }
  if (recipes.length === 0) return <>{emptyState}</>
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-6 lg:grid-cols-4">
      {recipes.map((recipe, i) => (
        <motion.div
          key={recipe.id}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04, duration: 0.5, ease: [0.19, 1, 0.22, 1] }}
        >
          <EditorialRecipeCard recipe={recipe} userId={userId} />
        </motion.div>
      ))}
    </div>
  )
}
