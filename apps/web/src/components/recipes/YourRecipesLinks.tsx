"use client"

/**
 * «Mis recetas» and «Recetarios» on /recipes (PRO-1202): what this house
 * keeps of its own, two paper links with a count. They lived on /profile
 * until the profile kept only what changes the menu.
 */
import { BookOpen, ChefHat } from "lucide-react"
import { useCookbooks } from "@/hooks/useCookbooks"
import { useMyRecipes } from "@/hooks/useMyRecipes"
import { ProfileHubLink } from "@/app/profile/sections/ProfileCards"

function count(n: number | undefined, none: string, one: string, many: string): string {
  if (n == null) return "…"
  if (n === 0) return none
  return `${n} ${n === 1 ? one : many}`
}

export function YourRecipesLinks({ className = "" }: { className?: string }) {
  const mine = useMyRecipes()
  const cookbooks = useCookbooks()
  return (
    <nav aria-label="Lo tuyo" data-testid="recipes-yours" className={`grid grid-cols-2 gap-3 lg:gap-4 ${className}`}>
      <ProfileHubLink
        href="/recipes/mias"
        icon={ChefHat}
        title="Mis recetas"
        status={count(mine.data?.counts.total, "Ninguna todavía", "creada por ti", "creadas por ti")}
      />
      <ProfileHubLink
        href="/recipes/recetarios"
        icon={BookOpen}
        title="Recetarios"
        status={count(cookbooks.data?.length, "Ninguno todavía", "recetario", "recetarios")}
      />
    </nav>
  )
}
