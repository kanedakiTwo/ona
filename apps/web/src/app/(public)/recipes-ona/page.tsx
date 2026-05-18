"use client"

import { useState } from "react"
import Link from "next/link"
import { motion } from "motion/react"
import { Search, X, ArrowUpRight } from "lucide-react"
import { usePublicRecipes } from "@/hooks/useRecipes"
import { publicTagsOf } from "@/lib/recipeView"
import { seasonLabel, MEAL_LABELS } from "@/lib/labels"
import type { Meal, Season } from "@ona/shared"

const MEAL_OPTIONS: { value: Meal; label: string }[] = [
  { value: "breakfast", label: MEAL_LABELS.breakfast },
  { value: "lunch", label: MEAL_LABELS.lunch },
  { value: "dinner", label: MEAL_LABELS.dinner },
  { value: "snack", label: MEAL_LABELS.snack },
]

export default function PublicRecipesPage() {
  const [search, setSearch] = useState("")
  const [meal, setMeal] = useState<Meal | undefined>()

  const { data: recipes = [], isLoading } = usePublicRecipes({
    search: search || undefined,
    meal: meal,
    perPage: 100,
  })

  return (
    <div className="bg-[#FAF6EE] grain-subtle pb-32">
      <Hero />

      <div className="mx-auto max-w-7xl px-6 md:px-10">
        <div className="sticky top-[64px] z-20 -mx-6 border-y border-[#DDD6C5] bg-[#FAF6EE]/95 px-6 py-3 backdrop-blur-md md:-mx-10 md:px-10">
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search
                size={16}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#7A7066]"
              />
              <input
                type="text"
                placeholder="Buscar recetas…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full rounded-full border border-[#DDD6C5] bg-[#FFFEFA] py-2.5 pl-9 pr-9 text-sm placeholder-[#7A7066] focus:border-[#1A1612] focus:outline-none"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-[#7A7066] hover:text-[#1A1612]"
                  aria-label="Limpiar búsqueda"
                >
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            <FilterChip active={!meal} onClick={() => setMeal(undefined)}>
              Todas
            </FilterChip>
            {MEAL_OPTIONS.map((opt) => (
              <FilterChip
                key={opt.value}
                active={meal === opt.value}
                onClick={() => setMeal(meal === opt.value ? undefined : opt.value)}
              >
                {opt.label}
              </FilterChip>
            ))}
          </div>
        </div>

        <div className="mt-8">
          <p className="text-eyebrow mb-6 text-[#7A7066]">
            {isLoading ? "Cargando…" : `${recipes.length} recetas del catálogo ONA`}
          </p>

          {isLoading ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {Array.from({ length: 6 }).map((_, i) => (
                <div
                  key={i}
                  className="aspect-[4/5] animate-pulse rounded-2xl bg-[#EFE8D8]"
                />
              ))}
            </div>
          ) : recipes.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-3xl text-[#7A7066]">∅</div>
              <p className="mt-3 text-sm text-[#4A4239]">
                No hay recetas con esos filtros.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
              {recipes.map((recipe, idx) => (
                <motion.div
                  key={recipe.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: Math.min(idx * 0.02, 0.3) }}
                >
                  <PublicRecipeCard recipe={recipe} />
                </motion.div>
              ))}
            </div>
          )}
        </div>
      </div>

      <SignupCTA />
    </div>
  )
}

function Hero() {
  return (
    <section className="px-6 pb-12 pt-28 md:px-10 md:pb-16 md:pt-36">
      <div className="mx-auto max-w-7xl">
        <div className="text-eyebrow mb-6">Catálogo ONA</div>
        <h1 className="text-editorial-xl leading-tight">
          Recetas con <span className="font-italic italic">criterio</span>.
        </h1>
        <p className="mt-8 max-w-xl text-base leading-relaxed text-[#4A4239] md:text-lg">
          El catálogo curado por ONA. Recetas honestas, de temporada, con su
          ficha nutricional y tiempos reales. Léelas libremente — para
          guardarlas, planificar tu semana o crear las tuyas, crea una cuenta.
        </p>
      </div>
    </section>
  )
}

function FilterChip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`shrink-0 rounded-full border px-3.5 py-1.5 text-[12px] font-medium transition-all active:scale-95 ${
        active
          ? "border-[#1A1612] bg-[#1A1612] text-[#FAF6EE]"
          : "border-[#DDD6C5] bg-[#FFFEFA] text-[#4A4239] hover:border-[#1A1612]"
      }`}
    >
      {children}
    </button>
  )
}

function PublicRecipeCard({ recipe }: { recipe: any }) {
  const fallbackImg =
    "https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=600&q=80&auto=format&fit=crop"
  const img = recipe.imageUrl || fallbackImg
  const firstSeason = recipe.seasons?.[0] as Season | undefined
  const visibleTags = publicTagsOf(recipe)

  return (
    <Link href={`/recipes-ona/${recipe.id}`} className="group block">
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
            {recipe.prepTime}&apos;
          </div>
        ) : null}
        {firstSeason && (
          <div className="absolute left-2 top-2 rounded-full bg-[#1A1612]/70 px-2 py-0.5 text-[9px] uppercase tracking-[0.15em] text-[#FAF6EE] backdrop-blur-sm">
            {seasonLabel(firstSeason)}
          </div>
        )}
        <div className="absolute bottom-2 left-2 rounded-full bg-[#FAF6EE]/95 px-2 py-0.5 text-[9px] uppercase tracking-[0.15em] text-[#1A1612] backdrop-blur-sm">
          ONA
        </div>
      </div>
      <div className="mt-2.5 space-y-1">
        <h3 className="font-display text-[15px] leading-tight text-[#1A1612] line-clamp-2 transition-colors group-hover:text-[#2D6A4F]">
          {recipe.name}
        </h3>
        {visibleTags.length > 0 && (
          <p className="truncate text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">
            {visibleTags.slice(0, 2).join(" · ")}
          </p>
        )}
      </div>
    </Link>
  )
}

function SignupCTA() {
  return (
    <section className="mx-auto mt-20 max-w-4xl rounded-[32px] bg-[#1A1612] px-8 py-16 text-center text-[#FAF6EE] md:px-12 md:py-20">
      <div className="text-eyebrow mb-6 text-[#FAF6EE]/60">Para hacerlas tuyas</div>
      <h2 className="text-editorial-lg leading-tight">
        Crea una cuenta y <span className="font-italic italic">ONA cocina la semana</span> por ti.
      </h2>
      <p className="mx-auto mt-6 max-w-md text-sm text-[#FAF6EE]/70 md:text-base">
        Te plantea menús, te genera la lista de la compra, y va recordando lo
        que vas descubriendo sobre tu cuerpo. Dos minutos. Sin tarjeta.
      </p>
      <Link
        href="/register"
        className="mt-10 inline-flex items-center gap-2.5 rounded-full bg-[#FAF6EE] px-7 py-4 text-base font-medium text-[#1A1612] transition-all hover:gap-3.5 hover:bg-[#C65D38] hover:text-[#FAF6EE]"
      >
        Empezar gratis
        <ArrowUpRight size={18} />
      </Link>
    </section>
  )
}
