"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useAuth } from "@/lib/auth"
import { uploadRecipeImage, useCreateRecipe } from "@/hooks/useRecipes"
import { useIngredientLines } from "@/hooks/useIngredientLines"
import { NewRecipePhotoCard } from "@/components/recipes/form/NewRecipePhotoCard"
import { LintFailureError } from "@/lib/api"
import { PhotoRecipeUpload } from "@/components/recipes/PhotoRecipeUpload"
import { UrlRecipeImport } from "@/components/recipes/UrlRecipeImport"
import { IngredientLinesField, StepsTextField } from "@/components/recipes/form/RecipeTextFields"
import { savedRowLine, stepsText, type ResolvedIngredientRow, type SavedIngredientRow } from "@/lib/ingredientLines"
import { FitChip, cycleFit } from "@/components/recipes/FitChip"
import {
  Field,
  FieldError,
  FORCE_PILL,
  FormCard,
  FormErrors,
  FormHeader,
  SaveBar,
  TagList,
  choicePillClass,
  fieldClass,
} from "@/components/recipes/form/RecipeFormUI"
import { buildRecipePayload, createRecipeSchema, formatIngredientLine, splitSteps, COURSES, COURSE_LABELS } from "@ona/shared"
import type { Course, Meal, Season, ExtractedRecipe } from "@ona/shared"
import { MEAL_LABELS, SEASON_LABELS } from "@/lib/labels"
import { RequiredNote } from "@/components/FieldLabel"

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

/** Stands in for the ids of lines not resolved yet, to check the rest of the form first. */
const PENDING_ID = "00000000-0000-4000-8000-000000000000"

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

  // `/recipes/new?name=tarta+de+zanahoria` pre-fills the name field — used by
  // the menu swap picker's empty state so a user who searched "tarta" and
  // got no hits can keep their typed term when they bounce to this form.
  const [name, setName] = useState(() => searchParams.get("name") ?? "")
  const [servings, setServings] = useState<number | "">(2)
  // 'estimated' when the photo extractor had to guess the servings; typing a
  // number makes it 'explicit' again. The detail shows «Estimado» (PRO-32).
  const [servingsConfidence, setServingsConfidence] = useState<"explicit" | "estimated">("explicit")
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
  // Ingredients, one per line (PRO-1115). `savedRows` are the ones a photo
  // import already matched: their lines keep those rows while untouched.
  const [ingredientText, setIngredientText] = useState("")
  const [savedRows, setSavedRows] = useState<SavedIngredientRow[]>([])
  const ingredientLines = useIngredientLines(ingredientText, savedRows)
  // Steps, written or pasted whole; split into steps on the fly.
  const [stepText, setStepText] = useState("")
  // Resolving the lines (and creating the new ingredients) before the create.
  const [resolving, setResolving] = useState(false)
  const [photoExtracted, setPhotoExtracted] = useState(false)
  // «Subir mi foto» (PRO-145): uploaded right after the create; while it is
  // set the API skips the AI photo.
  const [ownPhoto, setOwnPhoto] = useState<File | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  // «Enlace del original» (PRO-66): optional; highlighted when the imported
  // photo looks like a screenshot of a web page or a social network.
  const [sourceUrl, setSourceUrl] = useState("")
  const [askSourceLink, setAskSourceLink] = useState(false)

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
    setServingsConfidence(data.servingsConfidence === "estimated" ? "estimated" : "explicit")
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
    setStepText(stepsText(data.steps))
    // Matched ones keep their row; the rest are lines like any typed one.
    const matched: SavedIngredientRow[] = []
    const lines = data.ingredients.map((ing) => {
      const row = {
        ingredientName: ing.ingredientName ?? ing.extractedName,
        quantity: ing.quantity,
        unit: ing.unit || "g",
        displayQuantity: ing.displayQuantity ?? null,
        displayUnit: ing.displayUnit ?? null,
      }
      if (!ing.ingredientId) return formatIngredientLine(row)
      const saved = { ...row, ingredientId: ing.ingredientId }
      matched.push(saved)
      return savedRowLine(saved)
    })
    setSavedRows(matched)
    setIngredientText(lines.join("\n"))
    setPhotoExtracted(true)
    setAskSourceLink(data.looksLikeScreenshot === true)
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

  // Build the schema-shaped payload from form state. Lives in @ona/shared so
  // the contract test in apps/api can validate this exact transformer against
  // createRecipeSchema and prevent silent drift.
  function buildPayload(ingredientRows: ResolvedIngredientRow[]) {
    const base = buildRecipePayload({
      name,
      servings,
      servingsConfidence,
      prepTime,
      // The legacy on/off arrays come from the fit map (any entry with a
      // non-none state is "selected"); the shared payload builder treats
      // them the same as before.
      selectedMeals: Object.keys(mealFit) as Meal[],
      selectedSeasons: Object.keys(seasonFit) as Season[],
      tags,
      steps: splitSteps(stepText),
      ingredientRows,
      sourceUrl,
    })
    return { ...base, mealFit, seasonFit, frequency, course: course || null }
  }

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

    // The rest of the form first, with the lines standing in: nothing is
    // created while the name or the meal is missing.
    const views = ingredientLines.views
    const draft = createRecipeSchema.safeParse(
      buildPayload(
        views.map((v) => ({
          ingredientId: PENDING_ID,
          ingredientName: v.parsed.name,
          quantity: v.amount.quantity,
          unit: v.amount.unit,
          optional: v.parsed.optional,
          note: v.parsed.note ?? "",
        })),
      ),
    )
    if (!draft.success) {
      // Map zod issues to a flat field -> message dictionary.
      const next: Record<string, string> = {}
      for (const issue of draft.error.issues) {
        const key = issue.path.length > 0 ? String(issue.path[0]) : "_form"
        if (!next[key]) next[key] = issue.message
      }
      if (views.length === 0) next.ingredients = "Escribe al menos un ingrediente, uno por línea."
      setErrors(next)
      return
    }

    // Lines → rows: the new ingredients are created now, like in the imports.
    let parsed: ReturnType<typeof createRecipeSchema.safeParse>
    setResolving(true)
    try {
      parsed = createRecipeSchema.safeParse(buildPayload(await ingredientLines.resolveRows()))
    } catch (err) {
      setErrors({ _form: (err as Error).message || "No se han podido guardar los ingredientes." })
      return
    } finally {
      setResolving(false)
    }
    if (!parsed.success) {
      setErrors({ _form: parsed.error.issues[0]?.message ?? "Revisa los ingredientes." })
      return
    }

    createRecipe.mutate({ ...parsed.data, force: useForce, ownPhoto: !!ownPhoto }, {
      onSuccess: async (created) => {
        // Own photo first, then away. If the upload fails the recipe is
        // still saved: the editor says so and offers both buttons again.
        let photoFailed = false
        if (ownPhoto) {
          setUploadingPhoto(true)
          try {
            await uploadRecipeImage(created.id, ownPhoto)
          } catch {
            photoFailed = true
          }
          setUploadingPhoto(false)
        }
        // Land on the edit screen — the user just wrote/imported the recipe,
        // they want to fine-tune ingredients/steps without an extra "Editar"
        // click. The detail view is one tap away from there.
        router.push(`/recipes/${created.id}/edit${photoFailed ? "?foto=fallo" : ""}`)
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
      <div className="mx-auto max-w-[var(--page-max)] px-4 pb-10 pt-4 sm:px-5 lg:px-8 lg:pt-8">
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
            Receta extraída de la foto. Revisa los datos y ajusta lo que sea
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
                  <Field label="Nombre" htmlFor="recipe-name" error={errors.name} required>
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

                  <div
                    data-testid="recipe-source-field"
                    data-highlighted={askSourceLink ? "true" : "false"}
                    className={
                      askSourceLink
                        ? "rounded-2xl border border-terracotta bg-cream-deep p-3.5"
                        : undefined
                    }
                  >
                    <Field
                      label="Enlace del original"
                      htmlFor="recipe-source"
                      optional
                      error={errors.sourceUrl}
                      hint={
                        askSourceLink
                          ? "Parece una captura de una web o una red social. Pega aquí el enlace del original y se guardará como fuente de la receta."
                          : "Si la receta viene de una web o un vídeo, la receta mostrará «Ver fuente»."
                      }
                    >
                      <input
                        id="recipe-source"
                        type="url"
                        inputMode="url"
                        value={sourceUrl}
                        onChange={(e) => setSourceUrl(e.target.value)}
                        placeholder="https://…"
                        className={fieldClass(!!errors.sourceUrl || askSourceLink)}
                      />
                    </Field>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Comensales" htmlFor="recipe-servings" error={errors.servings} required>
                      <div className="flex items-center gap-2">
                        <input
                          id="recipe-servings"
                          type="number"
                          required
                          value={servings}
                          onChange={(e) => {
                            setServings(e.target.value ? Number(e.target.value) : "")
                            setServingsConfidence("explicit")
                          }}
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
                      optional
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

                  <Field label="Tipo de plato" htmlFor="recipe-course" optional>
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

                  <Field label="Etiquetas" htmlFor="recipe-tags" optional plural>
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
                    required
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
                    hint="Marca las que encajen y con qué grado"
                    error={errors.seasons}
                    optional
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

              <NewRecipePhotoCard file={ownPhoto} onChange={setOwnPhoto} />
            </div>

            {/* Right column — ingredients and steps. */}
            <div className="min-w-0 space-y-4 lg:space-y-6">
              <FormCard
                title="Ingredientes"
                description="Uno por línea, como en un papel: «200 g de lentejas», «1 cebolla», «sal». Después de una coma va una nota («200 g de bacalao, desalado») y «(opcional)» lo marca. Debajo ves cómo se ha entendido."
                mark={{ required: true }}
              >
                <IngredientLinesField
                  text={ingredientText}
                  onText={setIngredientText}
                  views={ingredientLines.views}
                  onChoose={ingredientLines.choose}
                  hasError={!!errors.ingredients}
                  errorAt={(idx) => lintAt(errors, "ingredients", idx)}
                />
                <FieldError>{errors.ingredients}</FieldError>
              </FormCard>

              <FormCard
                title="Preparacion"
                description="Escribe o pega el texto entero: se parte en pasos por los saltos de línea y por la numeración («1.», «2)», «Paso 3:»)."
                mark={{ optional: true }}
              >
                <StepsTextField
                  text={stepText}
                  onText={setStepText}
                  errorAt={(idx) => lintAt(errors, "steps", idx)}
                />
              </FormCard>
            </div>
          </div>

          {/* Submit: error summary (+ "Guardar igualmente" after lint
              warnings) and the sticky ink pill. */}
          {/* The bar must be a direct child of the form: a sticky element
              only sticks inside its parent's box. */}
          <RequiredNote className="mt-4" />
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
                  disabled={createRecipe.isPending || resolving}
                  className={FORCE_PILL}
                >
                  {createRecipe.isPending ? "Guardando..." : "Guardar igualmente"}
                </button>
              )}
            </FormErrors>
          </div>
          <SaveBar
            submitLabel={
              uploadingPhoto ? "Subiendo tu foto..." : createRecipe.isPending || resolving ? "Guardando..." : "Crear receta"
            }
            disabled={createRecipe.isPending || uploadingPhoto || resolving}
            cancelHref="/recipes"
          />
        </form>
      </div>
    </div>
  )
}

/** A server lint message for row `idx` of a list: "ingredients[3]" or "steps[3].text". */
function lintAt(errors: Record<string, string>, list: "ingredients" | "steps", idx: number): string | null {
  return (
    Object.entries(errors).find(([k]) => k === `${list}[${idx}]` || k.startsWith(`${list}[${idx}].`))?.[1] ?? null
  )
}
