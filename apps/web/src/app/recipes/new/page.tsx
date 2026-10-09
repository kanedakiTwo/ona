"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/lib/auth"
import { useCreateRecipe, useIngredients } from "@/hooks/useRecipes"
import { LintFailureError } from "@/lib/api"
import { PhotoRecipeUpload } from "@/components/recipes/PhotoRecipeUpload"
import { UrlRecipeImport } from "@/components/recipes/UrlRecipeImport"
import {
  SortableStepsList,
  makeStep,
  type StepDraft,
} from "@/components/recipes/SortableStepsList"
import {
  SortableIngredientsList,
  makeRowId,
} from "@/components/recipes/SortableIngredientsList"
import { FitChip, cycleFit } from "@/components/recipes/FitChip"
import {
  AddRowButton,
  Field,
  FieldError,
  FORCE_PILL,
  FormCard,
  FormErrors,
  FormHeader,
  IngredientRowFields,
  SaveBar,
  TagList,
  choicePillClass,
  fieldClass,
} from "@/components/recipes/form/RecipeFormUI"
import { buildRecipePayload, createRecipeSchema, COURSES, COURSE_LABELS } from "@ona/shared"
import type { Course, Meal, Season, ExtractedRecipe, Ingredient } from "@ona/shared"
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

const UNIT_OPTIONS = ["g", "kg", "ml", "l", "ud", "cda", "cdta"]

interface IngredientRow {
  /** Stable client-side id used by the sortable list. Stripped from the
   *  payload at submit time. */
  rowId: string
  // What the user typed; we resolve against the library to populate ingredientId.
  ingredientName: string
  ingredientId: string
  quantity: number | ""
  unit: string
  /** When true, the ingredient renders with an "opcional" badge on the
   *  detail view and the shopping aggregator skips it. */
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

export default function NewRecipePage() {
  // Next.js 15 requires `useSearchParams()` to be wrapped in <Suspense>
  // because it bails out of static prerendering. We split the page in
  // two so the bail-out is scoped to the part that actually reads the
  // `?name=` query param.
  return (
    <Suspense fallback={null}>
      <NewRecipePageInner />
    </Suspense>
  )
}

function NewRecipePageInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  useAuth()
  const createRecipe = useCreateRecipe()
  const { data: ingredientLibrary = [], isLoading: ingredientsLoading } =
    useIngredients()

  // `/recipes/new?name=tarta+de+zanahoria` pre-fills the name field — used by
  // the menu swap picker's empty state so a user who searched "tarta" and
  // got no hits can keep their typed term when they bounce to this form.
  const [name, setName] = useState(() => searchParams.get("name") ?? "")
  const [servings, setServings] = useState<number | "">(2)
  const [prepTime, setPrepTime] = useState<number | "">("")
  // Three-state fit per meal/season (none → mid → perfect → none). See
  // `FitChip` for the visual + the matcher in apps/api for how this maps
  // to selection weights (mid = 1×, perfect = 3×).
  const [mealFit, setMealFit] = useState<Partial<Record<Meal, "mid" | "perfect">>>({})
  const [seasonFit, setSeasonFit] = useState<Partial<Record<Season, "mid" | "perfect">>>({})
  const [frequency, setFrequency] = useState<
    "frequent" | "normal" | "occasional" | "weekends_only" | null
  >(null)
  const [course, setCourse] = useState<Course | "">("")
  const [tags, setTags] = useState<string[]>([])
  const [tagInput, setTagInput] = useState("")
  const [ingredientRows, setIngredientRows] = useState<IngredientRow[]>([
    emptyRow(),
  ])
  // Steps carry a stable client-side id so the drag-and-drop list can
  // reorder them without losing focus or remounting textareas. The id is
  // form-local: the server still receives `{ index, text }`.
  const [steps, setSteps] = useState<StepDraft[]>([makeStep()])
  const [photoExtracted, setPhotoExtracted] = useState(false)

  // Per-field validation errors surfaced after a submit attempt.
  const [errors, setErrors] = useState<Record<string, string>>({})
  // Set to true after the server rejects with lint errors. The next click
  // re-submits with ?force=1 so the user can save the recipe anyway.
  const [allowForce, setAllowForce] = useState(false)

  function handlePhotoExtracted(data: ExtractedRecipe) {
    setName(data.name)
    if (data.servings > 0) {
      setServings(data.servings)
    }
    // TODO(units PR 3): wire data.servingsConfidence into form state + show
    // the "Estimado" badge per spec section "Servings deduction → UI".
    setPrepTime(data.prepTime ?? "")
    // Extractor output is on/off — seed every tagged entry as 'perfect'
    // and let the user dial back to 'mid' before saving if needed.
    setMealFit(
      Object.fromEntries(data.meals.map((m) => [m, "perfect" as const])),
    )
    setSeasonFit(
      Object.fromEntries(data.seasons.map((s) => [s, "perfect" as const])),
    )
    setTags(data.tags)
    setSteps(
      data.steps.length > 0 ? data.steps.map((t) => makeStep(t)) : [makeStep()],
    )
    setIngredientRows(
      data.ingredients.length > 0
        ? data.ingredients.map((ing) => ({
            rowId: makeRowId(),
            ingredientId: ing.ingredientId ?? "",
            ingredientName: ing.ingredientName ?? ing.extractedName,
            quantity: ing.quantity,
            unit: ing.unit || "g",
            optional: false,
          }))
        : [emptyRow()]
    )
    setPhotoExtracted(true)
  }

  function toggleMeal(meal: Meal) {
    cycleFit(mealFit, setMealFit, meal)
  }

  function toggleSeason(season: Season) {
    cycleFit(seasonFit, setSeasonFit, season)
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

  // Key all ingredient mutations by `rowId` so reordering doesn't break
  // positional indices mid-drag. Same shape as the edit page.
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

  function updateStep(id: string, value: string) {
    setSteps((prev) => prev.map((s) => (s.id === id ? { ...s, text: value } : s)))
  }

  function addStep() {
    setSteps((prev) => [...prev, makeStep()])
  }

  function removeStep(id: string) {
    setSteps((prev) => {
      if (prev.length <= 1) return [makeStep()]
      return prev.filter((s) => s.id !== id)
    })
  }

  // Build the schema-shaped payload from form state. Lives in @ona/shared so
  // the contract test in apps/api can validate this exact transformer against
  // createRecipeSchema and prevent silent drift.
  function buildPayload() {
    const base = buildRecipePayload({
      name,
      servings,
      prepTime,
      // The legacy on/off arrays come from the fit map (any entry with a
      // non-none state is "selected"); the shared payload builder treats
      // them the same as before.
      selectedMeals: Object.keys(mealFit) as Meal[],
      selectedSeasons: Object.keys(seasonFit) as Season[],
      tags,
      // The form holds steps as `{ id, text }[]` for drag-and-drop key
      // stability; the payload builder only consumes the text array.
      steps: steps.map((s) => s.text),
      ingredientRows,
    })
    return { ...base, mealFit, seasonFit, frequency, course: course || null }
  }

  // Surface inline errors per row (e.g. "no encontrado") regardless of submit.
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
    // carries name="force"; the primary doesn't. Read that from the native
    // submitter — relying on closure state (allowForce) would be stale
    // because state updates are async vs the click handler that fires
    // before this runs.
    const submitter = (e.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null
    const useForce = submitter?.name === "force"
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

    createRecipe.mutate({ ...parsed.data, force: useForce }, {
      onSuccess: (created) => {
        // Land on the edit screen — the user just wrote/imported the recipe,
        // they want to fine-tune ingredients/steps without an extra "Editar"
        // click. The detail view is one tap away from there.
        router.push(`/recipes/${created.id}/edit`)
      },
      onError: (err) => {
        // If the server returned a typed lint failure, route each issue to
        // the field that produced it AND surface a secondary "Guardar
        // igualmente" path — these are advisory, not hard blockers.
        if (err instanceof LintFailureError) {
          const next: Record<string, string> = {}
          for (const issue of err.issues) {
            const key = issue.path && issue.path.length > 0 ? issue.path : "_form"
            if (!next[key]) next[key] = issue.message
          }
          setErrors(next)
          setAllowForce(true)
        } else {
          setErrors({ _form: err.message ?? "Error al crear la receta." })
        }
      },
    })
  }

  return (
    <div className="min-h-screen bg-cream">
      <div className="mx-auto max-w-[1180px] px-4 pb-10 pt-4 sm:px-5 lg:px-8 lg:pt-8">
        <FormHeader
          backHref="/recipes"
          backLabel="Volver al catalogo"
          eyebrow="Nueva entrada"
          title="Una nueva"
          accent="receta"
          intro={
            <>
              Completa los detalles esenciales. Los ingredientes se enlazan con la
              biblioteca de Mimoia para calcular nutrientes y temporada.
            </>
          }
        />

        {/* Import: photo extraction + URL (article or YouTube). Two paper
            cards, side by side at lg+. */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:mt-8 lg:grid-cols-2 lg:gap-6">
          <PhotoRecipeUpload onExtracted={handlePhotoExtracted} />
          <UrlRecipeImport
            onImported={(recipeId) => router.push(`/recipes/${recipeId}/edit`)}
          />
        </div>

        {photoExtracted && (
          <div className="mt-4 rounded-2xl border border-border-soft bg-cream-deep px-4 py-3 text-[14px] text-ink">
            Receta extraida de la foto. Revisa los datos y ajusta lo que sea
            necesario antes de guardar.
          </div>
        )}

        <div className="mt-6 flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
          <span className="h-px flex-1 bg-border" />
          o introduce los datos manualmente
          <span className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={handleSubmit} className="mt-6" noValidate>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start lg:gap-6">
            {/* Left column — the recipe's data. */}
            <div className="min-w-0 space-y-4 lg:space-y-6">
              <FormCard title="Datos">
                <div className="space-y-5">
                  <Field label="Nombre" htmlFor="recipe-name" error={errors.name}>
                    <input
                      id="recipe-name"
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Ej: Tortilla de patatas"
                      className={fieldClass(!!errors.name)}
                      required
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Comensales" htmlFor="recipe-servings" error={errors.servings}>
                      <div className="flex items-center gap-2">
                        <input
                          id="recipe-servings"
                          type="number"
                          value={servings}
                          onChange={(e) =>
                            setServings(e.target.value ? Number(e.target.value) : "")
                          }
                          placeholder="2"
                          min={1}
                          className={fieldClass(false, "w-20 font-mono")}
                        />
                        <span className="text-[13px] text-ink-muted">personas</span>
                      </div>
                    </Field>
                    <Field
                      label="Tiempo de preparacion"
                      htmlFor="recipe-prep"
                      error={errors.prepTime}
                    >
                      <div className="flex items-center gap-2">
                        <input
                          id="recipe-prep"
                          type="number"
                          value={prepTime}
                          onChange={(e) =>
                            setPrepTime(e.target.value ? Number(e.target.value) : "")
                          }
                          placeholder="30"
                          min={1}
                          className={fieldClass(false, "w-20 font-mono")}
                        />
                        <span className="text-[13px] text-ink-muted">minutos</span>
                      </div>
                    </Field>
                  </div>

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
                      placeholder="Escribe y pulsa Enter..."
                      className={fieldClass()}
                    />
                    <TagList tags={tags} onRemove={removeTag} />
                  </Field>
                </div>
              </FormCard>

              <FormCard
                title="Planificación"
                description="Cuánto debería proponer este plato el planificador cuando regenera el menú."
              >
                <div className="space-y-5">
                  {/* Frequency: Normal (default) = peso 1×; el resto modifican
                      el peso del pool o filtran el día. */}
                  <div className="flex flex-wrap gap-2">
                    {([
                      { value: null, label: "Normal" },
                      { value: "frequent" as const, label: "Frecuente" },
                      { value: "occasional" as const, label: "Ocasional" },
                      { value: "weekends_only" as const, label: "Solo finde" },
                    ] as const).map((opt) => {
                      const active = (frequency ?? null) === opt.value
                      return (
                        <button
                          key={String(opt.value)}
                          type="button"
                          onClick={() => setFrequency(opt.value)}
                          aria-pressed={active}
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
                    hint="Toca: vacío → encaja a veces → encaja perfecto. Al menos una en cualquier estado distinto a vacío."
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

                  <Field
                    label="Temporada"
                    hint="Marca al menos una con el grado de encaje"
                    error={errors.seasons}
                  >
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

            {/* Right column — ingredients and steps. */}
            <div className="min-w-0 space-y-4 lg:space-y-6">
              <FormCard
                title="Ingredientes"
                description="Cada ingrediente se asocia a la biblioteca de Mimoia. Empieza a escribir y selecciona uno de la lista."
              >
                <SortableIngredientsList
                  rows={ingredientRows}
                  onReorder={setIngredientRows}
                  renderRow={(row) => {
                    const idx = ingredientRows.findIndex((r) => r.rowId === row.rowId)
                    const localHint = ingredientRowHints[idx]
                    const serverHint = Object.entries(errors).find(
                      ([k]) =>
                        k === `ingredients[${idx}]` ||
                        k.startsWith(`ingredients[${idx}].`),
                    )?.[1]
                    const hint = localHint ?? serverHint
                    const selectedIng = row.ingredientId
                      ? ingredientLibrary.find((ing) => ing.id === row.ingredientId) ?? null
                      : null
                    return (
                      <IngredientRowFields
                        selected={selectedIng}
                        onSelect={(ing) => setRowIngredient(row.rowId, ing)}
                        placeholder={
                          ingredientsLoading ? "Cargando biblioteca..." : "Ingrediente"
                        }
                        hasError={!!hint}
                        defaultText={row.ingredientName}
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
                <AddRowButton onClick={addIngredientRow}>Anadir ingrediente</AddRowButton>
                <FieldError>{errors.ingredients}</FieldError>
              </FormCard>

              <FormCard title="Preparacion">
                <SortableStepsList
                  steps={steps}
                  onReorder={setSteps}
                  onChange={updateStep}
                  onRemove={removeStep}
                  errorAt={(idx) =>
                    // Lint paths from the server: "steps[3].text" or "steps[3]".
                    Object.entries(errors).find(
                      ([k]) =>
                        k === `steps[${idx}]` || k.startsWith(`steps[${idx}].`),
                    )?.[1] ?? null
                  }
                />
                <AddRowButton onClick={addStep}>Anadir paso</AddRowButton>
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
              title={allowForce ? "Avisos" : "Faltan datos:"}
              footnote={
                allowForce
                  ? 'Estos avisos no impiden guardar. Corrige y pulsa "Crear receta" otra vez, o usa "Guardar igualmente" para aceptarlos tal cual.'
                  : undefined
              }
            >
              {allowForce && (
                <button
                  type="submit"
                  name="force"
                  disabled={createRecipe.isPending}
                  className={FORCE_PILL}
                >
                  {createRecipe.isPending ? "Guardando..." : "Guardar igualmente"}
                </button>
              )}
            </FormErrors>
          </div>
          <SaveBar
            submitLabel={createRecipe.isPending ? "Guardando..." : "Crear receta"}
            disabled={createRecipe.isPending}
            cancelHref="/recipes"
          />
        </form>
      </div>
    </div>
  )
}
