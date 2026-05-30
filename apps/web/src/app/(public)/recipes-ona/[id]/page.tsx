"use client"

import Link from "next/link"
import { useParams } from "next/navigation"
import { motion } from "motion/react"
import { usePublicRecipe } from "@/hooks/useRecipes"
import { IngredientsSection } from "@/components/recipes/detail/IngredientsSection"
import { StepsSection } from "@/components/recipes/detail/StepsSection"
import { NutritionCard } from "@/components/recipes/detail/NutritionCard"
import { AllergensBadges } from "@/components/recipes/detail/AllergensBadges"
import { publicTagsOf, timelineString } from "@/lib/recipeView"
import { MEAL_LABELS, SEASON_LABELS } from "@/lib/labels"
import { ArrowUpRight, ChevronLeft, Clock } from "lucide-react"

export default function PublicRecipeDetailPage() {
  const params = useParams<{ id: string }>()
  const { data: recipe, isLoading, error } = usePublicRecipe(params.id)

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-28 md:px-10">
        <div className="aspect-[16/10] animate-pulse rounded-3xl bg-[#EFE8D8]" />
        <div className="mt-8 h-8 w-3/4 animate-pulse rounded bg-[#EFE8D8]" />
        <div className="mt-4 h-4 w-1/2 animate-pulse rounded bg-[#EFE8D8]" />
      </div>
    )
  }

  if (error || !recipe) {
    return (
      <div className="mx-auto max-w-3xl px-6 pb-24 pt-28 text-center md:px-10">
        <div className="text-eyebrow text-[#7A7066]">404</div>
        <h1 className="text-editorial-lg mt-6 leading-tight">
          Receta no encontrada.
        </h1>
        <p className="mt-4 text-base text-[#4A4239]">
          Esta receta no existe o no es parte del catálogo público.
        </p>
        <Link
          href="/recipes-ona"
          className="mt-10 inline-flex items-center gap-2 text-sm font-medium text-[#1A1612] hover:text-[#2D6A4F]"
        >
          <ChevronLeft size={16} />
          Volver al catálogo
        </Link>
      </div>
    )
  }

  const visibleTags = publicTagsOf(recipe)
  const timeline = timelineString(recipe)
  const heroImg =
    recipe.imageUrl ||
    "https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=1600&q=85&auto=format&fit=crop"

  return (
    <div className="bg-[#FAF6EE] grain-subtle">
      <div className="mx-auto max-w-3xl px-6 pb-32 pt-24 md:px-10 md:pt-32">
        <Link
          href="/recipes-ona"
          className="inline-flex items-center gap-1.5 text-xs uppercase tracking-[0.15em] text-[#7A7066] hover:text-[#1A1612]"
        >
          <ChevronLeft size={14} />
          Catálogo ONA
        </Link>

        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: [0.19, 1, 0.22, 1] }}
          className="mt-6"
        >
          <div className="relative aspect-[16/10] overflow-hidden rounded-3xl bg-[#EFE8D8]">
            <img
              src={heroImg}
              alt={recipe.name}
              className="h-full w-full object-cover"
            />
            <div className="absolute left-4 top-4 rounded-full bg-[#FAF6EE]/95 px-3 py-1 text-[10px] uppercase tracking-[0.2em] text-[#1A1612] backdrop-blur-sm">
              ONA
            </div>
          </div>

          <h1 className="mt-8 text-editorial-xl leading-tight">{recipe.name}</h1>

          <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[#4A4239]">
            {timeline && (
              <span className="inline-flex items-center gap-1.5">
                <Clock size={14} />
                {timeline}
              </span>
            )}
            <span>{recipe.servings} comensales</span>
            {recipe.meals?.length > 0 && (
              <span className="text-[#7A7066]">
                {recipe.meals.map((m) => MEAL_LABELS[m]).join(" · ")}
              </span>
            )}
            {recipe.seasons?.length > 0 && (
              <span className="text-[#7A7066]">
                {recipe.seasons.map((s) => SEASON_LABELS[s]).join(" · ")}
              </span>
            )}
          </div>

          {visibleTags.length > 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {visibleTags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-1 text-[11px] text-[#4A4239]"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

        </motion.div>

        <div className="mt-4 space-y-2">
          <IngredientsSection
            ingredients={recipe.ingredients ?? []}
            targetServings={recipe.servings}
            chapter="01"
          />
          <StepsSection
            steps={recipe.steps ?? []}
            ingredients={recipe.ingredients ?? []}
            chapter="02"
          />
          {recipe.nutritionPerServing && (
            <NutritionCard
              nutrition={recipe.nutritionPerServing}
              chapter="03"
            />
          )}
          {(recipe.allergens?.length ?? 0) > 0 && (
            <AllergensBadges
              allergens={recipe.allergens ?? []}
              chapter={recipe.nutritionPerServing ? "04" : "03"}
            />
          )}
        </div>

        <SignupCTA recipeName={recipe.name} />
      </div>
    </div>
  )
}

function SignupCTA({ recipeName }: { recipeName: string }) {
  return (
    <section className="mt-20 rounded-[32px] bg-[#1A1612] px-8 py-14 text-center text-[#FAF6EE] md:px-12 md:py-16">
      <div className="text-eyebrow mb-6 text-[#FAF6EE]/60">¿Te gusta?</div>
      <h2 className="text-editorial-lg leading-tight">
        Guarda <span className="font-italic italic">{recipeName}</span> y
        plantéate la semana con ella.
      </h2>
      <p className="mx-auto mt-6 max-w-md text-sm text-[#FAF6EE]/70 md:text-base">
        Con cuenta puedes marcarla como favorita, planificarla en tu menú
        semanal, y que ONA te genere la lista de la compra.
      </p>
      <Link
        href="/register"
        className="mt-10 inline-flex items-center gap-2.5 rounded-full bg-[#FAF6EE] px-7 py-4 text-base font-medium text-[#1A1612] transition-all hover:gap-3.5 hover:bg-[#C65D38] hover:text-[#FAF6EE]"
      >
        Crear cuenta gratis
        <ArrowUpRight size={18} />
      </Link>
    </section>
  )
}
