"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useAuth } from "@/lib/auth"
import { useCreateRecipe, useIngredients } from "@/hooks/useRecipes"
import { cn } from "@/lib/utils"
import { Plus, Trash2, ChevronLeft } from "lucide-react"
import Link from "next/link"
import { PhotoRecipeUpload } from "@/components/recipes/PhotoRecipeUpload"
import { createRecipeSchema } from "@ona/shared"
import type { Meal, Season, ExtractedRecipe, Ingredient } from "@ona/shared"

const MEAL_OPTIONS: { value: Meal; label: string }[] = [
  { value: "breakfast", label: "Desayuno" },
  { value: "lunch", label: "Comida" },
  { value: "dinner", label: "Cena" },
  { value: "snack", label: "Snack" },
]

const SEASON_OPTIONS: { value: Season; label: string }[] = [
  { value: "spring", label: "Primavera" },
  { value: "summer", label: "Verano" },
  { value: "autumn", label: "Otono" },
  { value: "winter", label: "Invierno" },
]

const UNIT_OPTIONS = ["g", "kg", "ml", "l", "ud", "cda", "cdta"]

interface IngredientRow {
  // What the user typed; we resolve against the library to populate ingredientId.
  ingredientName: string
  ingredientId: string
  quantity: number | ""
  unit: string
}

function emptyRow(): IngredientRow {
  return { ingredientName: "", ingredientId: "", quantity: "", unit: "g" }
}

// Build a fast lookup map: lowercased name -> Ingredient
function buildIngredientIndex(list: Ingredient[]): Map<string, Ingredient> {
  const map = new Map<string, Ingredient>()
  for (const ing of list) {
    map.set(ing.name.trim().toLowerCase(), ing)
  }
  return map
}

export default function NewRecipePage() {
  const router = useRouter()
  useAuth()
  const createRecipe = useCreateRecipe()
  const { data: ingredientLibrary = [], isLoading: ingredientsLoading } =
    useIngredients()

  const [name, setName] = useState("")
  const [prepTime, setPrepTime] = useState<number | "">("")
  const [selectedMeals, setSelectedMeals] = useState<Meal[]>([])
  const [selectedSeasons, setSelectedSeasons] = useState<Season[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [ingredientRows, setIngredientRows] = useState<IngredientRow[]>([
    emptyRow(),
  ])
  const [steps, setSteps] = useState<string[]>([""])
  const [photoExtracted, setPhotoExtracted] = useState(false)

  // Map from lowercased name -> Ingredient. Memoized for the lifetime of the data.
  const ingredientIndex = useMemo(
    () => buildIngredientIndex(ingredientLibrary),
    [ingredientLibrary]
  )

  // Per-field validation errors surfaced after a submit attempt.
  const [errors, setErrors] = useState<Record<string, string>>({})

  function resolveIngredientId(typedName: string): string {
    const hit = ingredientIndex.get(typedName.trim().toLowerCase())
    return hit ? hit.id : ""
  }

  function handlePhotoExtracted(data: ExtractedRecipe) {
    setName(data.name)
    setPrepTime(data.prepTime ?? "")
    setSelectedMeals(data.meals)
    setSelectedSeasons(data.seasons)
    setTags(data.tags)
    setSteps(data.steps.length > 0 ? data.steps : [""])
    setIngredientRows(
      data.ingredients.length > 0
        ? data.ingredients.map((ing) => ({
            ingredientId: ing.ingredientId ?? "",
            ingredientName: ing.ingredientName ?? ing.extractedName,
            quantity: ing.quantity,
            unit: ing.unit || "g",
          }))
        : [emptyRow()]
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

  function updateIngredientName(idx: number, value: string) {
    const next = [...ingredientRows]
    next[idx] = {
      ...next[idx],
      ingredientName: value,
      // Re-resolve ingredientId on every keystroke so the row stays in sync.
      ingredientId: resolveIngredientId(value),
    }
    setIngredientRows(next)
  }

  function updateIngredientQuantity(idx: number, value: string) {
    const next = [...ingredientRows]
    next[idx] = {
      ...next[idx],
      quantity: value === "" ? "" : Number(value),
    }
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

  // Build the schema-shaped payload from form state.
  function buildPayload() {
    const cleanedIngredients = ingredientRows
      .map((r) => ({
        ...r,
        ingredientName: r.ingredientName.trim(),
      }))
      .filter((r) => r.ingredientName.length > 0)
      .map((r) => ({
        ingredientId: r.ingredientId,
        quantity: typeof r.quantity === "number" ? r.quantity : 0,
        unit: r.unit || "g",
      }))

    const payload: Record<string, unknown> = {
      name: name.trim(),
      meals: selectedMeals,
      seasons: selectedSeasons,
      tags,
      steps: steps.map((s) => s.trim()).filter((s) => s.length > 0),
      ingredients: cleanedIngredients,
    }

    if (typeof prepTime === "number" && prepTime > 0) {
      payload.prepTime = prepTime
    }

    return payload
  }

  // Surface inline errors per row (e.g. "no encontrado") regardless of submit.
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
      // Map zod issues to a flat field -> message dictionary.
      const next: Record<string, string> = {}
      for (const issue of parsed.error.issues) {
        const key = issue.path.length > 0 ? String(issue.path[0]) : "_form"
        if (!next[key]) next[key] = issue.message
      }
      // Add a custom message when any row has free-text without a matched id.
      const hasUnresolved = ingredientRows.some(
        (r) => r.ingredientName.trim() && !r.ingredientId
      )
      if (hasUnresolved) {
        next.ingredients =
          "Hay ingredientes sin asociar a la base. Selecciona uno de la lista."
      }
      setErrors(next)
      return
    }

    // Block submit if any row has typed text but no matched id (zod won't catch
    // this on its own because we already filter such rows out by name; but a
    // user typing free-text expects feedback, not silent removal).
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

    createRecipe.mutate(parsed.data, {
      onSuccess: (created) => {
        router.push(`/recipes/${created.id}`)
      },
      onError: (err) => {
        setErrors({ _form: err.message ?? "Error al crear la receta." })
      },
    })
  }

  const canSubmit =
    name.trim().length > 0 &&
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
        {/* Back link */}
        <Link
          href="/recipes"
          className="inline-flex items-center gap-1 text-[12px] uppercase tracking-[0.15em] text-[#7A7066] hover:text-[#1A1612]"
        >
          <ChevronLeft size={14} />
          Volver al catalogo
        </Link>

        {/* Editorial header */}
        <div className="mt-6">
          <div className="text-eyebrow text-[#C65D38]">Nueva entrada</div>
          <h1 className="mt-2 font-display text-[2.4rem] leading-[1.02] tracking-tight text-[#1A1612]">
            Una nueva <span className="font-italic italic text-[#C65D38]">receta</span>
          </h1>
          <p className="mt-2 max-w-md text-[13px] leading-relaxed text-[#7A7066]">
            Completa los detalles esenciales. Los ingredientes se enlazan con la
            biblioteca de ONA para calcular nutrientes y temporada.
          </p>
        </div>

        {/* Photo extraction */}
        <div className="mt-8">
          <PhotoRecipeUpload onExtracted={handlePhotoExtracted} />
        </div>

        {photoExtracted && (
          <div className="mt-4 rounded-lg border border-[#DDD6C5] bg-[#F2EDE0] px-4 py-3 text-[12px] text-[#1A1612]">
            Receta extraida de la foto. Revisa los datos y ajusta lo que sea
            necesario antes de guardar.
          </div>
        )}

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
              placeholder="Ej: Tortilla de patatas"
              className={cn(
                "mt-4 w-full rounded-lg border bg-[#F2EDE0] px-3 py-3 text-[15px] text-[#1A1612] placeholder:text-[#7A7066] focus:outline-none focus:ring-1",
                errors.name
                  ? "border-[#C65D38] focus:border-[#C65D38] focus:ring-[#C65D38]"
                  : "border-[#DDD6C5] focus:border-[#1A1612] focus:ring-[#1A1612]"
              )}
              required
            />
            {errors.name && (
              <p className="mt-2 text-[12px] italic text-[#C65D38]">
                {errors.name}
              </p>
            )}
          </section>

          {/* Prep time */}
          <section>
            <label className="text-eyebrow text-[#7A7066]">
              Tiempo de preparacion
            </label>
            <div className="mt-2 flex items-baseline gap-2">
              <input
                type="number"
                value={prepTime}
                onChange={(e) =>
                  setPrepTime(e.target.value ? Number(e.target.value) : "")
                }
                placeholder="30"
                min={1}
                className="w-28 rounded-lg border border-[#DDD6C5] bg-[#F2EDE0] px-3 py-2 text-[14px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none focus:ring-1 focus:ring-[#1A1612]"
              />
              <span className="text-[12px] uppercase tracking-[0.12em] text-[#7A7066]">
                minutos
              </span>
            </div>
            {errors.prepTime && (
              <p className="mt-2 text-[12px] italic text-[#C65D38]">
                {errors.prepTime}
              </p>
            )}
          </section>

          {/* Meals */}
          <section>
            <div className="text-eyebrow text-[#7A7066]">Tipo de comida</div>
            <p className="mt-1 text-[12px] italic text-[#7A7066]">
              Elige al menos uno
            </p>
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
            <p className="mt-1 text-[12px] italic text-[#7A7066]">
              Elige al menos una
            </p>
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
                placeholder="Escribe y pulsa Enter..."
                className="flex-1 rounded-lg border border-[#DDD6C5] bg-[#F2EDE0] px-3 py-2 text-[14px] text-[#1A1612] placeholder:text-[#7A7066] focus:border-[#1A1612] focus:outline-none focus:ring-1 focus:ring-[#1A1612]"
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
            <p className="mt-1 text-[12px] italic text-[#7A7066]">
              Cada ingrediente se asocia a la biblioteca de ONA. Empieza a
              escribir y selecciona uno de la lista.
            </p>

            {/* Single shared datalist for all rows */}
            <datalist id="ingredient-library">
              {ingredientLibrary.map((ing) => (
                <option key={ing.id} value={ing.name} />
              ))}
            </datalist>

            <div className="mt-4 space-y-3">
              {ingredientRows.map((row, idx) => {
                const hint = ingredientRowHints[idx]
                return (
                  <div key={idx} className="flex flex-col gap-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        list="ingredient-library"
                        value={row.ingredientName}
                        onChange={(e) =>
                          updateIngredientName(idx, e.target.value)
                        }
                        placeholder={
                          ingredientsLoading
                            ? "Cargando biblioteca..."
                            : "Ingrediente"
                        }
                        autoComplete="off"
                        className={cn(
                          "flex-1 rounded-lg border bg-[#F2EDE0] px-3 py-2 text-[14px] text-[#1A1612] placeholder:text-[#7A7066] focus:outline-none focus:ring-1",
                          hint
                            ? "border-[#C65D38] focus:border-[#C65D38] focus:ring-[#C65D38]"
                            : "border-[#DDD6C5] focus:border-[#1A1612] focus:ring-[#1A1612]"
                        )}
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
                        onChange={(e) =>
                          updateIngredientUnit(idx, e.target.value)
                        }
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
                      <p className="pl-1 text-[11px] italic text-[#C65D38]">
                        {hint}
                      </p>
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
              Anadir ingrediente
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
              <span className="font-italic italic">Preparacion</span>
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
                    className="flex-1 resize-none rounded-lg border border-[#DDD6C5] bg-[#F2EDE0] px-3 py-2 text-[14px] leading-relaxed text-[#1A1612] placeholder:text-[#7A7066] focus:border-[#1A1612] focus:outline-none focus:ring-1 focus:ring-[#1A1612]"
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
              Anadir paso
            </button>
          </section>

          {/* Submit */}
          <div className="flex flex-col gap-3 border-t border-[#DDD6C5] pt-6">
            {errors._form && (
              <p className="text-[12px] italic text-[#C65D38]">
                {errors._form}
              </p>
            )}
            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={!canSubmit || createRecipe.isPending}
                className="rounded-full bg-[#1A1612] px-6 py-2.5 text-[12px] font-medium uppercase tracking-[0.12em] text-[#FAF6EE] transition-all hover:bg-[#2D6A4F] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {createRecipe.isPending ? "Guardando..." : "Crear receta"}
              </button>
              <Link
                href="/recipes"
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
