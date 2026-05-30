"use client"

import { useEffect, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import Link from "next/link"
import { ChevronLeft, Plus, Sparkles, Trash2 } from "lucide-react"
import { useAuth } from "@/lib/auth"
import {
  useIngredients,
  useRecipe,
  useRegenerateRecipeImage,
  useUpdateRecipe,
} from "@/hooks/useRecipes"
import { useUser } from "@/hooks/useUser"
import { IngredientAutocomplete } from "@/components/recipes/IngredientAutocomplete"
import {
  SortableStepsList,
  makeStep,
  type StepDraft,
} from "@/components/recipes/SortableStepsList"
import { cn } from "@/lib/utils"
import { LintFailureError } from "@/lib/api"
import { humanizeLintKey } from "@/lib/recipeView"
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
  /** When true, the ingredient renders with an "opcional" badge on the
   * detail view and the shopping aggregator skips it. Mirrors the field
   * already present on `RecipeIngredient`. */
  optional: boolean
}

function emptyRow(): IngredientRow {
  return { ingredientName: "", ingredientId: "", quantity: "", unit: "g", optional: false }
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
  // Steps carry a stable client-side id so the drag-and-drop list can
  // reorder them without losing focus or remounting textareas. The id is
  // form-local: the server still receives `{ index, text }`.
  const [steps, setSteps] = useState<StepDraft[]>([makeStep()])
  // Notes / tips persist as single `text` columns server-side but the UI
  // exposes them as multi-entry lists so the user can stack short ideas
  // (e.g. "Cebolla roja queda mucho mejor" / "Picar fino"). On submit we
  // join non-empty entries with a blank line so the persisted blob round
  // trips through split-on-paragraph on load.
  const [notes, setNotes] = useState<string[]>([""])
  const [tips, setTips] = useState<string[]>([""])

  const [errors, setErrors] = useState<Record<string, string>>({})
  // Set to true after the server returns lint warnings: the next click of
  // "Guardar igualmente" re-submits with ?force=1 so the user can save a
  // recipe whose quantities are unusual or whose steps mention an unbound
  // ingredient. Mirrors the create flow on /recipes/new.
  const [allowForce, setAllowForce] = useState(false)
  const [seeded, setSeeded] = useState(false)

  // Hydrate the form from the loaded recipe — once.
  useEffect(() => {
    if (seeded) return
    if (!recipe) return
    setName(recipe.name)
    setServings(recipe.servings)
    setPrepTime(recipe.prepTime ?? "")
    setCookTime(recipe.cookTime ?? "")
    setDifficulty(recipe.difficulty ?? "medium")
    setSelectedMeals(recipe.meals ?? [])
    setSelectedSeasons(recipe.seasons ?? [])
    setTags(recipe.tags ?? [])
    // Round-trip the persisted text blob through split-on-blank-line so a
    // recipe authored before the multi-entry UI still renders as one row.
    const splitParas = (raw: string | null | undefined): string[] => {
      if (!raw) return [""]
      const parts = raw.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0)
      return parts.length > 0 ? parts : [""]
    }
    setNotes(splitParas(recipe.notes))
    setTips(splitParas(recipe.tips))
    setIngredientRows(
      recipe.ingredients.length > 0
        ? recipe.ingredients.map((ri) => ({
            ingredientName: ri.ingredientName ?? "",
            ingredientId: ri.ingredientId,
            quantity: ri.quantity,
            unit: ri.unit,
            optional: ri.optional ?? false,
          }))
        : [emptyRow()]
    )
    setSteps(
      recipe.steps.length > 0
        ? recipe.steps.map((s) => makeStep(s.text))
        : [makeStep()],
    )
    setSeeded(true)
  }, [recipe, seeded])

  // Authorization check (after the recipe loads). Authors can always edit
  // their own row; admins can edit any recipe (system + others'). Everyone
  // else gets bounced back to the read-only detail view.
  useEffect(() => {
    if (authLoading || recipeLoading || !recipe) return
    if (!user) {
      router.replace(`/recipes/${recipe.id}`)
      return
    }
    const isOwner = recipe.authorId === user.id
    const isAdmin = user.role === 'admin'
    if (!isOwner && !isAdmin) {
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
  function toggleIngredientOptional(idx: number) {
    const next = [...ingredientRows]
    next[idx] = { ...next[idx], optional: !next[idx].optional }
    setIngredientRows(next)
  }
  function addIngredientRow() {
    setIngredientRows([...ingredientRows, emptyRow()])
  }
  function removeIngredientRow(idx: number) {
    if (ingredientRows.length <= 1) return
    setIngredientRows(ingredientRows.filter((_, i) => i !== idx))
  }

  // Generic single-string-list helpers, shared by notes + tips.
  function updateAt(setter: (next: string[]) => void, list: string[], idx: number, value: string) {
    const next = [...list]
    next[idx] = value
    setter(next)
  }
  function addAt(setter: (next: string[]) => void, list: string[]) {
    setter([...list, ""])
  }
  function removeAt(setter: (next: string[]) => void, list: string[], idx: number) {
    if (list.length <= 1) {
      // Last row — clear it instead of dropping so the form always has a
      // visible textarea (otherwise the section vanishes silently).
      setter([""])
      return
    }
    setter(list.filter((_, i) => i !== idx))
  }

  function updateStep(id: string, value: string) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, text: value } : s)))
  }
  function addStep() {
    setSteps((prev) => [...prev, makeStep()])
  }
  function removeStep(id: string) {
    setSteps((prev) => {
      // Last row — clear it instead of dropping so the form always has a
      // visible textarea (mirrors the notes/tips editor behaviour).
      if (prev.length <= 1) return [makeStep()]
      return prev.filter((s) => s.id !== id)
    })
  }

  function buildPayload() {
    const cleanedIngredients = ingredientRows
      .filter((r) => r.ingredientName.trim().length > 0)
      .map((r) => ({
        ingredientId: r.ingredientId,
        quantity: typeof r.quantity === "number" ? r.quantity : 0,
        unit: r.unit || "g",
        optional: r.optional,
      }))

    const cleanedSteps = steps
      .map((s) => s.text.trim())
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
    const joinEntries = (entries: string[]): string => {
      return entries.map((e) => e.trim()).filter((e) => e.length > 0).join("\n\n")
    }
    const notesText = joinEntries(notes)
    const tipsText = joinEntries(tips)
    if (notesText.length > 0) payload.notes = notesText
    if (tipsText.length > 0) payload.tips = tipsText

    return payload
  }

  const ingredientRowHints = ingredientRows.map((row) => {
    const typed = row.ingredientName.trim()
    if (!typed) return null
    if (ingredientsLoading) return null
    if (!row.ingredientId) return "no encontrado"
    return null
  })

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // The user picked between two type="submit" buttons. The secondary one
    // carries name="force"; the primary doesn't. Read from the native
    // submitter — closure state would lag because React state updates are
    // async relative to the click handler that fires before this runs.
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    const useForce = submitter?.name === "force"
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
    updateRecipe.mutate({ ...parsed.data, force: useForce }, {
      onSuccess: (updated) => {
        router.push(`/recipes/${updated.id}`)
      },
      onError: (err) => {
        if (err instanceof LintFailureError) {
          const next: Record<string, string> = {}
          for (const issue of err.issues) {
            const key = issue.path && issue.path.length > 0 ? issue.path : "_form"
            if (!next[key]) next[key] = issue.message
          }
          setErrors(next)
          setAllowForce(true)
        } else {
          setErrors({ _form: err.message ?? "Error al guardar la receta." })
        }
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

        {/* Hero photo — preview + AI regenerate. Outside the form so the
            generation button doesn't accidentally submit unsaved edits. */}
        {params.id && user?.id ? (
          <PhotoSection recipeId={params.id} userId={user.id} />
        ) : null}

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
                // `ingredientLibrary` is the first 300 catalog rows; recipes
                // can reference ingredients past that window (the global
                // catalog is paginated). When the lookup misses, fall back
                // to showing the denormalized `row.ingredientName` so the
                // user sees what's there instead of an empty input.
                const fallbackText =
                  !selectedIng && row.ingredientName ? row.ingredientName : undefined
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
                        defaultText={fallbackText}
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
                        onClick={() => toggleIngredientOptional(idx)}
                        aria-pressed={row.optional}
                        title={row.optional ? "Quitar marca opcional" : "Marcar como opcional"}
                        className={`rounded-full px-2 py-1 text-[10px] uppercase tracking-[0.1em] transition-colors ${
                          row.optional
                            ? "bg-[#F2EDE0] text-[#7A7066]"
                            : "border border-dashed border-[#DDD6C5] text-[#A39A8E] hover:border-[#1A1612] hover:text-[#1A1612]"
                        }`}
                      >
                        opc
                      </button>
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

          {/* Steps — drag-and-drop reorderable. The grip handle on the left
              of each row drags; the textarea and trash do their own thing. */}
          <section>
            <div className="text-eyebrow text-[#7A7066]">Capitulo 03</div>
            <h2 className="mt-1 font-display text-[1.5rem] leading-tight text-[#1A1612]">
              <span className="font-italic italic">Preparación</span>
            </h2>
            <div className="mt-4">
              <SortableStepsList
                steps={steps}
                onReorder={setSteps}
                onChange={updateStep}
                onRemove={removeStep}
              />
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

          {/* Notes / tips — multi-entry lists. Each list is rendered as a
              stack of textareas with their own +/- controls; on save the
              non-empty entries are joined with a blank line so the
              persisted text column round-trips cleanly. */}
          <section>
            <div className="text-eyebrow text-[#7A7066]">Notas y trucos</div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-6">
              <NotesEditor
                title="Notas"
                placeholder="e.g. la madre la hacía con cebolla pochada"
                addLabel="Añadir nota"
                entries={notes}
                onUpdate={(idx, v) => updateAt(setNotes, notes, idx, v)}
                onAdd={() => addAt(setNotes, notes)}
                onRemove={(idx) => removeAt(setNotes, notes, idx)}
              />
              <NotesEditor
                title="Trucos"
                placeholder="e.g. dejar reposar 5 min antes de servir"
                addLabel="Añadir truco"
                entries={tips}
                onUpdate={(idx, v) => updateAt(setTips, tips, idx, v)}
                onAdd={() => addAt(setTips, tips)}
                onRemove={(idx) => removeAt(setTips, tips, idx)}
              />
            </div>
          </section>

          {/* Submit */}
          <div className="flex flex-col gap-3 border-t border-[#DDD6C5] pt-6">
            {Object.keys(errors).length > 0 && (
              <div className="rounded-lg border border-[#C65D38]/40 bg-[#C65D38]/10 px-4 py-3">
                <p className="text-[12px] font-medium uppercase tracking-[0.12em] text-[#C65D38]">
                  {allowForce ? "Avisos" : "Algo no encaja:"}
                </p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-[12px] italic text-[#C65D38]">
                  {Object.entries(errors).map(([key, msg]) => {
                    const label = humanizeLintKey(key)
                    // The lint validator's own messages already namecheck
                    // "el paso N" / "el ingrediente X" — when that's the case,
                    // hide the prefix to avoid "Paso 1: El paso 1 menciona…".
                    const showLabel = !!label && !msg.toLowerCase().includes(label.toLowerCase())
                    return (
                      <li key={key}>
                        {showLabel ? (
                          <>
                            <span className="font-medium not-italic">{label}:</span> {msg}
                          </>
                        ) : (
                          msg
                        )}
                      </li>
                    )
                  })}
                </ul>
                {allowForce && (
                  <p className="mt-3 text-[12px] italic text-[#7A7066]">
                    Estos avisos no impiden guardar. Corrige y pulsa
                    "Guardar cambios" otra vez, o usa "Guardar igualmente"
                    para aceptarlos tal cual.
                  </p>
                )}
              </div>
            )}
            <div className="flex items-center gap-4">
              <button
                type="submit"
                disabled={!canSubmit || updateRecipe.isPending}
                className="rounded-full bg-[#1A1612] px-6 py-2.5 text-[12px] font-medium uppercase tracking-[0.12em] text-[#FAF6EE] transition-all hover:bg-[#2D6A4F] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {updateRecipe.isPending ? "Guardando…" : "Guardar cambios"}
              </button>
              {allowForce && (
                <button
                  type="submit"
                  name="force"
                  disabled={updateRecipe.isPending}
                  className="rounded-full border border-[#C65D38] bg-transparent px-6 py-2.5 text-[12px] font-medium uppercase tracking-[0.12em] text-[#C65D38] transition-all hover:bg-[#C65D38] hover:text-[#FAF6EE] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {updateRecipe.isPending ? "Guardando…" : "Guardar igualmente"}
                </button>
              )}
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

/* ─────────────────────────────────────────────
   Photo section — preview + "Regenerar imagen"
   Lives outside the <form> so its button can't submit it.
   ───────────────────────────────────────────── */
function PhotoSection({ recipeId, userId }: { recipeId: string; userId: string }) {
  const { data: recipe } = useRecipe(recipeId)
  const { data: profile } = useUser(userId)
  const regen = useRegenerateRecipeImage(recipeId, userId)
  const quota = regen.data?.quota ?? profile?.imageGenQuota
  const exhausted = quota ? quota.used >= quota.limit : false

  const heroSrc = recipe?.imageUrl
    ? `${recipe.imageUrl}${recipe.imageUrl.includes("?") ? "&" : "?"}v=${
        new Date(recipe.updatedAt ?? Date.now()).getTime()
      }`
    : null

  return (
    <section className="mt-10">
      <div className="text-eyebrow text-[#7A7066]">Imagen</div>
      <h2 className="mt-1 font-display text-[1.5rem] leading-tight text-[#1A1612]">
        <span className="font-italic italic">Foto</span> de la receta
      </h2>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
        {heroSrc ? (
          <img
            src={heroSrc}
            alt={recipe?.name ?? ""}
            className="aspect-[4/3] w-full max-w-[260px] rounded-lg object-cover"
          />
        ) : (
          <div className="flex aspect-[4/3] w-full max-w-[260px] items-center justify-center rounded-lg border border-dashed border-[#DDD6C5] bg-[#F2EDE0] text-[12px] uppercase tracking-[0.12em] text-[#7A7066]">
            Sin foto
          </div>
        )}
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => regen.mutate()}
            disabled={regen.isPending || exhausted}
            className="inline-flex items-center gap-2 self-start rounded-full border border-[#DDD6C5] bg-[#F2EDE0] px-5 py-2.5 text-[12px] uppercase tracking-[0.12em] text-[#1A1612] transition-all hover:border-[#1A1612] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Sparkles size={14} />
            {regen.isPending
              ? "Generando…"
              : recipe?.imageUrl
                ? "Regenerar imagen"
                : "Generar imagen"}
          </button>
          {quota && !regen.error ? (
            <span className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
              {quota.used}/{quota.limit} este mes
            </span>
          ) : null}
          {regen.error ? (
            <span className="text-[11px] italic text-[#C65D38]">{regen.error.message}</span>
          ) : null}
          <p className="max-w-xs text-[11px] leading-relaxed text-[#7A7066]">
            La imagen se genera con IA a partir del nombre y los ingredientes.
            Tarda unos segundos.
          </p>
        </div>
      </div>
    </section>
  )
}

/* ─────────────────────────────────────────────
   Multi-entry list editor — used for notes + tips.
   Stack of textareas with per-row trash + "+ Añadir" at the bottom.
   ───────────────────────────────────────────── */
function NotesEditor({
  title,
  placeholder,
  addLabel,
  entries,
  onUpdate,
  onAdd,
  onRemove,
}: {
  title: string
  placeholder: string
  addLabel: string
  entries: string[]
  onUpdate: (idx: number, value: string) => void
  onAdd: () => void
  onRemove: (idx: number) => void
}) {
  return (
    <div>
      <div className="mb-2 text-[11px] uppercase tracking-[0.15em] text-[#7A7066]">{title}</div>
      <div className="space-y-2">
        {entries.map((entry, idx) => (
          <div key={idx} className="flex items-start gap-2">
            <textarea
              value={entry}
              onChange={(e) => onUpdate(idx, e.target.value)}
              placeholder={placeholder}
              rows={2}
              className="flex-1 resize-none rounded-lg border border-[#DDD6C5] bg-[#F2EDE0] px-3 py-2 text-[13px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none focus:ring-1 focus:ring-[#1A1612]"
            />
            <button
              type="button"
              onClick={() => onRemove(idx)}
              className="mt-1 rounded p-1 text-[#7A7066] hover:text-[#C65D38]"
              aria-label={`Quitar ${title.toLowerCase()}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={onAdd}
        className="mt-2 inline-flex items-center gap-1 text-[11px] uppercase tracking-[0.12em] text-[#7A7066] hover:text-[#1A1612]"
      >
        <Plus size={12} />
        {addLabel}
      </button>
    </div>
  )
}
