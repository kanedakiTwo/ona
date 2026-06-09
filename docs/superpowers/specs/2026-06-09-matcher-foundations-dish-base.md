# ONA — Matcher Foundations: `dish_base` + within-slot diversity

Date: 2026-06-09
Status: Approved by Miguel, ready for implementation plan
Sub-project: **1 of 4** in the matcher-improvements roadmap (see "Deferred to other sub-projects" below).

## Why

The matcher today produces sub-optimal multi-dish slots: on 2026-06-08 Miguel reported lunch slots with two beef dishes ("Carrilleras de ternera" + "Ternera con pimientos") and lunch slots with no main protein ("Ensalada de atún" + "Judías verdes rehogadas"). Two root causes:

1. **No structural tag for "what defines this dish"**. Diversity was inferred by overlapping the top-5 ingredient names — fragile (the catalogue has `ternera`, `solomillo de ternera`, `carrilleras` as 3 separate ingredient rows, so the overlap doesn't cross them).
2. **Diversity filter only applied in `/dish/random`** (the "Sugerir" button). The whole-week generator and `regenerate-dish` ("Cambiar") didn't apply it.

This sub-project lays the foundation: a closed-enum `dish_base` column on `recipes` (what the dish is "about" — `arroz`, `legumbre`, `pescado`…), LLM-backfilled, plus a single diversity helper used in all three picker flows.

## Scope

In scope:
- New `recipes.dish_base text` column with closed-enum validation in `@ona/shared`.
- LLM-backfill script (mirror of `populateRecipeCourses.ts`).
- Form dropdown "Categoría del plato" in `/recipes/new` + `/recipes/[id]/edit`.
- Shared helper `dishBaseDiversity.ts` (`presentDishBases`, `filterByDishBaseDiversity`).
- Diversity filter applied in:
  - whole-week generator (`menuGenerator.ts`)
  - `/dish/random` (replaces the existing top-5 ingredient-overlap hack)
  - `regenerate-dish` endpoint (`POST .../dish/:position/regenerate`)
- `hydrateMenuImages` adds `dishBase` to each `RecipeDish` on every menu GET.
- Spec updates: `recipes.md` (new column), `menus.md` (new filter in 3 flows).

Out of scope (deferred — see explicit map at the bottom).

## Decisions, with the trade-offs Miguel weighed

1. **`dish_base`, not `protein_main`.** Initial proposal called the field `protein_main`. Miguel pushed back: "arroz de verduras" has no protein dominante — the rice IS the dish. Generalised to `dish_base` = "what identifies this dish". Captures both protein-led (`pescado`, `carne_roja`) and non-protein-led (`arroz`, `pasta`, `vegetal`) anchors uniformly.
2. **12 buckets** (`carne_roja`, `carne_blanca`, `pescado`, `mariscos`, `huevo`, `legumbre`, `pasta`, `arroz`, `patata`, `vegetal`, `lacteo`, `dulce`) + `null` for "no clasificable / sin base dominante". Granularidad balanceada — captures the culturally-relevant distinctions in Spanish cooking without proliferating to 14+ which would over-tax LLM classification on edge cases.
3. **Single bucket per recipe** (LLM picks the dominant). "Garbanzos con chorizo" → `legumbre`. "Lentejas con chorizo" → `carne_roja` (the chorizo identifies the dish). The judgment lives in the LLM prompt with explicit examples; users can override via the form dropdown.
4. **`null` = wildcard** in diversity logic. A recipe with no `dish_base` (e.g. a fruta asada that the LLM legitimately couldn't anchor) doesn't trigger the filter — it's allowed in any slot. Avoids over-restriction during the rollout.
5. **Scope = within-slot only**. The within-day balance (no triple pescado in desayuno+comida+cena) and the rolling-cap-semanal (no más de 2 pescados en la semana) belong to sub-project 2. This keeps PR 1 small and the immediate user complaint (2 ternera in same slot) fixed.
6. **Graceful fallback** when the diversity filter empties the pool: each consumer tries the filtered pool first, then falls back to the full pool. "Better a repeated `dish_base` than no dish at all." The generator adds a warning in the response so the UI can surface it.
7. **One PR**, not multiple. Unlike the multi-dish work (which we split into PR A foundation + PR B feature for size), this fits in ~400-600 lines because the shape change is one column and the filter is a single helper applied 3 times.

## Data model

### `0031_recipes_dish_base.sql`

```sql
-- Per-recipe dish category: what the dish is "about" (rice-led, fish-led,
-- legume-led, …). Used by the matcher to keep multi-dish slots diverse —
-- "no two arroces in the same lunch", "no two carne_roja in the same slot".
-- Idempotent so partial applies re-run safely. Closed enum enforced at the
-- application layer via the Zod schema in @ona/shared.
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "dish_base" text;
```

### `@ona/shared` additions (`packages/shared/src/types/recipe.ts`)

```ts
export const DISH_BASES = [
  'carne_roja',    // ternera, cerdo, cordero, chorizo identitario
  'carne_blanca',  // pollo, pavo, conejo
  'pescado',       // blanco + azul (fine-grain = sub-project futuro)
  'mariscos',
  'huevo',         // tortillas, revueltos, huevos rotos
  'legumbre',      // garbanzos, lentejas, alubias, tofu, hummus
  'pasta',
  'arroz',         // risotto, paella, arroz blanco
  'patata',        // patatas bravas, ensaladilla — patatas COMO base
  'vegetal',       // cremas, ensaladas, verduras al horno
  'lacteo',        // queso COMO plato (tabla, fondue) — raro
  'dulce',         // postres, frutas dulces
] as const
export type DishBase = typeof DISH_BASES[number]

export const DISH_BASE_LABELS: Record<DishBase, string> = {
  carne_roja: 'Carne roja',
  carne_blanca: 'Carne blanca',
  pescado: 'Pescado',
  mariscos: 'Mariscos',
  huevo: 'Huevo',
  legumbre: 'Legumbre',
  pasta: 'Pasta',
  arroz: 'Arroz',
  patata: 'Patata',
  vegetal: 'Vegetal',
  lacteo: 'Lácteo',
  dulce: 'Dulce',
}

export const dishBaseSchema = z.union([z.enum(DISH_BASES), z.null()])
```

`Recipe` interface gains `dishBase?: DishBase | null`. The `RecipeDish` variant of `Dish` (in `packages/shared/src/types/menuDish.ts`) **also** gains `dishBase?: DishBase | null` — hydrated by `hydrateMenuImages` on every menu GET, persisted by the generator and `/dish/random` when adding new dishes, so the diversity helper in `dishBaseDiversity.ts` can read `dish.dishBase` directly off the in-memory slot without re-querying.

## LLM backfill

`apps/api/scripts/populateDishBase.ts` mirrors `populateRecipeCourses.ts` line-for-line. Two-step pipeline:

```
pnpm dish-base:populate  → SELECT id, name, ingredients FROM recipes
                         → Claude classifies in batches of 50
                         → writes JSONL to scripts/output/dish-bases.jsonl
pnpm dish-base:apply     → UPDATEs recipes.dish_base from the JSONL
```

LLM system prompt includes the 12 buckets, explicit examples per bucket, and the edge-case rules:
- "Garbanzos con chorizo" → `legumbre` (garbanzos son la base; chorizo es sabor).
- "Lentejas con chorizo" → `carne_roja` (el chorizo dictamina el carácter; lentejas son guarnición).
- "Salmón con patatas asadas" → `pescado`.
- "Patatas a la riojana" → `patata`.
- "Tortilla francesa" / "Tortilla de patatas" → `huevo`.
- "Risotto de setas" → `arroz`.
- "Crema de calabacín" → `vegetal`.
- "Pan con tomate" → `null` (no es plato base).

Defaults to `null` on ambiguity. Cost estimate: ~$0.10 against the ~68-recipe prod catalogue.

Postres ya tagueados como `course=dessert` se reclasifican también (la LLM ve el contexto fresco; `dulce` y `dessert` son ejes ortogonales aunque correlados — un postre que se sirve frío como acompañamiento podría caer fuera de `dulce`).

## Form dropdown

Below the existing "Tipo de plato" (course) dropdown in `/recipes/new` and `/recipes/[id]/edit`:

```
Categoría del plato:  [ Sin clasificar (auto)  ▼ ]
                        Carne roja
                        Carne blanca
                        Pescado
                        …
```

Default `Sin clasificar (auto)` → persists as `null`. The persistence layer (`recipePersistence.ts`) gains a `dish_base` field in `RecipeWriteInput`, forwarded to both insert and update paths.

## Diversity helper

`apps/api/src/services/dishBaseDiversity.ts`:

```ts
import type { Dish, Recipe } from '@ona/shared'

/** Set of dish_base values already present in this slot. Ignores notes and null. */
export function presentDishBases(dishes: Dish[]): Set<string> {
  const out = new Set<string>()
  for (const d of dishes) {
    if (d.kind !== 'recipe') continue
    const base = (d as { dishBase?: string | null }).dishBase
    if (base) out.add(base)
  }
  return out
}

/**
 * Filter the candidate pool so recipes whose dish_base is already present in
 * the slot are excluded. null-tagged recipes pass through (wildcard).
 */
export function filterByDishBaseDiversity<T extends { dishBase?: string | null }>(
  pool: T[],
  presentBases: Set<string>,
): T[] {
  if (presentBases.size === 0) return pool
  return pool.filter((r) => !r.dishBase || !presentBases.has(r.dishBase))
}
```

Pure functions, no DB calls. Unit-tested in `dishBaseDiversity.test.ts`.

## Application points

### 1. Whole-week generator (`menuGenerator.ts`, slot-fill loop)

Before each course iteration in a multi-dish slot, accumulate the bases of already-picked dishes for THIS slot and filter the pool:

```ts
const presentBases = new Set<string>()
for (const course of wantedCourses) {
  const filteredPool = filterByDishBaseDiversity(recipesPool, presentBases)
  let picked = findForCourse(filteredPool, course, opts)
  if (!picked) picked = findForCourse(recipesPool, course, opts)  // fallback graceful
  if (!picked) { warnings.push(`no_${course}_available_${meal}_d${dayIndex}`); continue }
  if (picked.dishBase) presentBases.add(picked.dishBase)
  dishes.push({ kind: 'recipe', recipeId: picked.id, recipeName: picked.name, course: picked.course, dishBase: picked.dishBase ?? null })
}
```

### 2. `/dish/random` endpoint

Replaces the existing top-5-ingredient-overlap hack:

```ts
const presentBases = presentDishBases(slot.dishes)
const filteredPool = filterByDishBaseDiversity(recipesWithIngredientsR, presentBases)
let picked = findForCourse(filteredPool, courseForMatcher, matcherOptionsR)
if (!picked) picked = findForCourse(recipesWithIngredientsR, courseForMatcher, matcherOptionsR)
```

The `existingIngredientNames` + `diversityFilteredPool` block in the current `/dish/random` route (search `existingIngredientNames` in `apps/api/src/routes/menus.ts`) is removed. Cleaner code, more accurate semantics.

### 3. `regenerate-dish` endpoint (`POST .../dish/:position/regenerate`)

The dish at `position` is excluded from `presentDishBases` because we're replacing it:

```ts
const otherDishes = slot.dishes.filter((_, i) => i !== position)
const presentBases = presentDishBases(otherDishes)
const filteredPool = filterByDishBaseDiversity(recipesWithIngredientsRegen, presentBases)
let picked = findForCourse(filteredPool, dish.course ?? null, matcherOptionsRegen)
if (!picked) picked = findForCourse(recipesWithIngredientsRegen, dish.course ?? null, matcherOptionsRegen)
```

This was the gap the previous ship didn't cover: regenerating one dish in a multi-dish slot used to ignore the OTHER dishes' bases.

## Hydration

`hydrateMenuImages` in `apps/api/src/routes/menus.ts` already joins `recipes.image_url`, `prep_time`, `total_time`, `course`. We add `dish_base` to the SELECT and write it to each `RecipeDish` on read. Legacy slots (created before this PR) get the `dishBase` tag at GET time without needing a data migration of `menus.days`.

## Testing strategy

Unit tests (TDD-first):
- `dishBaseValidator.test.ts` — closed enum validates 12 buckets + null, rejects unknown.
- `dishBaseDiversity.test.ts` — `presentDishBases` ignores notes and null · `filterByDishBaseDiversity` passes through null-tagged · excludes recipes with base already present · returns the original pool when `presentBases` is empty.

Integration / route smoke:
- `POST /dish/random` with a slot containing one `carne_roja` dish → response dish has a different base (when alternatives exist).
- `PUT /menu/:menuId/day/:day/meal/:meal` (regenerate-meal) on a multi-dish slot → distinct bases across regenerated recipe-dishes.

E2E: out of scope (project convention since the May 2026 e2e debt).

## Spec gate

- `specs/recipes.md` — new "Categoría del plato (`dish_base`)" section + LLM backfill (mirrors the existing `course` section).
- `specs/menus.md` — "Diversidad por `dish_base`" subsection inside "Multi-dish slots" describing the within-slot filter + graceful fallback + warnings.

## Migration / deploy

Order (mirrors the course-backfill ship pattern that worked on 2026-06-07):
1. Migration 0031 applies on next `ona-api` deploy (idempotent ADD COLUMN IF NOT EXISTS).
2. LLM populate locally → review JSONL → commit.
3. Apply backfill against **prod DB** via `DATABASE_URL=$PROD_PUBLIC_URL pnpm dish-base:apply` (the env override DOES propagate to `env.ts`; verified during the course rollout).
4. `railway up --service ona-api` → `railway up --service ona-web`.

No new env vars. No new Railway start command changes (unlike PR B where we wired `menus:migrate-dishes` into RAILPACK_START_CMD).

---

## Deferred to other sub-projects

This is the explicit traceability map Miguel asked for. Everything below is **explicitly NOT in this PR**; each item has its target sub-project.

### Sub-project 2 — Balance nutricional

- **(1) Balance de macros entre platos de un slot** — beyond just `dish_base` diversity, weigh calories/protein/carbs ratios within multi-dish slots so a slot doesn't end up 2× heavy or 0g protein.
- **(2) Balance comida ↔ cena del mismo día** — penalize lunch+dinner both being the same `dish_base` (e.g. pasta + pasta), or both being heavy. Soft constraint, not hard.
- **(4-a) Scoring final pondera nutrición** — `scoreMenu` today penalizes repetitions and empty slots. Add a nutrition-balance term using the existing `recipes.calories` / `protein` / `carbs` / `fat` columns and the household's targets.
- **(4-b) Scoring final pondera variedad de cocinas** — add a `cuisine` tag (mediterránea, asiática, mexicana, …) via another LLM backfill, and reward variety. ⚠ Separate decision — could spin off as its own backfill PR.
- **Rolling cap semanal por `dish_base`** — soft limit "no más de 2 pescados en la semana", "no más de 3 carnes". Penalizes overshoots in `scoreMenu`. Uses the same `dish_base` column this sub-project ships.

### Sub-project 3 — Memoria entre semanas

- **(6) Si la semana pasada comió atún 3 veces, esta semana no lo repite** — persist a "weekly footprint" per user/week (set of recipeIds + dish_bases + cuisines) and read N previous footprints from the matcher to apply a soft penalty. Requires a new column on `menus` (a `footprint` JSONB or derived view) + a `usedRecipeIdsRecent` parameter in `MatcherOptions`.
- **Decision pending**: ¿cuántas semanas mirar atrás (2? 4?) y qué penalty aplicar (hard exclude vs soft scoring multiplier)?

### Sub-project 4 — Stack semanal estructural

- **(7) "Lunes legumbres, miércoles pescado, viernes pasta…"** — user defines a per-day-meal `dish_base` preference in their plantilla. Generator honors as soft (preferred) or hard (required) constraint. Biggest UX change — new section in `/profile`, new field in `mealTemplate`, generator path reads from it.
- **Decision pending**: ¿la regla es hard (si no hay candidato del `dish_base` pedido para ese día, falla con warning) o soft (preferimos, pero si no hay, usamos cualquiera)?

### Out of scope across all sub-projects (1-4)

These were considered and parked entirely — they might never ship, or only as polish:

- **Sub-buckets de pescado** (`pescado_blanco` vs `pescado_azul`). Útil para frecuencia óptima (omega-3) pero ambigüedad en clasificación. Si la diversidad básica + cap semanal funciona, probablemente no haga falta.
- **Multi-valor `dish_base`** (array de hasta 2 buckets). Decidimos en sub-proyecto 1: un bucket dominante, el LLM elige. La complejidad de sets no compensaba en este nivel de granularidad.
- **`dish_base` derivado de ingredientes a runtime** (sin tabla de tags). Más limpio teóricamente pero requiere mantener una taxonomía de ingredientes → bases en código, brittle. La columna persistida + LLM backfill es mejor compromiso.
- **Recipe-level "diversity weight"** — algunas recetas son más "icónicas" que otras (paella domina; arroz blanco con tomate no). Por ahora todos los recipes pesan igual.
- **Cross-household diversity** — si dos miembros del mismo household generan menús, no se coordinan. Tema de household sharing, no de matcher.

## Open follow-ups (within sub-project 1 — non-blocking)

- **Manual override semántica**: si el usuario edita `dish_base` en `/recipes/[id]/edit`, lo marcamos con `dish_base_source: 'user' | 'llm'`? Por ahora simple: la columna se sobreescribe, no se trackea el origen. Si en sub-proyecto 2 necesitamos re-correr el backfill, le decimos al script que NO toque rows donde el user lo cambió.
- **Distribution sanity check**: después del backfill en prod, validar que la distribución es razonable (no 80% `null`, no 70% `vegetal`). Si está sesgado, iterar sobre el prompt. → **Add as a Todo Miguel line in the implementation plan** so it doesn't slip after deploy.
