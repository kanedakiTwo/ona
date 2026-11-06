import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { isIsoDay, RECIPE_OF_THE_DAY_PATH } from "@ona/shared"
import RecipeOfTheDayPage from "@/components/recipeOfTheDay/RecipeOfTheDayPage"
import { fetchRecipeOfTheDay, recipeOfTheDayMetadata } from "@/lib/recipeOfTheDay"

/** /receta-del-dia/AAAA-MM-DD — the recipe of that day, the link a post keeps (PRO-1099). */

type Params = { params: Promise<{ fecha: string }> }

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { fecha } = await params
  if (!isIsoDay(fecha)) return {}
  return recipeOfTheDayMetadata(await fetchRecipeOfTheDay(fecha), `${RECIPE_OF_THE_DAY_PATH}/${fecha}`)
}

export default async function Page({ params }: Params) {
  const { fecha } = await params
  if (!isIsoDay(fecha)) notFound()
  return <RecipeOfTheDayPage view={await fetchRecipeOfTheDay(fecha)} />
}
