"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth"
import { useCreateRecipe } from "@/hooks/useRecipes"
import { cn } from "@/lib/utils"
import { Plus, Trash2, ChevronLeft, GripVertical } from "lucide-react"
import Link from "next/link"
import { PhotoRecipeUpload } from "@/components/recipes/PhotoRecipeUpload"
import type { Meal, Season, ExtractedRecipe } from "@ona/shared"
import { MEAL_LABELS, SEASON_LABELS } from "@/lib/labels"

const MEAL_OPTIONS: { value: Meal; label: string }[] = [
  { value: "breakfast", label: MEAL_LABELS.breakfast },
  { value: "lunch", label: MEAL_LABELS.lunch },
  { value: "dinner", label: MEAL_LABELS.dinner },
  { value: "snack", label: MEAL_LABELS.snack },
]

const SEASON_OPTIONS: { value: Season; label: string }[] = [
  { value: "spring", label: SEASON_LABELS.spring },
  { value: "summer", label: SEASON_LABELS.summer },
  { value: "autumn", label: SEASON_LABELS.autumn },
  { value: "winter", label: SEASON_LABELS.winter },
]

interface IngredientInput {
  ingredientId: string
  ingredientName: string
  quantity: number
  unit: string
}

export default function NewRecipePage() {
  const router = useRouter()
  const { user } = useAuth()
  const createRecipe = useCreateRecipe()

  const [name, setName] = useState("")
  const [prepTime, setPrepTime] = useState<number | "">("")
  const [selectedMeals, setSelectedMeals] = useState<Meal[]>([])
  const [selectedSeasons, setSelectedSeasons] = useState<Season[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")

  const [ingredients, setIngredients] = useState<IngredientInput[]>([
    { ingredientId: "", ingredientName: "", quantity: 0, unit: "g" },
  ])

  const [steps, setSteps] = useState<string[]>([""])

  const [photoExtracted, setPhotoExtracted] = useState(false)

  const [searchQuery, setSearchQuery] = useState("")
  const [searchingIndex, setSearchingIndex] = useState<number | null>(null)

  function handlePhotoExtracted(data: ExtractedRecipe) {
    setName(data.name)
    setPrepTime(data.prepTime ?? "")
    setSelectedMeals(data.meals)
    setSelectedSeasons(data.seasons)
    setTags(data.tags)
    setSteps(data.steps.length > 0 ? data.steps : [""])
    setIngredients(
      data.ingredients.length > 0
        ? data.ingredients.map((ing) => ({
            ingredientId: ing.ingredientId ?? "",
            ingredientName: ing.ingredientName ?? ing.extractedName,
            quantity: ing.quantity,
            unit: ing.unit,
          }))
        : [{ ingredientId: "", ingredientName: "", quantity: 0, unit: "g" }]
    )
    setPhotoExtracted(true)
  }

  function toggleMeal(meal: Meal) {
    setSelectedMeals((prev) =>
      prev.includes(meal) ? prev.filter((m) => m !== meal) : [...prev, meal]
    )
  }

  function toggleSeason(season: Season) {
    setSelectedSeasons((prev) =>
      prev.includes(season)
        ? prev.filter((s) => s !== season)
        : [...prev, season]
    )
  }

  function addTag() {
    const trimmed = tagInput.trim()
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed])
    }
    setTagInput("")
  }

  function removeTag(tag: string) {
    setTags(tags.filter((t) => t !== tag))
  }

  function updateIngredient(
    index: number,
    field: keyof IngredientInput,
    value: string | number
  ) {
    const updated = [...ingredients]
    updated[index] = { ...updated[index], [field]: value }
    setIngredients(updated)
  }

  function addIngredient() {
    setIngredients([
      ...ingredients,
      { ingredientId: "", ingredientName: "", quantity: 0, unit: "g" },
    ])
  }

  function removeIngredient(index: number) {
    if (ingredients.length <= 1) return
    setIngredients(ingredients.filter((_, i) => i !== index))
  }

  function updateStep(index: number, value: string) {
    const updated = [...steps]
    updated[index] = value
    setSteps(updated)
  }

  function addStep() {
    setSteps([...steps, ""])
  }

  function removeStep(index: number) {
    if (steps.length <= 1) return
    setSteps(steps.filter((_, i) => i !== index))
  }

  function canSubmit(): boolean {
    return (
      name.trim().length > 0 &&
      selectedMeals.length > 0 &&
      selectedSeasons.length > 0 &&
      ingredients.some(
        (ing) => ing.ingredientName.trim() !== "" && ing.quantity > 0
      )
    )
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!canSubmit()) return

    createRecipe.mutate(
      {
        name: name.trim(),
        description: "",
        ingredients: ingredients
          .filter((ing) => ing.ingredientName.trim() !== "")
          .map((ing) => ing.ingredientId || ing.ingredientName),
        steps: steps.filter((s) => s.trim() !== ""),
        tags: [
          ...tags,
          ...selectedMeals,
          ...selectedSeasons,
        ],
        is_favorite: false,
      },
      {
        onSuccess: () => {
          router.push("/recipes")
        },
      }
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      {/* Back link */}
      <Link
        href="/recipes"
        className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-black"
      >
        <ChevronLeft size={16} />
        Volver a recetas
      </Link>

      <h1 className="mt-6 text-3xl font-bold">Nueva receta</h1>

      {/* Photo extraction */}
      <div className="mt-6">
        <PhotoRecipeUpload onExtracted={handlePhotoExtracted} />
      </div>

      {photoExtracted && (
        <div className="mt-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          Receta extraida de la foto. Revisa los datos y corrige lo que sea necesario antes de guardar.
        </div>
      )}

      <form onSubmit={handleSubmit} className="mt-8 space-y-6">
        {/* Name */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Nombre
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej: Tortilla de patatas"
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
            required
          />
        </div>

        {/* Prep time */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Tiempo de preparación (min)
          </label>
          <input
            type="number"
            value={prepTime}
            onChange={(e) =>
              setPrepTime(e.target.value ? Number(e.target.value) : "")
            }
            placeholder="30"
            min={1}
            className="mt-1 w-32 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
          />
        </div>

        {/* Meals */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Tipo de comida
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {MEAL_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleMeal(opt.value)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  selectedMeals.includes(opt.value)
                    ? "border-black bg-black text-white"
                    : "border-gray-300 text-gray-600 hover:border-gray-400"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Seasons */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Temporada
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            {SEASON_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => toggleSeason(opt.value)}
                className={cn(
                  "rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                  selectedSeasons.includes(opt.value)
                    ? "border-green-700 bg-green-50 text-green-700"
                    : "border-gray-300 text-gray-600 hover:border-gray-400"
                )}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Etiquetas
          </label>
          <div className="mt-1 flex gap-2">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault()
                  addTag()
                }
              }}
              placeholder="Escribe y pulsa Enter..."
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
            />
          </div>
          {tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-3 py-1 text-sm"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="ml-1 text-gray-400 hover:text-gray-600"
                  >
                    x
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Ingredients */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Ingredientes
          </label>
          <div className="mt-2 space-y-2">
            {ingredients.map((ing, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <input
                  type="text"
                  value={ing.ingredientName}
                  onChange={(e) =>
                    updateIngredient(idx, "ingredientName", e.target.value)
                  }
                  placeholder="Ingrediente"
                  className={cn(
                    "flex-1 rounded-lg border px-3 py-2 text-sm focus:outline-none focus:ring-1",
                    photoExtracted && !ing.ingredientId && ing.ingredientName
                      ? "border-amber-400 bg-amber-50 focus:border-amber-500 focus:ring-amber-500"
                      : "border-gray-300 focus:border-black focus:ring-black"
                  )}
                />
                <input
                  type="number"
                  value={ing.quantity || ""}
                  onChange={(e) =>
                    updateIngredient(
                      idx,
                      "quantity",
                      Number(e.target.value)
                    )
                  }
                  placeholder="Cant."
                  min={0}
                  className="w-20 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                />
                <select
                  value={ing.unit}
                  onChange={(e) =>
                    updateIngredient(idx, "unit", e.target.value)
                  }
                  className="w-20 rounded-lg border border-gray-300 px-2 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                >
                  <option value="g">g</option>
                  <option value="kg">kg</option>
                  <option value="ml">ml</option>
                  <option value="l">l</option>
                  <option value="ud">ud</option>
                  <option value="cda">cda</option>
                  <option value="cdta">cdta</option>
                </select>
                <button
                  type="button"
                  onClick={() => removeIngredient(idx)}
                  disabled={ingredients.length <= 1}
                  className="rounded p-1 text-gray-400 hover:text-red-500 disabled:opacity-30"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addIngredient}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-black"
          >
            <Plus size={14} />
            Añadir ingrediente
          </button>
        </div>

        {/* Steps */}
        <div>
          <label className="block text-sm font-medium text-gray-700">
            Pasos
          </label>
          <div className="mt-2 space-y-2">
            {steps.map((step, idx) => (
              <div key={idx} className="flex items-start gap-2">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-500">
                  {idx + 1}
                </span>
                <textarea
                  value={step}
                  onChange={(e) => updateStep(idx, e.target.value)}
                  placeholder={`Paso ${idx + 1}`}
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-black focus:outline-none focus:ring-1 focus:ring-black"
                />
                <button
                  type="button"
                  onClick={() => removeStep(idx)}
                  disabled={steps.length <= 1}
                  className="mt-1 rounded p-1 text-gray-400 hover:text-red-500 disabled:opacity-30"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addStep}
            className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-gray-500 hover:text-black"
          >
            <Plus size={14} />
            Añadir paso
          </button>
        </div>

        {/* Submit */}
        <div className="flex items-center gap-4 border-t border-gray-200 pt-6">
          <button
            type="submit"
            disabled={!canSubmit() || createRecipe.isPending}
            className="rounded-lg bg-black px-6 py-2.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
          >
            {createRecipe.isPending ? "Guardando..." : "Crear receta"}
          </button>
          <Link
            href="/recipes"
            className="text-sm text-gray-500 hover:text-black"
          >
            Cancelar
          </Link>
          {createRecipe.isError && (
            <p className="text-sm text-red-600">
              Error al crear la receta. Intenta de nuevo.
            </p>
          )}
        </div>
      </form>
    </div>
  )
}
