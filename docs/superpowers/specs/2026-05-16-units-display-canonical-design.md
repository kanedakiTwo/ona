# Units: display vs canonical — design

**Status**: design draft (brainstormed 2026-05-16, awaiting implementation plan).
**Spec gate**: this design will be reflected in `specs/recipes.md` once implemented.

## Problem

ONA recipes currently store each ingredient row as `{ quantity, unit }` where `unit` is the enum `g | ml | u | cda | cdita | pizca | al_gusto` (defined in `packages/shared/src/constants/enums.ts`). Three pain points:

1. **Abstract conversions are hard-coded in one place and don't extend.** `apps/api/src/services/nutrition/aggregate.ts` carries module-level constants `CDA_ML = 15` and `CDITA_ML = 5` and a `switch` on the literal unit values. `pizca` and `al_gusto` short-circuit to `0 g`. Any new abstract term (`chorro`, `puñado`, `ramita`…) requires a code change to that switch. There is no mechanism for per-ingredient overrides (`puñado de espinacas` ≠ `puñado de almendras` in grams).
2. **The author's intent is lost.** A recipe that says "1 cda de aceite" can be stored as either:
   - `quantity=1, unit='cda'` — preserves wording, ties the row to the hard-coded conversion in `aggregate.ts`.
   - `quantity=15, unit='ml'` — fixes nutrition for any case, loses the human-readable wording.
   No middle ground. The user wants both — display the author's wording in the UI, compute nutrition + scaling from a canonical value.
3. **Servings absent ⇒ silent default.** When a recipe doesn't state how many it serves, the extractor leaves the field empty / defaulted to `2` with no signal that it was guessed. The user can't tell explicit from estimated.

## Goals

1. The UI shows whatever abstract unit the original recipe used (`cda`, `puñado`, `chorrito`, …) without losing fidelity to the author.
2. Internally every row carries a canonical `(quantity, unit) ∈ (g|ml|u)` so nutrition aggregation and serving scaling are always exact. Imperial / kilo / litre values are translated to `g` / `ml` at write time.
3. Scaling per `userServings` preserves abstract units when the math gives a clean culinary value, falls back to canonical formatted output when it doesn't.
4. If the original recipe doesn't state servings, the extractor estimates and flags the row so the user can override.

## Non-goals (v1)

- Multi-display rendering (showing both `1 cda` AND `15 ml` simultaneously with a toggle). Secondary canonical only appears in scaled output.
- Imperial units in storage. LLM extraction translates `cup` / `fl oz` to metric.
- A curator UI to edit per-ingredient unit weights. Curator already exists in `/admin`; this design is orthogonal.
- Caloric-density post-hoc servings deduction (`Q4` option B). If the LLM-first approach proves unreliable, that's a future iteration.

## Decisions (anchored by the brainstorm)

| # | Decision | Choice |
|---|---|---|
| Q1 | Vocabulary model | Free-form `display_unit` text + canonical `(quantity, unit)` in g/ml/u. |
| Q2 | Conversion engine | Hybrid: deterministic table for ~29 common terms; LLM fallback for unknown free-form, cached in DB. |
| Q3 | Schema layout | Add new `display_quantity` + `display_unit` columns; tighten `unit` enum to canonical-only `g \| ml \| u`. (Current enum has `cda \| cdita \| pizca \| al_gusto` mixed in; those move to `display_unit` post-migration.) |
| Q4 | Servings deduction | Extractor prompts always return `servings` + `servings_confidence: 'explicit' \| 'estimated'`. |
| Q5 | Scaling | Hybrid: keep abstract display when the scaled quantity matches a culinary fraction; otherwise format canonical. |

## Deterministic vocabulary (29 canonical terms)

Researched against six Spanish cooking sources (La Española Aceites, Recetas La Masía, MAPFRE Hogar, OCU, Mi guía de cocina, Larousse Cocina). Synonyms cover the common variants and abbreviations encountered in recipe writing.

### Volumetric (ml; converted to g via `ingredient.density`)

| Canonical | ml | Common synonyms / abbreviations |
|---|---|---|
| `gota` | 0.05 | gotita |
| `cdita` | 5 | cucharadita, cuchara de café, c.p., c/p, cdt, tsp |
| `cda postre` | 10 | cucharada de postre |
| `cda` | 15 | cucharada, cucharada sopera, cuchara sopera, c.s.\*, tbsp |
| `chorrito` | 10 | chorrín |
| `chorro` | 30 | chorretón, buen chorro |
| `copa licor` | 50 | copita |
| `tacita` | 100 | tacita de café, taza de café |
| `copa vino` | 100 | copa, copa de vino, vaso pequeño |
| `taza desayuno` | 150 | taza de té, taza chica |
| `vaso` | 200 | vaso de agua, vaso estándar |
| `taza` | 240 | cup, taza americana, taza repostería |
| `tazón` | 250 | bowl, tazón de desayuno |

\* `c.s.` is contextually disambiguated: when a numeric quantity precedes (`2 c.s. de aceite`) it resolves to `cda`; otherwise it's `cantidad suficiente`.

### Mass (g; ingredient-independent)

| Canonical | g | Synonyms |
|---|---|---|
| `pizca` | 0.5 | pizquita |
| `pellizco` | 2 | pellizquito, dash |
| `puñado` | 30 | puño, puñadito, handful |
| `manojo` | 100 | atadillo, ramillete, bouquet, bouquet garni |

### Discrete (g per item; uses `ingredient.unitWeight` when set, else default)

| Canonical | Default g | Typical ingredient | Synonyms |
|---|---|---|---|
| `diente` | 5 | ajo | dientecillo |
| `terrón` | 6 | azúcar | cubito, sugar cube |
| `nuez` | 20 | mantequilla | — |
| `avellana` | 5 | mantequilla | — |
| `loncha` | 40 | jamón / queso | lonja, tajada, feta, slice |
| `rebanada` | 30 | pan | rebanadita |
| `hoja` | 0.2 | laurel | hojita |
| `ramita` | 1.5 | perejil, tomillo, romero | ramito, rama, sprig |
| `rodaja` | 12 | limón, tomate, pepino | ruedita, aro |
| `unidad` | (n/a) | huevo, fruta | u, ud, pieza, pza |

### Symbolic (no weight)

| Canonical | Synonyms |
|---|---|
| `al gusto` | a gusto, al paladar, q.s., to taste |
| `cantidad suficiente` | c.s., c/s, c.n., cantidad necesaria |

## Schema

### `recipe_ingredients`

```sql
ALTER TABLE recipe_ingredients
  ADD COLUMN display_quantity real,
  ADD COLUMN display_unit text;

ALTER TABLE recipe_ingredients DROP CONSTRAINT IF EXISTS recipe_ingredients_unit_check;
ALTER TABLE recipe_ingredients
  ADD CONSTRAINT recipe_ingredients_unit_check
  CHECK (unit IN ('g','ml','u'));
```

- `quantity` + `unit` are always canonical (`g | ml | u`) post-migration.
- `display_quantity` + `display_unit` are NULL when the original was already canonical.
- A row with `display_unit` set takes precedence in the UI; nutrition/scaling always uses canonical.
- The narrower canonical set matches what `aggregate.ts` already supports today. Recipes using kilograms or litres translate to `g`/`ml` at write time (1.5 kg → quantity 1500, unit g; the LLM prompt already handles this in extraction).

### `recipes`

```sql
ALTER TABLE recipes
  ADD COLUMN servings_confidence text NOT NULL DEFAULT 'explicit'
    CHECK (servings_confidence IN ('explicit','estimated'));
```

### `unit_conversion_cache` (new)

```sql
CREATE TABLE unit_conversion_cache (
  display_unit text NOT NULL,             -- normalized: lowercase, no accents
  ingredient_id uuid REFERENCES ingredients(id) ON DELETE CASCADE,
  grams_per_unit real,
  ml_per_unit real,
  source text NOT NULL CHECK (source IN ('llm','manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (display_unit, ingredient_id),
  CHECK (grams_per_unit IS NOT NULL OR ml_per_unit IS NOT NULL)
);
CREATE INDEX idx_unit_cache_unit ON unit_conversion_cache(display_unit);
```

Cache stores only LLM-resolved and manual-override conversions. Table resolutions live in code and are recomputed for free.

## Shared types

```ts
// packages/shared/src/constants/enums.ts
export const UNITS = ['g', 'ml', 'u'] as const
export type Unit = (typeof UNITS)[number]

const recipeIngredientWriteSchema = z.object({
  ingredientId: z.string().uuid(),
  section: z.string().optional(),
  quantity: z.number().min(0),
  unit: z.enum(UNITS),
  displayQuantity: z.number().min(0).nullable().optional(),
  displayUnit: z.string().nullable().optional(),
  optional: z.boolean().default(false),
  note: z.string().optional(),
  displayOrder: z.number().int().min(0).default(0),
})

export interface ExtractedRecipe {
  // …existing
  servings: number               // no longer nullable
  servingsConfidence: 'explicit' | 'estimated'
}

export interface Recipe {
  // …existing server-read shape
  servingsConfidence: 'explicit' | 'estimated'
}

// createRecipeSchema gains the new fields (default 'explicit' for manual writes).
```

The new `servingsConfidence` flows: extractor produces it on `ExtractedRecipe`; `persistRecipe` writes it; `toDetailRecipe` returns it on `Recipe`; the form's `buildRecipePayload` carries it.

Existing `recipeFormContract.test.ts` and `recipeFormLintContract.test.ts` are extended to cover the new fields so the form↔schema drift can't recur.

## Conversion engine

### Layout

```
packages/shared/src/units/
├── vocabulary.ts        # 29 canonical terms + synonyms + factors
├── normalize.ts         # toLowerCase + NFD + strip accents
├── resolve.ts           # entry point: (qty, unit, ingredient?) → canonical
└── format.ts            # canonical → display string for scaling

apps/api/src/services/
├── unitResolver.ts      # table → cache → LLM fallback → cache write
└── llmUnitFallback.ts   # Anthropic call + prompt

apps/api/src/routes/
└── units.ts             # POST /units/resolve for the manual form
```

### Public API

```ts
// packages/shared/src/units/resolve.ts
export interface ResolveInput {
  displayQuantity: number
  displayUnit: string
  ingredient?: {
    id?: string
    density?: number | null
    unitWeight?: number | null
    name?: string
  }
}
export interface ResolveResult {
  canonicalQuantity: number
  canonicalUnit: 'g' | 'ml' | 'u'
  source: 'table' | 'cache' | 'llm' | 'unknown'
}

/** Pure: covers ~95% of cases via the deterministic table. Returns null if unknown. */
export function resolveFromTable(input: ResolveInput): ResolveResult | null
```

```ts
// apps/api/src/services/unitResolver.ts
export async function resolveUnit(input: ResolveInput): Promise<ResolveResult>
// Flow: resolveFromTable → loadCache → callLlmFallback → writeCache.
```

### Resolution logic

For each term, the factor declares one of:
- `mlPerUnit`: volumetric. Compute `ml = qty * mlPerUnit`. If `ingredient.density` present, return `(ml * density, 'g')`; else `(ml, 'ml')`.
- `gramsPerUnit`: mass. Compute `(qty * gramsPerUnit, 'g')`.
- `perUnitWeight`: discrete. Use `ingredient.unitWeight` if present, else the term's default `gramsPerUnit`. Return `(qty * weight, 'g')`.
- `symbolic`: `al gusto` / `cantidad suficiente`. Return `(0, 'g')`. Display retains the original text.

### LLM fallback prompt (Claude Haiku)

```
You are a culinary unit conversion expert. Given an abstract Spanish measurement
unit (e.g. "rodajita generosa", "puñado pequeño") and optionally an ingredient
name, return JSON:

{
  "gramsPerUnit": number | null,
  "mlPerUnit": number | null,
  "rationale": "1-sentence Spanish explanation"
}

Rules:
- Volumetric (typically liquid) → mlPerUnit.
- Solid/discrete → gramsPerUnit.
- Both unclear → prefer gramsPerUnit with ingredient context.
- Numbers must be > 0.

Examples:
{ unit: "rodajita", ingredient: "limón" } → { "gramsPerUnit": 8, ... }
{ unit: "buen chorro", ingredient: null } → { "mlPerUnit": 40, ... }
```

Cost envelope: ~$0.0002/call, each `(unit, ingredient)` pair hits LLM at most once (then cached). Estimated lifetime cost <$1 even at 1000-recipe scale.

### `POST /units/resolve` (auth)

```ts
// Body: { displayQuantity: number, displayUnit: string, ingredientId?: uuid }
// Response: ResolveResult
```

Called by `/recipes/new` form when the user types a `displayUnit` that doesn't match the local table. Frontend debounces and caches per-form-instance.

## Servings deduction

### Extractor prompt change

Add to both `EXTRACTION_PROMPT` (image) and `TEXT_EXTRACTION_PROMPT` (URL/text):

```
Field "servings" is REQUIRED:
- If the recipe states "para 4 personas" / "6 raciones" → { servings: 4, servingsConfidence: "explicit" }
- Otherwise estimate from:
  - main protein quantity (200–250 g per diner)
  - main carb (60–80 g uncooked rice / 80–100 g pasta per person)
  - total volume for soups/cream (~350 ml per diner)
  - default to 4 if no signal
  Return { servings: <int>, servingsConfidence: "estimated" }
- Must be integer 1..12.
```

### Validation

- `AnthropicProvider` clamps `servings` to `[1, 12]` and forces `servingsConfidence='estimated'` if the LLM returns null or non-integer.

### UI

The Servings input in `/recipes/new` and `/recipes/[id]/edit` shows a small "Estimado" badge when `servings_confidence='estimated'`. Editing the field flips the state to `'explicit'` (no separate confirmation needed).

## Scaling

### Policy

```
factor = userServings / recipe.servings
```

| Case | Behavior |
|---|---|
| `factor === 1` | Display + canonical unchanged. |
| Display unit set, scaled quantity is "culinary clean" | Show `displayQuantity * factor` (formatted as fraction) + `displayUnit`. Canonical scales linearly behind the scenes. |
| Display unit set, scaled quantity is NOT culinary clean | Hide display, render canonical formatted ("22 ml"). |
| No display unit | Always show canonical. |

### "Culinary clean" definition

A scaled quantity is clean if within ε=0.02 of any value in:

```
[0.25, 0.33, 0.5, 0.66, 0.75,
 1, 1.25, 1.33, 1.5, 1.66, 1.75,
 2, 2.25, 2.33, 2.5, 2.66, 2.75,
 3, 3.5, 4, 4.5, 5, 6, 8, 10, 12]
```

OR within ε=0.02 of an integer ≥1.

### Format module

```ts
// packages/shared/src/units/format.ts
export function formatScaled(input: FormatScaledInput): {
  primary: string                   // "1 1/2 cda"
  secondary?: string                // "(22 ml)" — only when scaled
}
```

- Fractions rendered as Unicode-safe ASCII: `1/2`, `1/4`, `1/3`, `2/3`, `3/4`. Mixed: `1 1/2`, `1 1/3`, `2 2/3`. Decimal fractions (`1.33`, `1.66`, `2.33`, `2.66`) in the culinary-clean list are rendered as thirds (`1 1/3`, `1 2/3`, `2 1/3`, `2 2/3`).
- Canonical rounding by magnitude:
  - `< 1` → 2 decimals (`0.5 g`)
  - `< 10` → 1 decimal (`4.5 g`)
  - `< 100` → integer (`22 g`)
  - `≥ 100` → nearest multiple of 5 (`235 g`)

## Migration

Drizzle migration `0008_units_display_split.sql` is additive: adds the two new columns, adds `recipes.servings_confidence`, creates `unit_conversion_cache`. The constraint tightening to the canonical-only enum runs as a separate Drizzle migration `0009_units_canonical_only_check.sql` AFTER the backfill script confirms zero rows still carry abstract values. Splitting the constraint change into its own migration keeps `0008` reversible (`DROP COLUMN` only) and ensures CI can never trip on a half-migrated DB.

Backfill script `apps/api/scripts/migrateUnitsToDisplay.ts`:

1. Defaults to `--dry-run`. Walks every `recipe_ingredients` row with `unit IN ('cda','cdita','pizca','al_gusto')`.
2. For each: load the ingredient (for `density`), call `resolveFromTable(...)`.
3. UPDATE:
   - `display_quantity = quantity` (the original abstract count)
   - `display_unit = unit` (the original abstract term)
   - `quantity = canonical.quantity`
   - `unit = canonical.unit` (`g` or `ml`)
4. `al_gusto` rows: `quantity=0, unit='g', display_quantity=NULL, display_unit='al gusto'`.
5. Logs WARN per row where the conversion couldn't complete (e.g. cda for a row without density). Such rows are left untouched; the operator decides whether to add density to the ingredient or keep the legacy unit for a manual fix-up pass.
6. Idempotent: a row already migrated (display columns populated) is skipped.

Deploy order:
1. `railway up --service ona-api` applies migration `0008` (additive).
2. Locally: `tsx scripts/migrateUnitsToDisplay.ts --dry-run` → expect non-zero rows to migrate, zero unresolvable.
3. `--execute` to commit.
4. Apply enum-tightening migration `0009_units_canonical_only_check.sql` only after step 3 reports a clean run (`apps/api/scripts/migrateUnitsToDisplay.ts --execute` exit code 0, zero rows with `unit IN ('cda','cdita','pizca','al_gusto')`).
5. **Delete `CDA_ML`/`CDITA_ML` constants and the abstract-unit branches of the `switch (unit)` in `apps/api/src/services/nutrition/aggregate.ts`** — the aggregator now sees canonical-only units, so the `cda`/`cdita`/`pizca`/`al_gusto` cases are dead code. Done in the same PR as the resolver introduction.
6. Spec gate: update `specs/recipes.md` Ingredient Model section AND the AI Extraction section (because `servings_confidence` is a new user-visible field surfaced by the extractor).

## Test plan

### Unit tests (vitest, `apps/api/src/tests/`)

| File | Cases |
|---|---|
| `unitsVocabulary.test.ts` | All 29 canonicals resolve via every declared synonym (case + accent permutations). Unknown term returns `null`. |
| `unitsResolve.test.ts` | `mlPerUnit` × `density=null` → `(ml, 'ml')`. `mlPerUnit` × `density=0.92` → `(g, 'g')`. `perUnitWeight` uses `ingredient.unitWeight` when set, else default. `symbolic` returns `(0, 'g')`. |
| `unitsFormat.test.ts` | `formatFraction(1.5) === "1 1/2"`. `formatFraction(0.25) === "1/4"`. `formatCanonical(22.7, 'ml') === "23 ml"`. `formatCanonical(0.5, 'g') === "0.5 g"`. `formatCanonical(237, 'g') === "235 g"`. |
| `recipeScaler.test.ts` (extended) | factor=1 keeps display verbatim. factor=2 doubles display. factor=1.5 → "1 1/2 cda". factor=1.47 → display dropped, canonical rendered. |
| `unitResolver.smoke.ts` | LLM fallback with `"rodajita"` + `limón` returns ~8 g, writes cache, second call hits cache. |
| `recipeFormContract.test.ts` (extended) | Payload includes `displayQuantity`/`displayUnit`; passes `createRecipeSchema`. `servingsConfidence` required. |
| `migrateUnitsToDisplay.test.ts` | Fixture row `(1, 'cda', density=0.92)` → migrated to `(13.8, 'g')` + display `(1, 'cda')`. Idempotent. |

### E2E (Playwright)

- `recipe-create.spec.ts` (extended): creates a recipe with "1 cda de aceite", confirms GET response carries `display_quantity=1, display_unit='cda', quantity=15, unit='ml'`.

## Acceptance criteria

1. **Recipe "1 cda de aceite" for 4 diners**:
   - DB row: `quantity=15, unit='ml'` (or `13.8, 'g'` if density set), `display_quantity=1, display_unit='cda'`.
   - UI at 4 diners: "1 cda de aceite".
   - UI at 8: "2 cda de aceite".
   - UI at 5: "1 1/4 cda de aceite".
   - UI at 7: "1 3/4 cda de aceite".
   - UI at 11: "2 3/4 cda de aceite".

2. **Recipe "una pizca de sal" for 4 diners**:
   - DB row: `quantity=0.5, unit='g'`, `display_quantity=1, display_unit='pizca'`.
   - UI at 4: "1 pizca de sal".
   - UI at 8: factor=2 is in the culinary-clean list → "2 pizcas de sal".
   - UI at 6: factor=1.5 is in the culinary-clean list → "1 1/2 pizcas de sal".
   - UI at 11: factor=2.75 is in the culinary-clean list → "2 3/4 pizcas de sal".
   - (Same scaling rule as the abstract-cda case — no separate "2× threshold".)

3. **URL extraction without explicit servings**:
   - LLM returns `servings: 4, servingsConfidence: 'estimated'`.
   - Form shows "Comensales: 4 [Estimado]" with inline help.
   - User editing → confidence flips to `'explicit'`.

4. **`POST /units/resolve` with `"rodajita generosa"` + ingredient=limón**:
   - First call hits LLM → ~8 g, cache write.
   - Second call → cache hit, no LLM call (asserted via mock count).

5. **Production migration**:
   - 56 system recipes migrate without loss.
   - Backfill dry-run reports zero unresolvable rows (or operator addresses each).
   - `recipes.servings_confidence='explicit'` for all migrated rows.

## Risk & rollback

| Risk | Mitigation |
|---|---|
| Backfill fails on rows whose ingredient lacks density | Script logs WARN, leaves row untouched. Constraint tighten runs only after WARN count = 0. |
| LLM cost runaway | Cache is keyed on normalized `(displayUnit, ingredientId)`; each pair calls LLM at most once. Env var `UNIT_LLM_DAILY_CAP` caps daily calls (default 50). Beyond cap → return stub `(quantity * 1, 'g')` with warning surfaced to user. |
| Recipe-detail UI breaks pre-migration | `unit + quantity` remain canonical for every row, so any existing reader still works. Display columns are additive. |
| Migration `0009` (enum tighten) fails in prod | `0009` is a stand-alone Drizzle migration whose only change is `DROP CONSTRAINT … ADD CONSTRAINT … CHECK (unit IN ('g','ml','u'))`. Reversible by running an inverse SQL that re-adds the old check (kept in repo as `apps/api/src/db/migrations/0009_rollback.sql` for emergency use). Additive `0008` survives independently. |

Rollback (destructive): `ALTER TABLE recipe_ingredients DROP COLUMN display_quantity, DROP COLUMN display_unit; DROP TABLE unit_conversion_cache; ALTER TABLE recipes DROP COLUMN servings_confidence;`.

## Source references (research)

- [La Española Aceites — Tabla de medidas y equivalencias](https://www.laespanolaaceites.com/consejos-de-cocina/tabla-de-medidas-y-equivalencias-en-cocina-para-que-no-te-sientes-ni-una-pizca-de-tonto/)
- [Recetas La Masía — Equivalencias en cocina](https://www.recetaslamasia.es/tabla-de-equivalencias-en-la-cocina-tazas-cucharadas-y-gramos/)
- [MAPFRE Hogar — Tabla de equivalencia de medidas](https://www.hogar.mapfre.es/cocina/articulos/cuanto-es-una-cucharadita-tabla-medidas/)
- [OCU — Medidas caseras para cocinar sin balanza](https://www.ocu.org/alimentacion/comer-bien/noticias/medidas-para-cocinar)
- [Mi guía de cocina — Tabla de equivalencias](https://miguiadecocina.wordpress.com/tabla-de-equivalencias/)
- [Alvarigua — Abreviaturas en cocina](https://alvarigua.com/abreviaruras-en-la-cocina-que-todo-chef-debe-saber/)
- [Larousse Cocina — Ramillete / bouquet garni](https://laroussecocina.mx/palabra/ramillete-de-hierbas-o-bouquet-garni/)
- [Atadillo (Wikipedia)](https://es.wikipedia.org/wiki/Atadillo)
