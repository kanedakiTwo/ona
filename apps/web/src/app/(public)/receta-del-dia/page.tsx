import type { Metadata } from "next"
import RecipeOfTheDayPage from "@/components/recipeOfTheDay/RecipeOfTheDayPage"
import { fetchRecipeOfTheDay, recipeOfTheDayMetadata } from "@/lib/recipeOfTheDay"

/** /receta-del-dia — today's recipe of the day (PRO-1099, specs/recipe-of-the-day.md). */

export const dynamic = "force-dynamic"

export async function generateMetadata(): Promise<Metadata> {
  return recipeOfTheDayMetadata(await fetchRecipeOfTheDay())
}

export default async function Page() {
  return <RecipeOfTheDayPage view={await fetchRecipeOfTheDay()} />
}
