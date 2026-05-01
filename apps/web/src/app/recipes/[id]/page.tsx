"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useParams, usePathname, useRouter } from "next/navigation"
import { motion } from "motion/react"
import { useRecipe } from "@/hooks/useRecipes"
import { useAuth } from "@/lib/auth"
import { FavoriteButton } from "@/components/recipes/FavoriteButton"
import { ServingsScaler } from "@/components/recipes/ServingsScaler"
import { IngredientsSection } from "@/components/recipes/detail/IngredientsSection"
import { StepsSection } from "@/components/recipes/detail/StepsSection"
import { NutritionCard } from "@/components/recipes/detail/NutritionCard"
import { AllergensBadges } from "@/components/recipes/detail/AllergensBadges"
import { haptic } from "@/lib/pwa/haptics"
import { share } from "@/lib/pwa/share"
import { acquireWakeLock, releaseWakeLock } from "@/lib/pwa/wakeLock"
import { ChevronLeft, Clock, Share2, Sparkles, Wrench, Zap } from "lucide-react"
import Link from "next/link"
import {
  householdSizeToDiners,
  publicTagsOf,
  timelineString,
} from "@/lib/recipeView"

const SEASON_LABELS: Record<string, string> = {
  spring: "Primavera",
  summer: "Verano",
  autumn: "Otoño",
  winter: "Invierno",
}
const MEAL_LABELS: Record<string, string> = {
  breakfast: "Desayuno",
  lunch: "Comida",
  dinner: "Cena",
  snack: "Snack",
}

export default function RecipeDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const pathname = usePathname()
  const { user } = useAuth()

  const [servings, setServings] = useState<number | null>(null)
  // Once we know the recipe's authored servings, the scaler "seeds" itself.
  const seededRef = useRef(false)

  const { data: recipe, isLoading, error } = useRecipe(
    params.id,
    servings ?? undefined,
  )

  // Seed the scaler once the recipe loads. Prefer the user's household
  // size (clamped to the [1, recipe.servings × 6] range the API accepts);
  // fall back to the recipe's authored servings.
  useEffect(() => {
    if (seededRef.current) return
    if (!recipe) return
    const userDiners = householdSizeToDiners(user?.householdSize)
    const initial = userDiners ?? recipe.servings ?? 2
    setServings(initial)
    seededRef.current = true
  }, [recipe, user?.householdSize])

  const [isCooking, setIsCooking] = useState(false)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)

  async function handleCookingToggle() {
    haptic.medium()
    if (isCooking) {
      await releaseWakeLock(wakeLockRef.current)
      wakeLockRef.current = null
      setIsCooking(false)
    } else {
      const sentinel = await acquireWakeLock()
      wakeLockRef.current = sentinel
      setIsCooking(true)
    }
  }

  useEffect(() => {
    return () => {
      if (wakeLockRef.current) {
        releaseWakeLock(wakeLockRef.current)
        wakeLockRef.current = null
      }
    }
  }, [pathname])

  // ─── Derived state (must be declared before any early return so hook order is stable) ───
  const tags = useMemo(() => (recipe ? publicTagsOf(recipe) : []), [recipe])
  const timeLine = useMemo(() => {
    if (!recipe) return ""
    return timelineString({
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
      activeTime: recipe.activeTime,
      totalTime: recipe.totalTime,
    })
  }, [recipe])

  if (isLoading || !recipe) {
    if (error) {
      return (
        <div className="min-h-screen bg-[#FAF6EE] px-5 pt-12 text-center">
          <p className="font-display text-2xl text-[#1A1612]">Receta no encontrada.</p>
          <button
            onClick={() => router.back()}
            className="mt-4 text-sm text-[#2D6A4F] underline"
          >
            Volver
          </button>
        </div>
      )
    }
    return (
      <div className="min-h-screen bg-[#FAF6EE]">
        <div className="aspect-[4/3] w-full bg-[#EFE8D8] animate-pulse" />
        <div className="px-5 pt-6 space-y-4">
          <div className="h-8 w-3/4 bg-[#EFE8D8] rounded animate-pulse" />
          <div className="h-4 w-1/2 bg-[#EFE8D8] rounded animate-pulse" />
        </div>
      </div>
    )
  }

  const fallbackImg =
    "https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=1200&q=85&auto=format&fit=crop"
  const img = recipe.imageUrl || fallbackImg

  // The displayed servings on the heading & "Para X" caption: the live
  // scaler value when seeded, falling back to the recipe's own value.
  const displayServings = servings ?? recipe.servings

  // Track which "chapter" eyebrow we're on so the page reads as a coherent
  // narrative even when sections are conditionally rendered.
  let chapter = 0
  const nextChapter = (): string => {
    chapter += 1
    return String(chapter).padStart(2, "0")
  }

  const handleShare = async () => {
    haptic.light()
    await share({
      title: recipe.name,
      url: typeof window !== "undefined" ? window.location.href : undefined,
    })
  }

  return (
    <div className="bg-[#FAF6EE] min-h-screen">
      {/* Hero image */}
      <div className="relative">
        <motion.div
          initial={{ scale: 1.05 }}
          animate={{ scale: 1 }}
          transition={{ duration: 1.2, ease: [0.19, 1, 0.22, 1] }}
          className="aspect-[4/3] overflow-hidden"
        >
          <img src={img} alt={recipe.name} className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#1A1612]/40 via-transparent to-[#1A1612]/30" />
        </motion.div>

        {/* Top bar */}
        <div className="absolute inset-x-0 top-0 flex items-center justify-between px-4 pt-4">
          <button
            onClick={() => router.back()}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FAF6EE]/90 text-[#1A1612] backdrop-blur-sm transition-transform active:scale-95"
            aria-label="Volver"
          >
            <ChevronLeft size={20} />
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={handleShare}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FAF6EE]/90 text-[#1A1612] backdrop-blur-sm transition-transform active:scale-95"
              aria-label="Compartir receta"
            >
              <Share2 size={18} />
            </button>
            {user && (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#FAF6EE]/90 backdrop-blur-sm">
                <FavoriteButton
                  recipeId={recipe.id}
                  userId={user.id}
                  isFavorite={recipe.is_favorite ?? false}
                />
              </div>
            )}
          </div>
        </div>

        {isCooking && (
          <button
            onClick={handleCookingToggle}
            className="absolute top-16 left-4 flex items-center gap-1.5 rounded-full bg-[#FAF6EE]/90 px-3 py-1.5 text-xs font-medium text-[#1A1612] backdrop-blur-sm shadow-sm transition-transform active:scale-95"
            aria-label="Pantalla activa, toca para liberar"
          >
            <Zap size={12} className="text-[#C65D38]" />
            Pantalla activa
          </button>
        )}

        <div className="pointer-events-none absolute bottom-6 left-4 text-[10px] uppercase tracking-[0.25em] text-[#FAF6EE]/80">
          ONA · Receta
        </div>
      </div>

      {/* Content */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3, duration: 0.7 }}
        className="-mt-8 rounded-t-[28px] bg-[#FAF6EE] px-5 pb-12 pt-8 relative"
      >
        {/* Editorial header */}
        <div className="mb-6">
          {recipe.meals?.length > 0 && (
            <div className="text-eyebrow mb-3 text-[#C65D38]">
              {recipe.meals.map((m: string) => MEAL_LABELS[m] ?? m).join(" · ")}
            </div>
          )}
          <h1 className="font-display text-[2rem] leading-[1.05] tracking-tight text-[#1A1612]">
            {recipe.name}
          </h1>
          {recipe.yieldText && (
            <p className="mt-2 font-italic italic text-[14px] text-[#7A7066]">
              Rinde {recipe.yieldText}
            </p>
          )}
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-y border-[#DDD6C5] py-4 text-[12px] text-[#4A4239]">
          <ServingsScaler
            value={displayServings}
            onChange={setServings}
            min={1}
            max={12}
          />
          {timeLine && (
            <div className="flex items-center gap-1.5">
              <Clock size={13} className="text-[#7A7066]" />
              <span>{timeLine}</span>
            </div>
          )}
          {recipe.seasons?.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Sparkles size={13} className="text-[#7A7066]" />
              <span>
                {recipe.seasons.map((s: string) => SEASON_LABELS[s] ?? s).join(" · ")}
              </span>
            </div>
          )}
        </div>

        {/* Tags (filtered) */}
        {tags.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full bg-[#F2EDE0] px-2.5 py-1 text-[10px] uppercase tracking-[0.1em] text-[#4A4239]"
              >
                {tag}
              </span>
            ))}
          </div>
        )}

        {/* Ingredients */}
        {recipe.ingredients?.length > 0 && (
          <IngredientsSection
            ingredients={recipe.ingredients as any}
            targetServings={displayServings}
            chapter={nextChapter()}
          />
        )}

        {/* Steps */}
        {recipe.steps?.length > 0 && (
          <StepsSection
            steps={recipe.steps}
            ingredients={recipe.ingredients ?? []}
            chapter={nextChapter()}
            isCooking={isCooking}
            onCookingToggle={handleCookingToggle}
          />
        )}

        {/* Equipment */}
        {recipe.equipment != null && recipe.equipment.length > 0 && (
          <section className="mt-12">
            <div className="mb-4">
              <div className="text-eyebrow text-[#7A7066]">Capítulo {nextChapter()}</div>
              <h2 className="font-display text-[1.6rem] leading-tight text-[#1A1612]">
                <span className="font-italic italic">Equipo</span>
              </h2>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {recipe.equipment.map((tool) => (
                <span
                  key={tool}
                  className="inline-flex items-center gap-1 rounded-full border border-[#DDD6C5] bg-[#FAF6EE] px-2.5 py-1 text-[11px] text-[#4A4239]"
                >
                  <Wrench size={10} className="text-[#7A7066]" />
                  {tool}
                </span>
              ))}
            </div>
          </section>
        )}

        {/* Allergens */}
        {recipe.allergens != null && recipe.allergens.length > 0 && (
          <AllergensBadges
            allergens={recipe.allergens}
            chapter={nextChapter()}
          />
        )}

        {/* Nutrition */}
        {recipe.nutritionPerServing != null && (
          <NutritionCard
            nutrition={recipe.nutritionPerServing}
            chapter={nextChapter()}
          />
        )}

        {/* Notes / tips / substitutions / storage. The public detail
            payload from /recipes/:id strips these per spec; they only
            show up on author-edit / private views. We render defensively
            just in case the server starts surfacing them. */}
        {(recipe.notes || recipe.tips || recipe.substitutions || recipe.storage) && (
          <section className="mt-12 space-y-6">
            {recipe.notes && (
              <div>
                <div className="text-eyebrow mb-2 text-[#7A7066]">Notas</div>
                <p className="text-[14px] leading-relaxed text-[#1A1612]">
                  {recipe.notes}
                </p>
              </div>
            )}
            {recipe.tips && (
              <div>
                <div className="text-eyebrow mb-2 text-[#7A7066]">Trucos</div>
                <p className="text-[14px] leading-relaxed text-[#1A1612]">
                  {recipe.tips}
                </p>
              </div>
            )}
            {recipe.substitutions && (
              <div>
                <div className="text-eyebrow mb-2 text-[#7A7066]">Sustituciones</div>
                <p className="text-[14px] leading-relaxed text-[#1A1612]">
                  {recipe.substitutions}
                </p>
              </div>
            )}
            {recipe.storage && (
              <div>
                <div className="text-eyebrow mb-2 text-[#7A7066]">Conservación</div>
                <p className="text-[14px] leading-relaxed text-[#1A1612]">
                  {recipe.storage}
                </p>
              </div>
            )}
          </section>
        )}

        {/* CTA: cook mode */}
        <section className="mt-14 rounded-2xl bg-[#1A1612] p-6 text-[#FAF6EE]">
          <div className="text-eyebrow mb-2 text-[#95D5B2]">Modo cocina</div>
          <p className="font-display text-xl leading-tight">
            ¿Empezamos con <span className="font-italic italic">{recipe.name}</span>?
          </p>
          <Link
            href={`/recipes/${recipe.id}/cook?servings=${displayServings}`}
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#FAF6EE] px-5 py-2.5 text-[13px] font-medium text-[#1A1612] transition-all hover:gap-3 hover:bg-[#52B788]"
          >
            Empezar a cocinar
          </Link>
        </section>

        {/* Back to catalog */}
        <Link
          href="/recipes"
          className="mt-10 flex items-center gap-2 text-[12px] text-[#7A7066] hover:text-[#1A1612]"
        >
          <ChevronLeft size={14} /> Volver al catálogo
        </Link>
      </motion.div>
    </div>
  )
}
