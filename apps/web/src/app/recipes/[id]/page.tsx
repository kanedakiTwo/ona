"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, usePathname, useRouter } from "next/navigation"
import { motion } from "motion/react"
import { useRecipe } from "@/hooks/useRecipes"
import { useAuth } from "@/lib/auth"
import { FavoriteButton } from "@/components/recipes/FavoriteButton"
import { haptic } from "@/lib/pwa/haptics"
import { share } from "@/lib/pwa/share"
import { acquireWakeLock, releaseWakeLock } from "@/lib/pwa/wakeLock"
import { ChevronLeft, ChefHat, Clock, Share2, Users, Sparkles, Zap } from "lucide-react"
import Link from "next/link"

const SEASON_LABELS: Record<string, string> = {
  spring: "Primavera",
  summer: "Verano",
  autumn: "Otono",
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
  const { data: recipe, isLoading, error } = useRecipe(params.id)

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
    // Release on unmount or path change
    return () => {
      if (wakeLockRef.current) {
        releaseWakeLock(wakeLockRef.current)
        wakeLockRef.current = null
      }
    }
  }, [pathname])

  if (isLoading) {
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

  if (error || !recipe) {
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

  const fallbackImg = "https://images.unsplash.com/photo-1490645935967-10de6ba17061?w=1200&q=85&auto=format&fit=crop"
  const img = recipe.imageUrl || fallbackImg

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
                <FavoriteButton recipeId={recipe.id} userId={user.id} />
              </div>
            )}
          </div>
        </div>

        {/* Cooking mode badge */}
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

        {/* Decorative side text */}
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
        </div>

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-4 border-y border-[#DDD6C5] py-4 text-[12px] text-[#4A4239]">
          {recipe.prepTime ? (
            <div className="flex items-center gap-1.5">
              <Clock size={13} className="text-[#7A7066]" />
              <span>{recipe.prepTime} min</span>
            </div>
          ) : null}
          <div className="flex items-center gap-1.5">
            <Users size={13} className="text-[#7A7066]" />
            <span>2 personas</span>
          </div>
          {recipe.seasons?.length > 0 && (
            <div className="flex items-center gap-1.5">
              <Sparkles size={13} className="text-[#7A7066]" />
              <span>{recipe.seasons.map((s: string) => SEASON_LABELS[s] ?? s).join(" · ")}</span>
            </div>
          )}
        </div>

        {/* Tags */}
        {recipe.tags?.length > 0 && (
          <div className="mt-6 flex flex-wrap gap-1.5">
            {recipe.tags.map((tag: string) => (
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
        <section className="mt-10">
          <div className="mb-5 flex items-end justify-between">
            <div>
              <div className="text-eyebrow text-[#7A7066]">Capitulo 01</div>
              <h2 className="font-display text-[1.6rem] leading-tight text-[#1A1612]">
                <span className="font-italic italic">Ingredientes</span>
              </h2>
            </div>
            <span className="text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">
              Para 2
            </span>
          </div>

          <ul className="divide-y divide-dashed divide-[#DDD6C5] border-y border-dashed border-[#DDD6C5]">
            {recipe.ingredients?.map((ing: any, i: number) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.4 + i * 0.04, duration: 0.4 }}
                className="flex items-baseline justify-between py-3"
              >
                <span className="text-[15px] text-[#1A1612] capitalize">
                  {ing.ingredientName ?? ing.name ?? "Ingrediente"}
                </span>
                <span className="font-mono text-[11px] tracking-tight text-[#7A7066]">
                  {ing.quantity}
                  {ing.unit ?? "g"}
                </span>
              </motion.li>
            ))}
          </ul>
        </section>

        {/* Steps */}
        {recipe.steps?.length > 0 && (
          <section className="mt-12">
            <div className="mb-5 flex items-end justify-between gap-4">
              <div>
                <div className="text-eyebrow text-[#7A7066]">Capitulo 02</div>
                <h2 className="font-display text-[1.6rem] leading-tight text-[#1A1612]">
                  <span className="font-italic italic">Preparacion</span>
                </h2>
              </div>
              <button
                onClick={handleCookingToggle}
                className={`inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-medium transition-all active:scale-95 ${
                  isCooking
                    ? "bg-[#C65D38] text-[#FAF6EE]"
                    : "bg-[#1A1612] text-[#FAF6EE] hover:bg-[#2D6A4F]"
                }`}
                aria-pressed={isCooking}
              >
                <ChefHat size={13} />
                {isCooking ? "Salir de cocina" : "Empezar a cocinar"}
              </button>
            </div>

            <ol className="space-y-6">
              {recipe.steps.map((step: string, i: number) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.5 + i * 0.06, duration: 0.5 }}
                  className="flex gap-4"
                >
                  <span className="font-display text-[2.5rem] leading-none text-[#C65D38]/30 -mt-1">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="flex-1 pt-1 text-[14px] leading-relaxed text-[#1A1612]">
                    {step}
                  </p>
                </motion.li>
              ))}
            </ol>
          </section>
        )}

        {/* CTA: add to menu */}
        <section className="mt-14 rounded-2xl bg-[#1A1612] p-6 text-[#FAF6EE]">
          <div className="text-eyebrow mb-2 text-[#95D5B2]">Anadir al menu</div>
          <p className="font-display text-xl leading-tight">
            ¿Te apetece esta receta <span className="font-italic italic">esta semana</span>?
          </p>
          <Link
            href="/menu"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-[#FAF6EE] px-5 py-2.5 text-[13px] font-medium text-[#1A1612] transition-all hover:gap-3 hover:bg-[#52B788]"
          >
            Anadir al menu
          </Link>
        </section>

        {/* Back to catalog */}
        <Link
          href="/recipes"
          className="mt-10 flex items-center gap-2 text-[12px] text-[#7A7066] hover:text-[#1A1612]"
        >
          <ChevronLeft size={14} /> Volver al catalogo
        </Link>
      </motion.div>
    </div>
  )
}
