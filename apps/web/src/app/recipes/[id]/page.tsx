"use client"

import { useParams, useRouter } from "next/navigation"
import { useRecipe } from "@/hooks/useRecipes"
import { useAuth } from "@/lib/auth"
import { api } from "@/lib/api"
import { FavoriteButton } from "@/components/recipes/FavoriteButton"
import { ChevronLeft, Clock, Trash2, Pencil } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

// The API may return a richer shape than the hook's local type.
// We cast to this extended interface for the detail view.
interface RecipeDetail {
  id: string
  name: string
  description?: string
  authorId?: string | null
  prepTime?: number
  meals?: string[]
  seasons?: string[]
  tags: string[]
  steps: string[]
  ingredients: (
    | string
    | { ingredientId: string; ingredientName?: string; quantity: number; unit: string }
  )[]
  is_favorite?: boolean
}

const MEAL_LABELS: Record<string, string> = {
  breakfast: "Desayuno",
  lunch: "Comida",
  dinner: "Cena",
  snack: "Snack",
}

const SEASON_LABELS: Record<string, string> = {
  spring: "Primavera",
  summer: "Verano",
  autumn: "Otono",
  winter: "Invierno",
}

export default function RecipeDetailPage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { user } = useAuth()
  const { data, isLoading, error } = useRecipe(params.id)
  const [isDeleting, setIsDeleting] = useState(false)

  // Cast to the richer detail type
  const recipe = data as RecipeDetail | undefined

  async function handleDelete() {
    if (!recipe) return
    const confirmed = window.confirm(
      "Estas seguro de que quieres eliminar esta receta?"
    )
    if (!confirmed) return

    setIsDeleting(true)
    try {
      await api.delete(`/recipes/${recipe.id}`)
      router.push("/recipes")
    } catch {
      setIsDeleting(false)
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-lg text-gray-500">Cargando receta...</p>
      </div>
    )
  }

  if (error || !recipe) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Link
          href="/recipes"
          className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-black"
        >
          <ChevronLeft size={16} />
          Volver a recetas
        </Link>
        <div className="mt-8 rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-red-600">No se pudo cargar la receta.</p>
        </div>
      </div>
    )
  }

  const isAuthor = user && recipe.authorId === user.id

  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      {/* Back link */}
      <Link
        href="/recipes"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-black"
      >
        <ChevronLeft size={16} />
        Volver a recetas
      </Link>

      {/* Header */}
      <div className="mt-6 flex items-start justify-between gap-4">
        <div className="flex-1">
          <h1 className="text-3xl font-bold">{recipe.name}</h1>
          {recipe.prepTime && (
            <div className="mt-2 flex items-center gap-1 text-sm text-gray-500">
              <Clock size={14} />
              <span>{recipe.prepTime} min</span>
            </div>
          )}
          {recipe.description && (
            <p className="mt-2 text-sm text-gray-600">{recipe.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {user && (
            <FavoriteButton
              recipeId={recipe.id}
              isFavorite={!!recipe.is_favorite}
              userId={user.id}
            />
          )}
          {isAuthor && (
            <>
              <Link
                href={`/recipes/${recipe.id}/edit`}
                className="rounded-lg border border-gray-300 p-2 text-gray-500 hover:bg-gray-50 hover:text-black"
                title="Editar"
              >
                <Pencil size={16} />
              </Link>
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="rounded-lg border border-red-200 p-2 text-red-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50"
                title="Eliminar"
              >
                <Trash2 size={16} />
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tags */}
      <div className="mt-4 flex flex-wrap gap-2">
        {recipe.meals?.map((meal) => (
          <span
            key={meal}
            className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600"
          >
            {MEAL_LABELS[meal] ?? meal}
          </span>
        ))}
        {recipe.seasons?.map((season) => (
          <span
            key={season}
            className="rounded-full bg-green-50 px-3 py-1 text-xs font-medium text-green-700"
          >
            {SEASON_LABELS[season] ?? season}
          </span>
        ))}
        {recipe.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-full bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700"
          >
            {tag}
          </span>
        ))}
      </div>

      {/* Ingredients */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Ingredientes</h2>
        {recipe.ingredients.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Sin ingredientes.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {recipe.ingredients.map((ing, idx) => (
              <li
                key={idx}
                className="flex items-center gap-2 rounded-lg border border-gray-100 px-3 py-2 text-sm"
              >
                {typeof ing === "string" ? (
                  <span className="font-medium text-gray-900">{ing}</span>
                ) : (
                  <>
                    <span className="font-medium text-gray-900">
                      {ing.ingredientName ?? ing.ingredientId}
                    </span>
                    <span className="text-gray-500">
                      {ing.quantity} {ing.unit}
                    </span>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Steps */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Pasos</h2>
        {recipe.steps.length === 0 ? (
          <p className="mt-2 text-sm text-gray-500">Sin pasos.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {recipe.steps.map((step, idx) => (
              <li key={idx} className="flex gap-3 text-sm">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black text-xs font-medium text-white">
                  {idx + 1}
                </span>
                <p className="pt-0.5 text-gray-700">{step}</p>
              </li>
            ))}
          </ol>
        )}
      </section>

      {/* Nutritional summary */}
      <section className="mt-8">
        <h2 className="text-lg font-semibold">Resumen nutricional</h2>
        <p className="mt-1 text-xs text-gray-400">
          Valores aproximados por racion
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-xs text-gray-500">Calorias</p>
            <p className="mt-1 text-lg font-semibold">--</p>
          </div>
          <div className="rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-xs text-gray-500">Proteina</p>
            <p className="mt-1 text-lg font-semibold">-- g</p>
          </div>
          <div className="rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-xs text-gray-500">Carbohidratos</p>
            <p className="mt-1 text-lg font-semibold">-- g</p>
          </div>
          <div className="rounded-xl border border-gray-200 p-3 text-center">
            <p className="text-xs text-gray-500">Grasa</p>
            <p className="mt-1 text-lg font-semibold">-- g</p>
          </div>
        </div>
      </section>
    </div>
  )
}
