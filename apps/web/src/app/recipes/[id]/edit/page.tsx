"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, Plus, Trash2 } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { useIngredients, useRecipe, useUpdateRecipe } from "@/hooks/useRecipes"
import { IngredientAutocomplete } from "@/components/recipes/IngredientAutocomplete"
import { cn } from "@/lib/utils"
import { createRecipeSchema } from "@ona/shared"
import type { Difficulty, Ingredient, Meal, Season } from "@ona/shared"
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

const UNIT_OPTIONS = ["g", "ml", "u", "cda", "cdita", "pizca", "al_gusto"]
const DIFFICULTY_OPTIONS: { value: Difficulty; label: string }[] = [
  { value: "easy", label: "Fácil" },
  { value: "medium", label: "Media" },
  { value: "hard", label: "Compleja" },
]

interface IngredientRow {
  ingredientName: string
  ingredientId: string
  quantity: number | ""
  unit: string
}

function emptyRow(): IngredientRow {
  return { ingredientName: "", ingredientId: "", quantity: "", unit: "g" }
}

export default function EditRecipePage() {
  const params = useParams<{ id: string }>()
  const router = useRouter()
  const { user, isLoading: authLoading } = useAuth()

  const { data: recipe, isLoading: recipeLoading, error: recipeError } =
    useRecipe(params.id)
  const updateRecipe = useUpdateRecipe(params.id)
  const { data: ingredientLibrary = [], isLoading: ingredientsLoading } =
    useIngredients()

  const [name, setName] = useState("")
  const [servings, setServings] = useState<number>(2)
  const [prepTime, setPrepTime] = useState<number | "">("")
  const [cookTime, setCookTime] = useState<number | "">("")
  const [difficulty, setDifficulty] = useState<Difficulty>("medium")
  const [selectedMeals, setSelectedMeals] = useState<Meal[]>([])
  const [selectedSeasons, setSelectedSeasons] = useState<Season[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [ingredientRows, setIngredientRows] = useState<IngredientRow[]>([emptyRow()])
  const [steps, setSteps] = useState<string[]>([""])
  const [notes, setNotes] = useState("")
  const [tips, setTips] = useState("")

  const [errors, setErrors] = useState<Record<string, string>>({})
  const [seeded, setSeeded] = useState(false)

  // Hydrate the form from the loaded recipe — once.
  useEffect(() => {
    if (seeded) return
    if (!recipe) return
    setName(recipe.name)
    setServings(recipe.servings ?? 2)
    setPrepTime(recipe.prepTime ?? "")
    setCookTime(recipe.cookTime ?? "")
    setDifficulty(recipe.difficulty ?? "medium")
    setSelectedMeals(recipe.meals ?? [])
    setSelectedSeasons(recipe.seasons ?? [])
    setTags(recipe.tags ?? [])
    setNotes(recipe.notes ?? "")
    setTips(recipe.tips ?? "")
    setIngredientRows(
      recipe.ingredients.length > 0
        ? recipe.ingredients.map((ri) => ({
            ingredientName: ri.ingredientName ?? "",
            ingredientId: ri.ingredientId,
            quantity: ri.quantity,
            unit: ri.unit,
          }))
        : [emptyRow()]
    )
    setSteps(
      recipe.steps.length > 0 ? recipe.steps.map((s) => s.text) : [""]
    )
    setSeeded(true)
  }, [recipe, seeded])

  // Authorization check (after the recipe loads).
  useEffect(() => {
    if (authLoading || recipeLoading || !recipe) return
    const isOwner = user && recipe.authorId === user.id
    if (!isOwner) {
      // System recipe or not the author → bounce back to detail.
      router.replace(`/recipes/${recipe.id}`)
    }
  }, [authLoading, recipeLoading, recipe, user, router])

  function toggleMeal(m: Meal) {
    setSelectedMeals((prev) =>
      prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]
    )
  }
  function toggleSeason(s: Season) {
    setSelectedSeasons((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    )
  }

  function addTag() {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) setTags([...tags, t])
    setTagInput("")
  }
  function removeTag(t: string) {
    setTags(tags.filter((x) => x !== t))
  }

  function setRowIngredient(idx: number, ing: Ingredient) {
    const next = [...ingredientRows]
    next[idx] = {
      ...next[idx],
      ingredientName: ing.name,
      ingredientId: ing.id,
    }
    setIngredientRows(next)
  }
  function updateIngredientQuantity(idx: number, value: string) {
    const next = [...ingredientRows]
    next[idx] = { ...next[idx], quantity: value === "" ? "" : Number(value) }
    setIngredientRows(next)
  }
  function updateIngredientUnit(idx: number, value: string) {
    const next = [...ingredientRows]
    next[idx] = { ...next[idx], unit: value }
    setIngredientRows(next)
  }
  function addIngredientRow() {
    setIngredientRows([...ingredientRows, emptyRow()])
  }
  function removeIngredientRow(idx: number) {
    if (ingredientRows.length <= 1) return
    setIngredientRows(ingredientRows.filter((_, i) => i !== idx))
  }

  function updateStep(idx: number, value: string) {
    const next = [...steps]
    next[idx] = value
    setSteps(next)
  }
  function addStep() {
    setSteps([...steps, ""])
  }
  function removeStep(idx: number) {
    if (steps.length <= 1) return
    setSteps(steps.filter((_, i) => i !== idx))
  }

  function buildPayload() {
    const cleanedIngredients = ingredientRows
      .filter((r) => r.ingredientName.trim().length > 0)
      .map((r) => ({
        ingredientId: r.ingredientId,
        quantity: typeof r.quantity === "number" ? r.quantity : 0,
        unit: r.unit || "g",
      }))

    const cleanedSteps = steps
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((text, index) => ({ index, text }))

    const payload: Record<string, unknown> = {
      name: name.trim(),
      servings,
      difficulty,
      meals: selectedMeals,
      seasons: selectedSeasons,
      tags,
      ingredients: cleanedIngredients,
      steps: cleanedSteps,
    }
    if (typeof prepTime === "number" && prepTime > 0) payload.prepTime = prepTime
    if (typeof cookTime === "number" && cookTime > 0) payload.cookTime = cookTime
    if (notes.trim().length > 0) payload.notes = notes.trim()
    if (tips.trim().length > 0) payload.tips = tips.trim()

    return payload
  }

  const ingredientRowHints = ingredientRows.map((row) => {
    const typed = row.ingredientName.trim()
    if (!typed) return null
    if (ingredientsLoading) return null
    if (!row.ingredientId) return "no encontrado"
    return null
  })

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setErrors({})
    const payload = buildPayload()
    const parsed = createRecipeSchema.safeParse(payload)
    if (!parsed.success) {
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.length > 0 ? String(issue.path[0]) : "_form"
        if (!next[key]) next[key] = issue.message
      }
      setErrors(next)
      return
    }
    const hasUnresolved = ingredientRows.some(
      (r) => r.ingredientName.trim() && !r.ingredientId
    )
    if (hasUnresolved) {
      setErrors({
        ingredients:
          "Hay ingredientes sin asociar a la base. Selecciona uno de la lista.",
      })
      return
    }
    updateRecipe.mutate(parsed.data, {
      onSuccess: (updated) => {
        router.push(`/recipes/${updated.id}`)
      },
      onError: (err) => {
        setErrors({ _form: err.message ?? "Error al guardar la receta." })
      },
    })
  }

  if (recipeLoading || !seeded) {
    return (
      <div className="min-h-screen bg-[#FAF6EE] px-5 pt-12 text-[13px] text-[#7A7066]">
        Cargando receta…
      </div>
    )
  }

  if (recipeError) {
    return (
      <div className="min-h-screen bg-[#FAF6EE] px-5 pt-12 text-[13px] text-[#C65D38]">
        No se pudo cargar la receta.
      </div>
    )
  }

  const canSubmit =
    name.trim().length > 0 &&
    servings > 0 &&
    selectedMeals.length > 0 &&
    selectedSeasons.length > 0 &&
    ingredientRows.some(
      (r) =>
        r.ingredientName.trim() !== "" &&
        r.ingredientId !== "" &&
        typeof r.quantity === "number" &&
        r.quantity > 0
    )

  return (
    <div className="min-h-screen bg-[#FAF6EE]">
      <div className="mx-auto max-w-2xl px-5 pb-16 pt-8">
        <Link
          href={`/recipes/${params.id}`}
          className="inline-flex items-center gap-1 text-[12px] uppercase tracking-[0.15em] text-[#7A7066] hover:text-[#1A1612]"
        >
          <ChevronLeft size={14} />
          Volver a la receta
        </Link>

        <div className="mt-6">
          <div className="text-eyebrow text-[#C65D38]">Editor</div>
          <h1 className="mt-2 font-display text-[2.2rem] leading-[1.02] tracking-tight text-[#1A1612]">
            Editar <span className="font-italic italic text-[#C65D38]">receta</span>
          </h1>
          <p className="mt-2 max-w-md text-[13px] leading-relaxed text-[#7A7066]">
            Cambia lo que quieras y guarda. Los ingredientes deben estar
            enlazados a la biblioteca para calcular nutrientes.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="mt-10 space-y-10" noValidate>
          {/* Name */}
          <section>
            <div className="text-eyebrow text-[#7A7066]">Capitulo 01</div>
            <h2 className="mt-1 font-display text-[1.5rem] leading-tight text-[#1A1612]">
              <span className="font-italic italic">Nombre</span>
            </h2>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={cn(
                "mt-4 w-full rounded-lg border bg-[#F2EDE0] px-3 py-3 text-[15px] text-[#1A1612] focus:outline-none focus:ring-1",
                errors.name
                  ? "border-[#C65D38] focus:border-[#C65D38] focus:ring-[#C65D38]"
                  : "border-[#DDD6C5] focus:border-[#1A1612] focus:ring-[#1A1612]"
              )}
              required
            />
            {errors.name && (
              <p className="mt-2 text-[12px] italic text-[#C65D38]">{errors.name}</p>
            )}
          </section>

          {/* Servings + times */}
          <section>
            <div className="text-eyebrow text-[#7A7066]">Tiempos y comensales</div>
            <div className="mt-3 grid grid-cols-3 gap-4">
              <div>
                <label className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
                  Comensales
                </label>
                <input
                  type="number"
                  value={servings}
                  onChange={(e) => setServings(Math.max(1, Number(e.target.value) || 1))}
                  min={1}
                  className="mt-1 w-full rounded-lg border border-[#DDD6C5] bg-[#F2EDE0] px-3 py-2 text-[14px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none focus:ring-1 focus:ring-[#1A1612]"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
                  Prep (min)
                </label>
                <input
                  type="number"
                  value={prepTime}
                  onChange={(e) =>
                    setPrepTime(e.target.value ? Number(e.target.value) : "")
                  }
                  min={0}
                  className="mt-1 w-full rounded-lg border border-[#DDD6C5] bg-[#F2EDE0] px-3 py-2 text-[14px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none focus:ring-1 focus:ring-[#1A1612]"
                />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
                  Cocción (min)
                </label>
                <input
                  type="number"
                  value={cookTime}
                  onChange={(e) =>
                    setCookTime(e.target.value ? Number(e.target.value) : "")
                  }
                  min={0}
                  className="mt-1 w-full rounded-lg border border-[#DDD6C5] bg-[#F2EDE0] px-3 py-2 text-[14px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none focus:ring-1 focus:ring-[#1A1612]"
                />
              </div>
            </div>
          </section>

          {/* Difficulty */}
          <section>
            <div className="text-eyebrow text-[#7A7066]">Dificultad</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {DIFFICULTY_OPTIONS.map((opt) => {
                const active = difficulty === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setDifficulty(opt.value)}
                    className={cn(
                      "rounded-full border px-4 py-2 text-[12px] uppercase tracking-[0.12em] transition-all active:scale-95",
                      active
                        ? "border-[#1A1612] bg-[#1A1612] text-[#FAF6EE]"
                        : "border-[#DDD6C5] bg-[#F2EDE0] text-[#4A4239] hover:border-[#1A1612]"
                    )}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </section>

          {/* Meals */}
          <section>
            <div className="text-eyebrow text-[#7A7066]">Tipo de comida</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {MEAL_OPTIONS.map((opt) => {
                const active = selectedMeals.includes(opt.value)
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleMeal(opt.value)}
                    className={cn(
                      "rounded-full border px-4 py-2 text-[12px] uppercase tracking-[0.12em] transition-all active:scale-95",
                      active
                        ? "border-[#1A1612] bg-[#1A1612] text-[#FAF6EE]"
                        : "border-[#DDD6C5] bg-[#F2EDE0] text-[#4A4239] hover:border-[#1A1612]"
                    )}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
            {errors.meals && (
              <p className="mt-2 text-[12px] italic text-[#C65D38]">
                {errors.meals}
              </p>
            )}
          </section>

          {/* Seasons */}
          <section>
            <div className="text-eyebrow text-[#7A7066]">Temporada</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {SEASON_OPTIONS.map((opt) => {
                const active = selectedSeasons.includes(opt.value)
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => toggleSeason(opt.value)}
                    className={cn(
                      "rounded-full border px-4 py-2 text-[12px] uppercase tracking-[0.12em] transition-all active:scale-95",
                      active
                        ? "border-[#2D6A4F] bg-[#2D6A4F] text-[#FAF6EE]"
                        : "border-[#DDD6C5] bg-[#F2EDE0] text-[#4A4239] hover:border-[#2D6A4F]"
                    )}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
            {errors.seasons && (
              <p className="mt-2 text-[12px] italic text-[#C65D38]">
                {errors.seasons}
              </p>
            )}
          </section>

          {/* Tags */}
          <section>
            <div className="text-eyebrow text-[#7A7066]">Etiquetas</div>
            <div className="mt-3 flex gap-2">
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
                placeholder="Escribe y pulsa Enter…"
                className="flex-1 rounded-lg border border-[#DDD6C5] bg-[#F2EDE0] px-3 py-2 text-[14px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none focus:ring-1 focus:ring-[#1A1612]"
              />
            </div>
            {tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-[#F2EDE0] px-3 py-1 text-[10px] uppercase tracking-[0.1em] text-[#4A4239]"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="ml-1 text-[#7A7066] hover:text-[#C65D38]"
                      aria-label={`Quitar etiqueta ${tag}`}
                    >
                      x
                    </button>
                  </span>
                ))}
              </div>
            )}
          </section>

          {/* Ingredients */}
          <section>
            <div className="text-eyebrow text-[#7A7066]">Capitulo 02</div>
            <h2 className="mt-1 font-display text-[1.5rem] leading-tight text-[#1A1612]">
              <span className="font-italic italic">Ingredientes</span>
            </h2>
            <div className="mt-4 space-y-3">
              {ingredientRows.map((row, idx) => {
                const hint = ingredientRowHints[idx]
                const selectedIng = row.ingredientId
                  ? ingredientLibrary.find((ing) => ing.id === row.ingredientId) ?? null
                  : null
                return (
                  <div key={idx} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <IngredientAutocomplete
                        value={selectedIng}
                        onSelect={(ing) => setRowIngredient(idx, ing)}
                        placeholder={
                          ingredientsLoading ? "Cargando biblioteca…" : "Ingrediente"
                        }
                        hasError={!!hint}
                      />
                      <input
                        type="number"
                        value={row.quantity === "" ? "" : row.quantity}
                        onChange={(e) =>
                          updateIngredientQuantity(idx, e.target.value)
                        }
                        placeholder="Cant."
                        min={0}
                        step="any"
                        className="w-20 rounded-lg border border-[#DDD6C5] bg-[#F2EDE0] px-3 py-2 text-[14px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none focus:ring-1 focus:ring-[#1A1612]"
                      />
                      <select
                        value={row.unit}
                        onChange={(e) => updateIngredientUnit(idx, e.target.value)}
                        className="w-20 rounded-lg border border-[#DDD6C5] bg-[#F2EDE0] px-2 py-2 text-[14px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none focus:ring-1 focus:ring-[#1A1612]"
                      >
                        {UNIT_OPTIONS.map((u) => (
                          <option key={u} value={u}>
                            {u}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => removeIngredientRow(idx)}
                        disabled={ingredientRows.length <= 1}
                        className="rounded p-1 text-[#7A7066] hover:text-[#C65D38] disabled:opacity-30"
                        aria-label="Quitar ingrediente"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                    {hint && (
                      <p className="pl-1 text-[11px] italic text-[#C65D38]">{hint}</p>
                    )}
                  </div>
                )
              })}
            </div>
            <button
              type="button"
              onClick={addIngredientRow}
              className="mt-3 inline-flex items-center gap-1 text-[12px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]"
            >
              <Plus size={14} />
              Añadir ingrediente
            </button>
            {errors.ingredients && (
              <p className="mt-3 text-[12px] italic text-[#C65D38]">
                {errors.ingredients}
              </p>
            )}
          </section>

          {/* Steps */}
          <section>
            <div className="text-eyebrow text-[#7A7066]">Capitulo 03</div>
            <h2 className="mt-1 font-display text-[1.5rem] leading-tight text-[#1A1612]">
              <span className="font-italic italic">Preparación</span>
            </h2>
            <div className="mt-4 space-y-3">
              {steps.map((step, idx) => (
                <div key={idx} className="flex items-start gap-3">
                  <span className="font-display mt-1 text-[1.4rem] leading-none text-[#C65D38]/40">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <textarea
                    value={step}
                    onChange={(e) => updateStep(idx, e.target.value)}
                    placeholder={`Paso ${idx + 1}`}
                    rows={2}
                    className="flex-1 resize-none rounded-lg border border-[#DDD6C5] bg-[#F2EDE0] px-3 py-2 text-[14px] leading-relaxed text-[#1A1612] focus:border-[#1A1612] focus:outline-none focus:ring-1 focus:ring-[#1A1612]"
                  />
                  <button
                    type="button"
                    onClick={() => removeStep(idx)}
                    disabled={steps.length <= 1}
                    className="mt-1 rounded p-1 text-[#7A7066] hover:text-[#C65D38] disabled:opacity-30"
                    aria-label="Quitar paso"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addStep}
              className="mt-3 inline-flex items-center gap-1 text-[12px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]"
            >
              <Plus size={14} />
              Añadir paso
            </button>
          </section>

          {/* Notes / tips */}
          <section>
            <div className="text-eyebrow text-[#7A7066]">Notas y trucos</div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-4">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Notas (e.g. la madre la hacía con cebolla pochada)…"
                rows={3}
                className="resize-none rounded-lg border border-[#DDD6C5] bg-[#F2EDE0] px-3 py-2 text-[13px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none focus:ring-1 focus:ring-[#1A1612]"
              />
              <textarea
                value={tips}
                onChange={(e) => setTips(e.target.value)}
                placeholder="Trucos (e.g. dejar reposar 5 min antes de servir)…"
                rows={3}
                className="resize-none rounded-lg border border-[#DDD6C5] bg-[#F2EDE0] px-3 py-2 text-[13px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none focus:ring-1 focus:ring-[#1A1612]"
              />
            </div>
          </section>

          {/* Submit */}
          <div className="flex flex-col gap-3 border-t border-[#DDD6C5] pt-6">
            {errors._form && (
              <p className="text-[12px] italic text-[#C65D38]">{errors._form}</p>
            )}
            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={!canSubmit || updateRecipe.isPending}
                className="rounded-full bg-[#1A1612] px-6 py-2.5 text-[12px] font-medium uppercase tracking-[0.12em] text-[#FAF6EE] transition-all hover:bg-[#2D6A4F] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {updateRecipe.isPending ? "Guardando…" : "Guardar cambios"}
              </button>
              <Link
                href={`/recipes/${params.id}`}
                className="text-[12px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]"
              >
                Cancelar
              </Link>
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
