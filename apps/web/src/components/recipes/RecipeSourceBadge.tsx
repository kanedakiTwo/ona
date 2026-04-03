import { cn } from "@/lib/utils"

interface RecipeSourceBadgeProps {
  authorId: string | null | undefined
  className?: string
}

export function RecipeSourceBadge({ authorId, className }: RecipeSourceBadgeProps) {
  const isUserRecipe = !!authorId

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        isUserRecipe
          ? "bg-purple-50 text-purple-700 border border-purple-200"
          : "bg-emerald-50 text-emerald-700 border border-emerald-200",
        className
      )}
    >
      {isUserRecipe ? "Tuya" : "ONA"}
    </span>
  )
}
