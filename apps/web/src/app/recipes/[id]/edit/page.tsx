"use client"

import { useEffect, useRef, useState } from "react"
import { useParams, useRouter } from "next/navigation"
import { Sparkles, Trash2, Upload } from "lucide-react"
import { useAuth } from "@/lib/auth"
import {
  useIngredients,
  useRecipe,
  useRegenerateRecipeImage,
  useUpdateRecipe,
  useUploadRecipeImage,
} from "@/hooks/useRecipes"
import { useUser } from "@/hooks/useUser"
import {
  SortableStepsList,
  makeStep,
  type StepDraft,
} from "@/components/recipes/SortableStepsList"
import {
  SortableIngredientsList,
  makeRowId,
} from "@/components/recipes/SortableIngredientsList"
import { ShoppingIssues } from "@/components/recipes/ShoppingIssues"
import { FitChip, cycleFit } from "@/components/recipes/FitChip"
import {
  AddRowButton,
  Field,
  FieldError,
  FORCE_PILL,
  FormCard,
  FormErrors,
  FormHeader,
  ICON_BUTTON,
  IngredientRowFields,
  SaveBar,
  TagList,
  choicePillClass,
  fieldClass,
} from "@/components/recipes/form/RecipeFormUI"
import { LintFailureError } from "@/lib/api"
import { createRecipeSchema, COURSES, COURSE_LABELS } from "@ona/shared"
import type { Course, Difficulty, Ingredient, Meal, Season } from "@ona/shared"
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
  /** Stable client-side id used by the sortable list. Stripped from the
   *  payload at submit time. */
  rowId: string
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
  return {
    rowId: makeRowId(),
    ingredientName: "",
    ingredientId: "",
    quantity: "",
    unit: "g",
    optional: false,
  }
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
  // Optional source URL — set automatically when the recipe is imported via
  // /recipes/extract-from-url, manually editable later for any recipe.
  const [sourceUrl, setSourceUrl] = useState<string>("")
  // Three-state fit per meal/season. The chip cycles through none → mid →
  // perfect → none; the matcher excludes 'none' and pool-weights mid/perfect
  // at 1×/3×. Stored as `Partial<Record<…>>` so absence implicitly means
  // 'none' and we don't have to maintain a parallel "selected" array.
  const [mealFit, setMealFit] = useState<Partial<Record<Meal, "mid" | "perfect">>>({})
  const [seasonFit, setSeasonFit] = useState<Partial<Record<Season, "mid" | "perfect">>>({})
  // Frequency hint for the menu matcher. `null` = the "normal" default
  // (matched against `recipes.frequency = NULL` in the DB).
  const [frequency, setFrequency] = useState<
    "frequent" | "normal" | "occasional" | "weekends_only" | null
  >(null)
  const [course, setCourse] = useState<Course | "">("")
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [ingredientRows, setIngredientRows] = useState<IngredientRow[]>([emptyRow()])
  // Steps carry a stable client-side id so the drag-and-drop list can
  // reorder them without losing focus or remounting textareas. The id is
  // form-local: the server still receives `{ index, text }`.
  const [steps, setSteps] = useState<StepDraft[]>([makeStep()])
  // Notes (a.k.a. tips — unified in the UI to a single multi-entry list).
  // On load we merge any pre-existing `tips` content into the notes list
  // so users who authored recipes under the split UI keep all their
  // entries. On save the joined blob goes into `recipes.notes`; `tips`
  // is cleared so the column drains over time without a migration.
  const [notes, setNotes] = useState<string[]>([""])

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
    setSourceUrl(recipe.sourceUrl ?? "")
    setDifficulty(recipe.difficulty ?? "medium")
    // Seed fit maps. Prefer the explicit `mealFit` / `seasonFit` payloads
    // when present (recipes saved after migration 0024); fall back to
    // deriving 'perfect' for every entry in the legacy arrays so existing
    // recipes don't suddenly look "neutral" in the edit form.
    setMealFit(
      recipe.mealFit ??
        Object.fromEntries((recipe.meals ?? []).map((m) => [m, "perfect" as const])),
    )
    setSeasonFit(
      recipe.seasonFit ??
        Object.fromEntries((recipe.seasons ?? []).map((s) => [s, "perfect" as const])),
    )
    setFrequency(recipe.frequency ?? null)
    setCourse(recipe.course ?? "")
    setTags(recipe.tags ?? [])
    // Round-trip the persisted blob(s) through split-on-blank-line so a
    // recipe authored before the unified UI still renders one row per
    // existing paragraph — and the legacy `tips` content gets folded in
    // beneath the notes ones so nothing is silently dropped.
    const splitParas = (raw: string | null | undefined): string[] => {
      if (!raw) return []
      return raw.split(/\n{2,}/).map((p) => p.trim()).filter((p) => p.length > 0)
    }
    const merged = [...splitParas(recipe.notes), ...splitParas(recipe.tips)]
    setNotes(merged.length > 0 ? merged : [""])
    setIngredientRows(
      recipe.ingredients.length > 0
        ? recipe.ingredients.map((ri) => ({
            rowId: makeRowId(),
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
    cycleFit(mealFit, setMealFit, m)
  }
  function toggleSeason(s: Season) {
    cycleFit(seasonFit, setSeasonFit, s)
  }

  function addTag() {
    const t = tagInput.trim()
    if (t && !tags.includes(t)) setTags([...tags, t])
    setTagInput("")
  }
  function removeTag(t: string) {
    setTags(tags.filter((x) => x !== t))
  }

  // All ingredient mutations key by `rowId` now that the rows are
  // sortable. Reordering invalidates positional indices, so functions that
  // used `idx` would target the wrong row mid-drag.
  function setRowIngredient(rowId: string, ing: Ingredient) {
    setIngredientRows((prev) =>
      prev.map((r) =>
        r.rowId === rowId ? { ...r, ingredientName: ing.name, ingredientId: ing.id } : r,
      ),
    )
  }
  function updateIngredientQuantity(rowId: string, value: string) {
    setIngredientRows((prev) =>
      prev.map((r) =>
        r.rowId === rowId
          ? { ...r, quantity: value === "" ? "" : Number(value) }
          : r,
      ),
    )
  }
  function updateIngredientUnit(rowId: string, value: string) {
    setIngredientRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, unit: value } : r)),
    )
  }
  function toggleIngredientOptional(rowId: string) {
    setIngredientRows((prev) =>
      prev.map((r) => (r.rowId === rowId ? { ...r, optional: !r.optional } : r)),
    )
  }
  function addIngredientRow() {
    setIngredientRows((prev) => [...prev, emptyRow()])
  }
  function removeIngredientRow(rowId: string) {
    setIngredientRows((prev) => {
      if (prev.length <= 1) return prev
      return prev.filter((r) => r.rowId !== rowId)
    })
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
      // Derive the legacy on/off arrays from the fit map so the public
      // catalogue and other unchanged consumers stay consistent.
      meals: (Object.keys(mealFit) as Meal[]),
      seasons: (Object.keys(seasonFit) as Season[]),
      mealFit,
      seasonFit,
      frequency,
      course: course || null,
      tags,
      ingredients: cleanedIngredients,
      steps: cleanedSteps,
    }
    if (typeof prepTime === "number" && prepTime > 0) payload.prepTime = prepTime
    if (typeof cookTime === "number" && cookTime > 0) payload.cookTime = cookTime
    // Source URL is optional. Trim + omit when empty so the schema's
    // `z.string().url()` validator doesn't reject empty strings.
    const trimmedUrl = sourceUrl.trim()
    if (trimmedUrl.length > 0) {
      payload.sourceUrl = trimmedUrl
      // sourceType defaults to whatever the source already had; if the user
      // attaches a URL to a previously-manual recipe, mark it accordingly.
      if (!recipe?.sourceType) {
        payload.sourceType = /youtube\.com|youtu\.be/.test(trimmedUrl)
          ? "youtube"
          : "article"
      }
    } else {
      payload.sourceUrl = null
    }
    const notesText = notes
      .map((e) => e.trim())
      .filter((e) => e.length > 0)
      .join("\n\n")
    // The schema is `z.string().optional()` — undefined means "no change /
    // not set", null is rejected. We use empty string as the explicit
    // "clear this column" signal; the backend treats empty strings as null
    // when persisting (see persistence helper).
    payload.notes = notesText
    // Always clear the legacy `tips` column so the split never re-emerges
    // for users who authored before the unification.
    payload.tips = ""

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
      <div className="min-h-screen bg-cream px-5 pt-12 text-[14px] text-ink-muted">
        Cargando receta…
      </div>
    )
  }

  if (recipeError) {
    return (
      <div className="min-h-screen bg-cream px-5 pt-12 text-[14px] text-terracotta-deep">
        No se pudo cargar la receta.
      </div>
    )
  }

  const canSubmit =
    name.trim().length > 0 &&
    servings > 0 &&
    Object.keys(mealFit).length > 0 &&
    Object.keys(seasonFit).length > 0 &&
    ingredientRows.some(
      (r) =>
        r.ingredientName.trim() !== "" &&
        r.ingredientId !== "" &&
        typeof r.quantity === "number" &&
        r.quantity > 0
    )

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-[1180px] px-4 pb-10 pt-4 sm:px-5 lg:px-8 lg:pt-8">
        <FormHeader
          backHref={`/recipes/${params.id}`}
          backLabel="Volver a la receta"
          eyebrow="Editor"
          title="Editar"
          accent="receta"
          intro={
            <>
              Cambia lo que quieras y guarda. Los ingredientes deben estar
              enlazados a la biblioteca para calcular nutrientes.
            </>
          }
        />

        <form onSubmit={handleSubmit} className="mt-6 lg:mt-8" noValidate>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start lg:gap-6">
            {/* Left column — photo and the recipe's data. */}
            <div className="min-w-0 space-y-4 lg:space-y-6">
              {/* Hero photo — preview + AI regenerate + upload. Its buttons
                  are type="button" and the file input has no name, so it
                  never submits (or adds to) the form. */}
              {params.id && user?.id ? (
                <PhotoSection recipeId={params.id} userId={user.id} />
              ) : null}

              <FormCard title="Datos">
                <div className="space-y-5">
                  <Field label="Nombre" htmlFor="recipe-name" error={errors.name}>
                    <input
                      id="recipe-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className={fieldClass(!!errors.name)}
                      required
                    />
                  </Field>

                  <Field label="Tiempos y comensales">
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <label htmlFor="recipe-servings" className="text-[12px] text-ink-muted">
                          Comensales
                        </label>
                        <input
                          id="recipe-servings"
                          type="number"
                          value={servings}
                          onChange={(e) => setServings(Math.max(1, Number(e.target.value) || 1))}
                          min={1}
                          className={fieldClass(false, "mt-1 font-mono")}
                        />
                      </div>
                      <div>
                        <label htmlFor="recipe-prep" className="text-[12px] text-ink-muted">
                          Prep (min)
                        </label>
                        <input
                          id="recipe-prep"
                          type="number"
                          value={prepTime}
                          onChange={(e) =>
                            setPrepTime(e.target.value ? Number(e.target.value) : "")
                          }
                          min={0}
                          className={fieldClass(false, "mt-1 font-mono")}
                        />
                      </div>
                      <div>
                        <label htmlFor="recipe-cook" className="text-[12px] text-ink-muted">
                          Cocción (min)
                        </label>
                        <input
                          id="recipe-cook"
                          type="number"
                          value={cookTime}
                          onChange={(e) =>
                            setCookTime(e.target.value ? Number(e.target.value) : "")
                          }
                          min={0}
                          className={fieldClass(false, "mt-1 font-mono")}
                        />
                      </div>
                    </div>
                  </Field>

                  <Field
                    label="Enlace a la fuente (vídeo o artículo)"
                    htmlFor="recipe-source"
                  >
                    <input
                      id="recipe-source"
                      type="url"
                      value={sourceUrl}
                      onChange={(e) => setSourceUrl(e.target.value)}
                      placeholder="https://…"
                      className={fieldClass()}
                    />
                    <p className="mt-1.5 text-[13px] leading-snug text-ink-muted">
                      Si importaste la receta desde una URL, ya viene rellenada.
                      También puedes añadirla manualmente — aparecerá un botón
                      &quot;Ver fuente&quot; en la receta.
                    </p>
                  </Field>

                  <Field label="Dificultad">
                    <div className="flex flex-wrap gap-2">
                      {DIFFICULTY_OPTIONS.map((opt) => {
                        const active = difficulty === opt.value
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => setDifficulty(opt.value)}
                            aria-pressed={active}
                            className={choicePillClass(active)}
                          >
                            {opt.label}
                          </button>
                        )
                      })}
                    </div>
                  </Field>

                  <Field label="Tipo de plato" htmlFor="recipe-course">
                    <select
                      id="recipe-course"
                      value={course}
                      onChange={(e) => setCourse(e.target.value as Course | "")}
                      className={fieldClass()}
                    >
                      <option value="">Sin clasificar (auto)</option>
                      {COURSES.map((c) => (
                        <option key={c} value={c}>
                          {COURSE_LABELS[c]}
                        </option>
                      ))}
                    </select>
                  </Field>

                  <Field label="Etiquetas" htmlFor="recipe-tags">
                    <input
                      id="recipe-tags"
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
                      className={fieldClass()}
                    />
                    <TagList tags={tags} onRemove={removeTag} />
                  </Field>
                </div>
              </FormCard>

              {/* Planificación — scheduling frequency hint consumed by the
                  menu matcher ("Normal" = null, 1× weight; the other three
                  are mutually exclusive), plus the meal / season fit. */}
              <FormCard
                title="Planificación"
                description="Cuánto debería proponer este plato el planificador automático cuando regenera tu menú."
              >
                <div className="space-y-5">
                  <div className="flex flex-wrap gap-2">
                    {([
                      { value: null, label: "Normal", subtitle: "Por defecto" },
                      { value: "frequent" as const, label: "Frecuente", subtitle: "Peso 2×" },
                      { value: "occasional" as const, label: "Ocasional", subtitle: "Peso 0.4×" },
                      { value: "weekends_only" as const, label: "Solo finde", subtitle: "Sólo S/D" },
                    ] as const).map((opt) => {
                      const active = (frequency ?? null) === opt.value
                      return (
                        <button
                          key={String(opt.value)}
                          type="button"
                          onClick={() => setFrequency(opt.value)}
                          aria-pressed={active}
                          title={opt.subtitle}
                          className={choicePillClass(active)}
                        >
                          {opt.label}
                        </button>
                      )
                    })}
                  </div>

                  {/* Meals — three-state fit chip cycles none → mid → perfect. */}
                  <Field
                    label="Tipo de comida"
                    hint='Pulsa: vacío → encaja a veces → encaja perfectamente. El menú prioriza los "perfecto" frente a los "a veces".'
                    error={errors.meals}
                  >
                    <div className="flex flex-wrap gap-2">
                      {MEAL_OPTIONS.map((opt) => (
                        <FitChip
                          key={opt.value}
                          label={opt.label}
                          fit={mealFit[opt.value]}
                          onClick={() => toggleMeal(opt.value)}
                        />
                      ))}
                    </div>
                  </Field>

                  <Field label="Temporada" error={errors.seasons}>
                    <div className="flex flex-wrap gap-2">
                      {SEASON_OPTIONS.map((opt) => (
                        <FitChip
                          key={opt.value}
                          label={opt.label}
                          fit={seasonFit[opt.value]}
                          onClick={() => toggleSeason(opt.value)}
                        />
                      ))}
                    </div>
                  </Field>
                </div>
              </FormCard>
            </div>

            {/* Right column — ingredients, steps and notes. */}
            <div className="min-w-0 space-y-4 lg:space-y-6">
              <FormCard title="Ingredientes">
                {/* What the last saved version still lacks for the shopping
                    list (shared with the detail page, which gives it mt-8). */}
                <div className="[&>section]:mb-4 [&>section]:mt-0">
                  <ShoppingIssues issues={recipe?.shoppingIssues} />
                </div>
                <SortableIngredientsList
                  rows={ingredientRows}
                  onReorder={setIngredientRows}
                  renderRow={(row) => {
                    const idx = ingredientRows.findIndex((r) => r.rowId === row.rowId)
                    const hint = ingredientRowHints[idx]
                    const selectedIng = row.ingredientId
                      ? ingredientLibrary.find((ing) => ing.id === row.ingredientId) ?? null
                      : null
                    const fallbackText =
                      !selectedIng && row.ingredientName ? row.ingredientName : undefined
                    return (
                      <IngredientRowFields
                        selected={selectedIng}
                        onSelect={(ing) => setRowIngredient(row.rowId, ing)}
                        placeholder={
                          ingredientsLoading ? "Cargando biblioteca…" : "Ingrediente"
                        }
                        hasError={!!hint}
                        defaultText={fallbackText}
                        quantity={row.quantity}
                        onQuantity={(v) => updateIngredientQuantity(row.rowId, v)}
                        unit={row.unit}
                        units={UNIT_OPTIONS}
                        onUnit={(v) => updateIngredientUnit(row.rowId, v)}
                        optional={row.optional}
                        onToggleOptional={() => toggleIngredientOptional(row.rowId)}
                        onRemove={() => removeIngredientRow(row.rowId)}
                        removable={ingredientRows.length > 1}
                        hint={hint}
                      />
                    )
                  }}
                />
                <AddRowButton onClick={addIngredientRow}>Añadir ingrediente</AddRowButton>
                <FieldError>{errors.ingredients}</FieldError>
              </FormCard>

              {/* Steps — drag-and-drop reorderable. The grip handle on the
                  left of each row drags; the textarea and trash do their own
                  thing. */}
              <FormCard title="Preparación">
                <SortableStepsList
                  steps={steps}
                  onReorder={setSteps}
                  onChange={updateStep}
                  onRemove={removeStep}
                />
                <AddRowButton onClick={addStep}>Añadir paso</AddRowButton>
              </FormCard>

              {/* Notes — unified list ("notas y trucos" used to be two boxes;
                  users don't actually separate the two so we merged them into
                  a single stack). Persists into `recipes.notes`; `recipes.tips`
                  is cleared on save. */}
              <FormCard title="Notas">
                <NotesEditor
                  title=""
                  placeholder="e.g. la madre la hacía con cebolla pochada — o cualquier truco"
                  addLabel="Añadir nota"
                  entries={notes}
                  onUpdate={(idx, v) => updateAt(setNotes, notes, idx, v)}
                  onAdd={() => addAt(setNotes, notes)}
                  onRemove={(idx) => removeAt(setNotes, notes, idx)}
                />
              </FormCard>
            </div>
          </div>

          {/* Submit: error summary (+ "Guardar igualmente" after lint
              warnings) and the sticky ink pill. */}
          {/* The bar must be a direct child of the form: a sticky element
              only sticks inside its parent's box. */}
          <div className="mt-6">
            <FormErrors
              errors={errors}
              title={allowForce ? "Avisos" : "Algo no encaja:"}
              footnote={
                allowForce
                  ? 'Estos avisos no impiden guardar. Corrige y pulsa "Guardar cambios" otra vez, o usa "Guardar igualmente" para aceptarlos tal cual.'
                  : undefined
              }
            >
              {allowForce && (
                <button
                  type="submit"
                  name="force"
                  disabled={updateRecipe.isPending}
                  className={FORCE_PILL}
                >
                  {updateRecipe.isPending ? "Guardando…" : "Guardar igualmente"}
                </button>
              )}
            </FormErrors>
          </div>
          <SaveBar
            submitLabel={updateRecipe.isPending ? "Guardando…" : "Guardar cambios"}
            disabled={!canSubmit || updateRecipe.isPending}
            cancelHref={`/recipes/${params.id}`}
          />
        </form>
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────────
   Photo section — preview + "Regenerar imagen" + "Subir foto"
   Its buttons are type="button", so it never submits the form.
   ───────────────────────────────────────────── */
function PhotoSection({ recipeId, userId }: { recipeId: string; userId: string }) {
  const { data: recipe } = useRecipe(recipeId)
  const { data: profile } = useUser(userId)
  const regen = useRegenerateRecipeImage(recipeId, userId)
  const upload = useUploadRecipeImage(recipeId)
  const quota = regen.data?.quota ?? profile?.imageGenQuota
  const exhausted = quota ? quota.used >= quota.limit : false
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Same own-host cache-bust rule the detail page now follows: external
  // URLs (i.ytimg, og:image hosts that hot-link-block unknown params) must
  // not have a `?v=` appended or they return a placeholder.
  const isOwnImage = recipe?.imageUrl?.includes("ona-api") ?? false
  const heroSrc = recipe?.imageUrl
    ? isOwnImage
      ? `${recipe.imageUrl}${recipe.imageUrl.includes("?") ? "&" : "?"}v=${
          new Date(recipe.updatedAt ?? Date.now()).getTime()
        }`
      : recipe.imageUrl
    : null

  function handleFilePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) upload.mutate(file)
    // Reset so picking the same file twice still triggers onChange.
    e.target.value = ""
  }

  return (
    <FormCard
      title={
        <>
          <span className="font-medium italic text-terracotta-deep">Foto</span> de la receta
        </>
      }
    >
      {heroSrc ? (
        <img
          src={heroSrc}
          alt={recipe?.name ?? ""}
          className="aspect-[4/3] w-full rounded-2xl bg-bone object-cover"
        />
      ) : (
        <div className="flex aspect-[4/3] w-full items-center justify-center rounded-2xl border border-dashed border-border bg-bone text-[12px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
          Sin foto
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => regen.mutate()}
          disabled={regen.isPending || upload.isPending || exhausted}
          className={PHOTO_PILL}
        >
          <Sparkles size={15} aria-hidden />
          {regen.isPending
            ? "Generando…"
            : recipe?.imageUrl
              ? "Regenerar imagen"
              : "Generar imagen"}
        </button>
        {/* Manual upload — available to authors on their own recipes and
            to admins on any recipe (the API enforces it, the UI just
            presents the affordance). Doesn't consume the AI quota. */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFilePick}
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={upload.isPending || regen.isPending}
          className={PHOTO_PILL}
        >
          <Upload size={15} aria-hidden />
          {upload.isPending ? "Subiendo…" : "Subir foto"}
        </button>
      </div>
      <div className="mt-3 flex flex-col gap-1.5">
        {quota && !regen.error ? (
          <span className="font-mono text-[12px] text-ink-muted">
            {quota.used}/{quota.limit} este mes (IA)
          </span>
        ) : null}
        {regen.error ? (
          <span className="text-[13px] italic text-terracotta-deep">{regen.error.message}</span>
        ) : null}
        {upload.error ? (
          <span className="text-[13px] italic text-terracotta-deep">{upload.error.message}</span>
        ) : null}
        <p className="text-[13px] leading-snug text-ink-muted">
          Genera con IA a partir del nombre y los ingredientes, o sube tu
          propia foto (JPG / PNG / WebP, hasta 10 MB).
        </p>
      </div>
    </FormCard>
  )
}

const PHOTO_PILL =
  "inline-flex h-11 items-center gap-2 rounded-full border border-border bg-paper px-4 text-[14px] text-ink transition-colors hover:border-ink active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"

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
      {title && <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">{title}</div>}
      <div className="space-y-2">
        {entries.map((entry, idx) => (
          <div key={idx} className="flex items-start gap-1">
            <textarea
              value={entry}
              onChange={(e) => onUpdate(idx, e.target.value)}
              placeholder={placeholder}
              rows={2}
              className="min-h-[88px] min-w-0 flex-1 resize-y rounded-xl border border-border-soft bg-paper px-3.5 py-2.5 text-[16px] leading-relaxed text-ink placeholder:text-ink-light focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink lg:text-[15px]"
            />
            <button
              type="button"
              onClick={() => onRemove(idx)}
              className={ICON_BUTTON}
              aria-label={`Quitar ${title.toLowerCase()}`}
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
      </div>
      <AddRowButton onClick={onAdd}>{addLabel}</AddRowButton>
    </div>
  )
}
