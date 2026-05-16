# Units (display vs canonical) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Store ingredient quantities in two layers — a free-form `display_unit` text that preserves the author's wording and a canonical `(quantity, unit) ∈ (g|ml|u)` used by nutrition aggregation and scaling. Replace the hard-coded `CDA_ML`/`CDITA_ML` switch in `aggregate.ts` with a 29-term deterministic conversion table + LLM fallback cached in DB. Make the extractor always return `servings + servingsConfidence`, and let the UI scale abstract units culinarily (`1 1/2 cda`) or fall back to canonical when the math gets ugly.

**Architecture:** Pure shared modules under `packages/shared/src/units/` (vocabulary, normalize, resolve, format). Server-side resolver in `apps/api/src/services/unitResolver.ts` layers cache + LLM fallback on the shared resolver. Schema gets two new columns on `recipe_ingredients` + one column on `recipes` + a new `unit_conversion_cache` table. Migration is two-step: additive `0008` first, then `0009` tightens the enum after backfill confirms zero abstract rows remain.

**Tech Stack:** TypeScript, Drizzle ORM, Postgres, Vitest, Playwright (mobile-chromium), Anthropic SDK (Haiku for unit fallback). All UI strings in Spanish.

**Linked spec:** [docs/superpowers/specs/2026-05-16-units-display-canonical-design.md](../specs/2026-05-16-units-display-canonical-design.md)

---

## Slicing into PRs

Four PRs, each leaves master in a working state:

| PR | Title | What ships | User-observable? |
|---|---|---|---|
| 1 | `feat(units): vocabulary + shared resolver modules` | Schema migration `0008` (additive), `unit_conversion_cache` table, `packages/shared/src/units/*` + unit tests. No call sites wired. | No |
| 2 | `feat(units): backend resolver + extractor wiring` | `unitResolver.ts` (table → cache → LLM), `POST /units/resolve`, `persistRecipe` accepts display fields, extractor prompts updated (servings + abstract→canonical), `aggregateNutrition` reads canonical only (but old hardcoded constants remain as fallback). | API: yes (`/units/resolve`). User: no visible change. |
| 3 | `feat(units): /recipes/new form + ServingsScaler + Estimado badge` | Form selector for display unit with synonym lookup, ingredient row renders display + secondary canonical when scaled, `Estimado` badge on servings field, Playwright spec. Spec gate: `specs/recipes.md`. | Yes |
| 4 | `chore(units): backfill prod + tighten enum + delete dead code` | `scripts/migrateUnitsToDisplay.ts`, migration `0009` (enum tighten), `0009_rollback.sql`, delete `CDA_ML`/`CDITA_ML` from `aggregate.ts`. | No (data shape only) |

Each PR has its own deploy + smoke checkpoint at the end.

---

## File structure (all PRs)

**New files:**

- `packages/shared/src/units/vocabulary.ts` — 29 canonical terms + synonyms + factors
- `packages/shared/src/units/normalize.ts` — lowercase + NFD + accent strip
- `packages/shared/src/units/resolve.ts` — pure `resolveFromTable(input) → ResolveResult | null`
- `packages/shared/src/units/format.ts` — `formatScaled` + `isCulinaryClean` + `formatFraction` + `formatCanonical`
- `packages/shared/src/units/index.ts` — barrel re-export
- `packages/shared/src/units/__tests__/vocabulary.test.ts` — `vitest` lives at shared package boundary; if no shared vitest config exists, mirror tests in `apps/api/src/tests/`
- `apps/api/src/services/unitResolver.ts` — `resolveUnit(input) → ResolveResult` (DB cache + LLM)
- `apps/api/src/services/llmUnitFallback.ts` — Anthropic Haiku call + prompt + JSON parse
- `apps/api/src/routes/units.ts` — `POST /units/resolve`
- `apps/api/src/db/migrations/0008_units_display_split.sql` — additive schema
- `apps/api/src/db/migrations/0009_units_canonical_only_check.sql` — enum tighten
- `apps/api/src/db/migrations/0009_rollback.sql` — emergency reversal
- `apps/api/scripts/migrateUnitsToDisplay.ts` — backfill (dry-run by default)
- `apps/api/src/tests/unitsVocabulary.test.ts` — all 29 canonicals resolve via every synonym
- `apps/api/src/tests/unitsResolve.test.ts` — table resolver branches (volume/mass/discrete/symbolic, density present/absent)
- `apps/api/src/tests/unitsFormat.test.ts` — `formatFraction`, `formatCanonical`, `isCulinaryClean`
- `apps/api/src/tests/unitResolver.test.ts` — cache hit path, LLM fallback path with mocked client
- `apps/api/src/tests/migrateUnitsToDisplay.test.ts` — fixture-driven migration test
- `apps/api/src/tests/recipesUnitsRoute.smoke.ts` — POST /units/resolve smoke

**Modified files:**

- `packages/shared/src/constants/enums.ts` — `UNITS` collapses to `['g','ml','u']` (PR 4)
- `packages/shared/src/types/recipe.ts` — `recipeIngredientWriteSchema` gains `displayQuantity` / `displayUnit`; `ExtractedRecipe` / `Recipe` / `createRecipeSchema` gain `servingsConfidence`
- `packages/shared/src/recipeFormPayload.ts` — carry display fields through `buildRecipePayload`
- `packages/shared/src/index.ts` — re-export `units/*`
- `apps/api/src/db/schema.ts` — add columns to `recipeIngredients` + `recipes`, declare `unitConversionCache` table
- `apps/api/src/services/recipePersistence.ts` — write display fields, validate canonical
- `apps/api/src/services/recipeExtractor.ts` — accept extractor's display/canonical pair, default `servingsConfidence`
- `apps/api/src/services/providers/anthropic.ts` — updated `EXTRACTION_PROMPT` + `TEXT_EXTRACTION_PROMPT`
- `apps/api/src/services/nutrition/aggregate.ts` — delete `CDA_ML`/`CDITA_ML` + abstract switch branches (PR 4)
- `apps/api/src/routes/recipes.ts` — `toDetailRecipe` carries display + `servingsConfidence`; route registration for `/units/resolve`
- `apps/api/src/index.ts` — mount the new units router
- `apps/api/src/tests/recipeFormContract.test.ts` — extend with display fields + servingsConfidence
- `apps/api/src/tests/recipeFormLintContract.test.ts` — extend
- `apps/web/src/lib/api.ts` — typed helper for `POST /units/resolve` (if needed)
- `apps/web/src/hooks/useUnitResolver.ts` — new hook around `POST /units/resolve` (debounced)
- `apps/web/src/app/recipes/new/page.tsx` — `Estimado` badge, display-unit selector wired to resolver
- `apps/web/src/components/recipes/ServingsScaler.tsx` — propagate factor to a render helper
- `apps/web/src/components/recipes/IngredientAutocomplete.tsx` (or detail row component) — render display + secondary canonical
- `apps/web/e2e/recipe-create.spec.ts` — extend with display-unit scenario
- `specs/recipes.md` — Ingredient Model + AI Extraction sections (PR 3, spec gate)
- `specs/index.md` — keyword sweep for "display unit / canonical / servingsConfidence"

---

## PR 1 — Vocabulary + shared resolver modules

**Goal:** Land everything that has no behavior impact: schema migration `0008` (additive), the `unit_conversion_cache` table, the pure `packages/shared/src/units/*` modules, and unit tests. Master stays green; no API or UI change is visible.

### Task 1.1 — Drizzle migration `0008` (additive schema)

**Files:**
- Create: `apps/api/src/db/migrations/0008_units_display_split.sql`
- Modify: `apps/api/src/db/schema.ts` (add columns + new table)

- [ ] **Step 1: Edit `schema.ts` to add columns + the cache table**

Append to `recipes` table definition:
```ts
servingsConfidence: text('servings_confidence', { enum: ['explicit', 'estimated'] })
  .notNull()
  .default('explicit'),
```

Append to `recipeIngredients` table definition:
```ts
displayQuantity: real('display_quantity'),
displayUnit: text('display_unit'),
```

Add new table at end of file. Note the `ingredient_id` is nullable (generic cache entries have no specific ingredient) which means we **cannot** put it in a composite primary key — Postgres rejects NULL in PK columns. Instead we use a partial unique index built with `COALESCE` to a sentinel zero-UUID:

```ts
export const unitConversionCache = pgTable('unit_conversion_cache', {
  id: uuid('id').defaultRandom().primaryKey(),
  displayUnit: text('display_unit').notNull(),
  ingredientId: uuid('ingredient_id').references(() => ingredients.id, { onDelete: 'cascade' }),
  gramsPerUnit: real('grams_per_unit'),
  mlPerUnit: real('ml_per_unit'),
  source: text('source', { enum: ['llm', 'manual'] }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  unitIdx: index('idx_unit_cache_unit').on(t.displayUnit),
  // NULL-safe uniqueness: same display_unit can have one generic + N per-ingredient rows.
  uniqKey: uniqueIndex('idx_unit_cache_key').on(
    t.displayUnit,
    sql`COALESCE(${t.ingredientId}, '00000000-0000-0000-0000-000000000000'::uuid)`,
  ),
}))
```

**Update imports** at the top of `schema.ts`. The file already imports `pgTable, uuid, text, integer, real, boolean, timestamp, date, jsonb, uniqueIndex, index, check` — add `sql` from `drizzle-orm` (separate import line) if not already present. Do **not** add `primaryKey` — we use the single-column form `.primaryKey()` on `id`.

- [ ] **Step 2: Generate migration**

Run from repo root:
```bash
pnpm --filter @ona/api db:generate
```
Expected: a new `apps/api/src/db/migrations/0008_<random-slug>.sql` file is created plus a matching entry in `apps/api/src/db/migrations/meta/_journal.json`.

**Do NOT rename the generated SQL file by hand** — Drizzle's journal references it by name; renaming after generation orphans the journal entry and breaks `db:migrate`. If you want a more descriptive name, instead:

```bash
pnpm --filter @ona/api exec drizzle-kit drop   # interactive: pick 0008 to discard
# Then edit the schema if needed and re-run db:generate.
```

Or accept the generated slug — the journal stays consistent and the next migration (`0009`) still increments correctly.

- [ ] **Step 3: Inspect the generated SQL**

Verify the file has only `ADD COLUMN` + `CREATE TABLE`. **No** `DROP CONSTRAINT` or `ALTER COLUMN type`. If Drizzle generated extra DDL, edit to remove.

- [ ] **Step 4: Apply locally**

```bash
docker compose -f docker-compose.test.yml up -d postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/onatest pnpm --filter @ona/api exec drizzle-kit push --force
```
Expected: migration applies cleanly. Verify with:
```bash
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d onatest -c '\d recipe_ingredients' | grep display
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d onatest -c '\d recipes' | grep servings_confidence
PGPASSWORD=postgres psql -h localhost -p 5433 -U postgres -d onatest -c '\d unit_conversion_cache'
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/migrations/
git commit -m "feat(db): migration 0008 — display fields + servings confidence + unit cache table"
```

### Task 1.2 — Vocabulary module (TDD)

**Files:**
- Create: `packages/shared/src/units/vocabulary.ts`
- Create: `packages/shared/src/units/normalize.ts`
- Test: `apps/api/src/tests/unitsVocabulary.test.ts`

Per `@superpowers:test-driven-development`: failing test first.

- [ ] **Step 1: Write failing tests**

Create `apps/api/src/tests/unitsVocabulary.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { VOCABULARY, getTermBySynonym } from '@ona/shared'
import { normalizeTerm } from '@ona/shared'

describe('vocabulary count', () => {
  it('exports 29 canonical terms', () => {
    expect(VOCABULARY).toHaveLength(29)
  })
})

describe('synonym lookup', () => {
  it.each([
    ['cucharada', 'cda'],
    ['cucharada sopera', 'cda'],
    ['CUCHARADA', 'cda'],
    ['cucharadita', 'cdita'],
    ['cda.', 'cda'],
    ['cdta', 'cdita'],
    // NOTE: `c.s.` is intentionally NOT in any synonym list. It is contextually
    // ambiguous (cda when a number precedes it, otherwise cantidad suficiente).
    // The resolver handles this case explicitly before consulting the synonym
    // index; the vocabulary itself stays unambiguous.
    ['un puñado', 'puñado'],
    ['atadillo', 'manojo'],
    ['ramillete', 'manojo'],
    ['gotita', 'gota'],
    ['dientecillo', 'diente'],
    ['terron', 'terron'],     // accent-stripped
    ['terrón', 'terron'],
    ['una pizca', 'pizca'],
    ['al paladar', 'al gusto'],
    ['q.s.', 'al gusto'],
    ['c.n.', 'cantidad suficiente'],
  ])('"%s" resolves to canonical "%s"', (input, expected) => {
    const term = getTermBySynonym(normalizeTerm(input))
    expect(term?.canonical).toBe(expected)
  })

  it('unknown term returns undefined', () => {
    expect(getTermBySynonym(normalizeTerm('zarandajas'))).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run test, expect import failure**

```bash
cd apps/api && npx vitest run src/tests/unitsVocabulary.test.ts
```
Expected: FAIL — `@ona/shared` does not export `VOCABULARY`, `getTermBySynonym`, `normalizeTerm`.

- [ ] **Step 3: Implement `normalize.ts`**

Create `packages/shared/src/units/normalize.ts`:
```ts
export function normalizeTerm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
}
```

- [ ] **Step 4: Implement `vocabulary.ts`**

Create `packages/shared/src/units/vocabulary.ts` with the 29 terms from the spec's Vocabulary table. Use the structure:
```ts
import { normalizeTerm } from './normalize.js'

export interface UnitFactor {
  gramsPerUnit?: number
  mlPerUnit?: number
  perUnitWeight?: boolean
  symbolic?: boolean
}

export interface VocabularyTerm {
  canonical: string
  synonyms: readonly string[]
  factor: UnitFactor
  family: 'volume' | 'mass' | 'discrete' | 'symbolic'
}

// Note: c.s. is intentionally absent from every synonym list — it's
// contextually ambiguous and the resolver disambiguates before consulting
// the index.
export const VOCABULARY: readonly VocabularyTerm[] = [
  // ── Volumetric (13) ──
  { canonical: 'gota',          synonyms: ['gota','gotita','gotas','gotitas'],
    factor: { mlPerUnit: 0.05 }, family: 'volume' },
  { canonical: 'cdita',         synonyms: ['cdita','cdta','cucharadita','cucharaditas','cucharadita de cafe','cucharadita de te','cuchara de cafe','c.p.','c/p','tsp'],
    factor: { mlPerUnit: 5 }, family: 'volume' },
  { canonical: 'cda postre',    synonyms: ['cda postre','cucharada de postre','cuchara de postre'],
    factor: { mlPerUnit: 10 }, family: 'volume' },
  { canonical: 'cda',           synonyms: ['cda','cda.','cucharada','cucharadas','cucharada sopera','cuchara sopera','cuchs','tbsp'],
    factor: { mlPerUnit: 15 }, family: 'volume' },
  { canonical: 'chorrito',      synonyms: ['chorrito','chorrin','un chorrito'],
    factor: { mlPerUnit: 10 }, family: 'volume' },
  { canonical: 'chorro',        synonyms: ['chorro','chorreton','buen chorro'],
    factor: { mlPerUnit: 30 }, family: 'volume' },
  { canonical: 'copa licor',    synonyms: ['copa licor','copita','copa pequena'],
    factor: { mlPerUnit: 50 }, family: 'volume' },
  { canonical: 'tacita',        synonyms: ['tacita','tacita de cafe','taza de cafe'],
    factor: { mlPerUnit: 100 }, family: 'volume' },
  { canonical: 'copa vino',     synonyms: ['copa vino','copa de vino','vaso de vino','vaso pequeno','copa'],
    factor: { mlPerUnit: 100 }, family: 'volume' },
  { canonical: 'taza desayuno', synonyms: ['taza desayuno','taza de te','taza chica'],
    factor: { mlPerUnit: 150 }, family: 'volume' },
  { canonical: 'vaso',          synonyms: ['vaso','vaso de agua','vaso estandar','vaso normal'],
    factor: { mlPerUnit: 200 }, family: 'volume' },
  { canonical: 'taza',          synonyms: ['taza','cup','taza americana','taza reposteria'],
    factor: { mlPerUnit: 240 }, family: 'volume' },
  { canonical: 'tazon',         synonyms: ['tazon','bowl','tazon de desayuno'],
    factor: { mlPerUnit: 250 }, family: 'volume' },

  // ── Mass (4) ──
  { canonical: 'pizca',         synonyms: ['pizca','pizquita','una pizca','pinch'],
    factor: { gramsPerUnit: 0.5 }, family: 'mass' },
  { canonical: 'pellizco',      synonyms: ['pellizco','pellizquito','dash'],
    factor: { gramsPerUnit: 2 }, family: 'mass' },
  { canonical: 'puñado',        synonyms: ['punado','puno','punadito','handful'],
    factor: { gramsPerUnit: 30 }, family: 'mass' },
  { canonical: 'manojo',        synonyms: ['manojo','atadillo','ramillete','bouquet','bouquet garni'],
    factor: { gramsPerUnit: 100 }, family: 'mass' },

  // ── Discrete (10) ──
  { canonical: 'diente',        synonyms: ['diente','dientecillo','diente de ajo'],
    factor: { perUnitWeight: true, gramsPerUnit: 5 }, family: 'discrete' },
  { canonical: 'terron',        synonyms: ['terron','cubito','cubito de azucar','sugar cube'],
    factor: { perUnitWeight: true, gramsPerUnit: 6 }, family: 'discrete' },
  { canonical: 'nuez',          synonyms: ['nuez','nuez de mantequilla'],
    factor: { perUnitWeight: true, gramsPerUnit: 20 }, family: 'discrete' },
  { canonical: 'avellana',      synonyms: ['avellana','avellana de mantequilla'],
    factor: { perUnitWeight: true, gramsPerUnit: 5 }, family: 'discrete' },
  { canonical: 'loncha',        synonyms: ['loncha','lonja','tajada','feta','slice'],
    factor: { perUnitWeight: true, gramsPerUnit: 40 }, family: 'discrete' },
  { canonical: 'rebanada',      synonyms: ['rebanada','rebanadita','rodaja de pan'],
    factor: { perUnitWeight: true, gramsPerUnit: 30 }, family: 'discrete' },
  { canonical: 'hoja',          synonyms: ['hoja','hojita','hojas','hojitas'],
    factor: { perUnitWeight: true, gramsPerUnit: 0.2 }, family: 'discrete' },
  { canonical: 'ramita',        synonyms: ['ramita','ramito','rama','sprig'],
    factor: { perUnitWeight: true, gramsPerUnit: 1.5 }, family: 'discrete' },
  { canonical: 'rodaja',        synonyms: ['rodaja','ruedita','rodajas','aro','aros'],
    factor: { perUnitWeight: true, gramsPerUnit: 12 }, family: 'discrete' },
  { canonical: 'unidad',        synonyms: ['unidad','unidades','u','ud','ud.','pieza','piezas','pza','pieces'],
    factor: { perUnitWeight: true }, family: 'discrete' },

  // ── Symbolic (2) ──
  { canonical: 'al gusto',      synonyms: ['al gusto','a gusto','al paladar','q.s.','to taste'],
    factor: { symbolic: true }, family: 'symbolic' },
  { canonical: 'cantidad suficiente', synonyms: ['cantidad suficiente','c/s','c.n.','cantidad necesaria'],
    factor: { symbolic: true }, family: 'symbolic' },
]

const SYNONYM_INDEX = new Map<string, VocabularyTerm>()
for (const term of VOCABULARY) {
  for (const syn of term.synonyms) {
    const key = normalizeTerm(syn)
    if (SYNONYM_INDEX.has(key)) {
      throw new Error(`Duplicate synonym "${syn}" — already maps to ${SYNONYM_INDEX.get(key)!.canonical}`)
    }
    SYNONYM_INDEX.set(key, term)
  }
}

export function getTermBySynonym(normalizedSynonym: string): VocabularyTerm | undefined {
  return SYNONYM_INDEX.get(normalizedSynonym)
}
```

- [ ] **Step 5: Re-export from shared index**

Edit `packages/shared/src/index.ts`:
```ts
export { normalizeTerm } from './units/normalize.js'
export { VOCABULARY, getTermBySynonym } from './units/vocabulary.js'
export type { VocabularyTerm, UnitFactor } from './units/vocabulary.js'
```

- [ ] **Step 6: Build shared + run tests**

```bash
pnpm --filter @ona/shared build
cd apps/api && npx vitest run src/tests/unitsVocabulary.test.ts
```
Expected: PASS for all cases. The 29-term `expect(VOCABULARY).toHaveLength(29)` assertion + all synonym lookups should be green.

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/units/ packages/shared/src/index.ts apps/api/src/tests/unitsVocabulary.test.ts
git commit -m "feat(units): vocabulary + normalize modules (29 canonical terms, TDD)"
```

### Task 1.3 — Resolve module (TDD)

**Files:**
- Create: `packages/shared/src/units/resolve.ts`
- Test: `apps/api/src/tests/unitsResolve.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { resolveFromTable } from '@ona/shared'

describe('resolveFromTable — volumetric', () => {
  it('cda without density returns ml', () => {
    expect(resolveFromTable({ displayQuantity: 1, displayUnit: 'cda' })).toEqual({
      canonicalQuantity: 15, canonicalUnit: 'ml', source: 'table',
    })
  })
  it('cda with density converts to grams', () => {
    expect(resolveFromTable({
      displayQuantity: 1, displayUnit: 'cda',
      ingredient: { name: 'aceite', density: 0.92 },
    })).toEqual({ canonicalQuantity: 13.8, canonicalUnit: 'g', source: 'table' })
  })
})

describe('resolveFromTable — mass', () => {
  it('pizca → 0.5g', () => {
    expect(resolveFromTable({ displayQuantity: 1, displayUnit: 'pizca' })).toEqual({
      canonicalQuantity: 0.5, canonicalUnit: 'g', source: 'table',
    })
  })
  it('puñado × 2 → 60g', () => {
    expect(resolveFromTable({ displayQuantity: 2, displayUnit: 'puñado' })).toEqual({
      canonicalQuantity: 60, canonicalUnit: 'g', source: 'table',
    })
  })
})

describe('resolveFromTable — discrete', () => {
  it('uses ingredient.unitWeight when present', () => {
    expect(resolveFromTable({
      displayQuantity: 2, displayUnit: 'diente',
      ingredient: { name: 'ajo', unitWeight: 4 },   // small clove
    })).toEqual({ canonicalQuantity: 8, canonicalUnit: 'g', source: 'table' })
  })
  it('falls back to term default when unitWeight absent', () => {
    expect(resolveFromTable({
      displayQuantity: 2, displayUnit: 'diente',
      ingredient: { name: 'ajo' },
    })).toEqual({ canonicalQuantity: 10, canonicalUnit: 'g', source: 'table' })
  })
})

describe('resolveFromTable — symbolic', () => {
  it('al gusto → 0g', () => {
    expect(resolveFromTable({ displayQuantity: 1, displayUnit: 'al gusto' })).toEqual({
      canonicalQuantity: 0, canonicalUnit: 'g', source: 'table',
    })
  })
})

describe('resolveFromTable — unknown', () => {
  it('returns null', () => {
    expect(resolveFromTable({ displayQuantity: 1, displayUnit: 'zarandaja' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run, expect failure**

```bash
npx vitest run src/tests/unitsResolve.test.ts
```
Expected: FAIL — `resolveFromTable` is not exported.

- [ ] **Step 3: Implement `resolve.ts`**

```ts
import { getTermBySynonym } from './vocabulary.js'
import { normalizeTerm } from './normalize.js'

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

export function resolveFromTable(input: ResolveInput): ResolveResult | null {
  const term = getTermBySynonym(normalizeTerm(input.displayUnit))
  if (!term) return null
  const { factor } = term
  if (factor.symbolic) {
    return { canonicalQuantity: 0, canonicalUnit: 'g', source: 'table' }
  }
  if (factor.mlPerUnit != null) {
    const ml = input.displayQuantity * factor.mlPerUnit
    if (input.ingredient?.density != null) {
      return { canonicalQuantity: round1(ml * input.ingredient.density), canonicalUnit: 'g', source: 'table' }
    }
    return { canonicalQuantity: round1(ml), canonicalUnit: 'ml', source: 'table' }
  }
  if (factor.perUnitWeight) {
    const gramsPerUnit = input.ingredient?.unitWeight ?? factor.gramsPerUnit ?? 0
    return { canonicalQuantity: round1(input.displayQuantity * gramsPerUnit), canonicalUnit: 'g', source: 'table' }
  }
  if (factor.gramsPerUnit != null) {
    return { canonicalQuantity: round1(input.displayQuantity * factor.gramsPerUnit), canonicalUnit: 'g', source: 'table' }
  }
  return null
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}
```

- [ ] **Step 4: Re-export from shared index**

```ts
export { resolveFromTable } from './units/resolve.js'
export type { ResolveInput, ResolveResult } from './units/resolve.js'
```

- [ ] **Step 5: Build shared + run tests**

```bash
pnpm --filter @ona/shared build
cd apps/api && npx vitest run src/tests/unitsResolve.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/units/resolve.ts packages/shared/src/index.ts apps/api/src/tests/unitsResolve.test.ts
git commit -m "feat(units): pure table resolver (volume/mass/discrete/symbolic, TDD)"
```

### Task 1.4 — Format module (TDD)

**Files:**
- Create: `packages/shared/src/units/format.ts`
- Test: `apps/api/src/tests/unitsFormat.test.ts`

- [ ] **Step 1: Failing tests**

```ts
import { describe, it, expect } from 'vitest'
import { formatFraction, formatCanonical, isCulinaryClean, formatScaled } from '@ona/shared'

describe('formatFraction', () => {
  it.each([
    [1, '1'], [2, '2'], [1.5, '1 1/2'], [0.5, '1/2'],
    [0.25, '1/4'], [1.25, '1 1/4'], [1.33, '1 1/3'], [2.66, '2 2/3'],
    [0.75, '3/4'],
  ])('%f → "%s"', (v, expected) => {
    expect(formatFraction(v)).toBe(expected)
  })
})

describe('formatCanonical', () => {
  it.each([
    [0.5, 'g', '0.5 g'],
    [22, 'ml', '22 ml'],
    [22.7, 'ml', '23 ml'],
    [237, 'g', '235 g'],
    [4.5, 'g', '4.5 g'],
    [1, 'u', '1 u'],
  ])('%f %s → "%s"', (qty, unit, expected) => {
    expect(formatCanonical(qty, unit as 'g' | 'ml' | 'u')).toBe(expected)
  })
})

describe('isCulinaryClean', () => {
  it.each([
    [1, true],
    [2, true],
    [1.5, true],
    [1.33, true],
    [2.75, true],
    [1.47, false],
    [1.18, false],
  ])('%f → clean=%s', (v, expected) => {
    expect(isCulinaryClean(v).clean).toBe(expected)
  })
})

describe('formatScaled', () => {
  it('clean factor keeps display + secondary canonical', () => {
    expect(formatScaled({
      displayQuantity: 1.5, displayUnit: 'cda',
      canonicalQuantity: 22.5, canonicalUnit: 'ml', factor: 1.5,
    })).toEqual({ primary: '1 1/2 cda', secondary: '23 ml' })
  })
  it('rare factor drops display → canonical only', () => {
    expect(formatScaled({
      displayQuantity: 1.47, displayUnit: 'cda',
      canonicalQuantity: 22.05, canonicalUnit: 'ml', factor: 1.47,
    })).toEqual({ primary: '22 ml' })
  })
})
```

- [ ] **Step 2: Run, expect failure**

- [ ] **Step 3: Implement `format.ts`** per the spec's Format module section.

- [ ] **Step 4: Re-export from shared index**

```ts
export { formatScaled, formatFraction, formatCanonical, isCulinaryClean } from './units/format.js'
```

- [ ] **Step 5: Run tests, expect pass**

- [ ] **Step 6: Commit**

```bash
git commit -m "feat(units): format module (fractions + canonical + scaled, TDD)"
```

### Task 1.5 — PR 1 checkpoint

- [ ] **Run full API test suite**

```bash
cd apps/api && pnpm test
```
Expected: all green (including the 3 new test files + existing 311+ tests).

- [ ] **Push + watch CI**

```bash
git push origin <branch>
gh run watch --exit-status
```

- [ ] **Open PR with body**

```
## Summary
- Schema migration 0008 (additive): display columns + servings confidence + unit cache table
- packages/shared/src/units/: vocabulary (29 terms), normalize, resolve, format
- Unit tests cover every term, every branch, fractions, canonical rounding

## Test plan
- [x] vitest passes locally
- [x] CI green
- [ ] Spec gate N/A — no user-visible behavior yet

## Out of scope (next PRs)
- Backend wiring (PR 2)
- UI integration (PR 3)
- Backfill + enum tighten (PR 4)
```

- [ ] **Merge after green CI**, then deploy: `railway up --service ona-api --detach`

- [ ] **Smoke**: hit `/health` and confirm migration applied (`psql … -c '\d unit_conversion_cache'`).

---

## PR 2 — Backend resolver + extractor wiring

**Goal:** Server can resolve free-form units (table → cache → LLM) via `POST /units/resolve`. `persistRecipe` accepts and stores display fields. Extractor prompts return `servings + servingsConfidence` and pair `display` + `canonical` per ingredient. `aggregateNutrition` still uses the old switch (we don't break running code; that cleanup is in PR 4).

### Task 2.1 — Unit resolver service with cache + LLM fallback

**Files:**
- Create: `apps/api/src/services/unitResolver.ts`
- Create: `apps/api/src/services/llmUnitFallback.ts`
- Test: `apps/api/src/tests/unitResolver.test.ts`

- [ ] **Step 1: Failing test for cache path**

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { resolveUnit, _setLlmClient } from '../services/unitResolver.js'
import { db } from '../db/connection.js'
import { unitConversionCache } from '../db/schema.js'

describe('resolveUnit', () => {
  beforeEach(async () => {
    await db.delete(unitConversionCache)
  })

  it('returns from table for "cda" without hitting cache or LLM', async () => {
    const llmSpy = vi.fn()
    _setLlmClient({ call: llmSpy })
    const result = await resolveUnit({ displayQuantity: 2, displayUnit: 'cda' })
    expect(result.source).toBe('table')
    expect(result.canonicalQuantity).toBe(30)
    expect(llmSpy).not.toHaveBeenCalled()
  })

  it('falls back to LLM for unknown term, caches it, second call hits cache', async () => {
    const llmSpy = vi.fn().mockResolvedValue({ gramsPerUnit: 8, mlPerUnit: null, rationale: 'rodaja ≈ 8g' })
    _setLlmClient({ call: llmSpy })
    const first = await resolveUnit({
      displayQuantity: 1, displayUnit: 'rodajita generosa',
      ingredient: { id: 'ing-1', name: 'limón' },
    })
    expect(first.source).toBe('llm')
    expect(first.canonicalQuantity).toBe(8)
    const second = await resolveUnit({
      displayQuantity: 1, displayUnit: 'rodajita generosa',
      ingredient: { id: 'ing-1', name: 'limón' },
    })
    expect(second.source).toBe('cache')
    expect(llmSpy).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Implement `llmUnitFallback.ts`**

Use the prompt from the spec. Module exports a `callLlmUnitFallback(input)` function. Use the existing `AnthropicProvider` pattern; this fallback uses the cheaper Haiku model.

- [ ] **Step 3: Implement `unitResolver.ts`** with the three-layer fallback (table → DB cache → LLM → write cache). Export `_setLlmClient` for tests.

- [ ] **Step 4: Run tests, expect pass**

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(units): server resolver with table → cache → LLM fallback (TDD)"
```

### Task 2.2 — `POST /units/resolve` route

**Files:**
- Create: `apps/api/src/routes/units.ts`
- Modify: `apps/api/src/index.ts` (mount the router)
- Create: `apps/api/src/tests/unitsRoute.smoke.ts`

- [ ] **Step 1: Smoke test (uses booted API + registered user — runs in CI smoke job)**

```ts
import { describe, it, expect } from 'vitest'

const API = process.env.API_URL ?? 'http://localhost:8765'
const TOKEN = process.env.SMOKE_USER_TOKEN

describe('POST /units/resolve', () => {
  it.skipIf(!TOKEN)('table hit: 1 cda → 15 ml', async () => {
    const r = await fetch(`${API}/units/resolve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ displayQuantity: 1, displayUnit: 'cda' }),
    })
    expect(r.status).toBe(200)
    const body = await r.json()
    expect(body).toMatchObject({ canonicalQuantity: 15, canonicalUnit: 'ml', source: 'table' })
  })

  it.skipIf(!TOKEN)('unknown term resolves and caches', async () => {
    const url = `${API}/units/resolve`
    // ingredientId is optional — omit it for generic resolutions
    const body = { displayQuantity: 1, displayUnit: 'rodajita generosa' }
    const r1 = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })
    const j1 = await r1.json()
    expect(['llm', 'cache']).toContain(j1.source)
    const r2 = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify(body) })
    const j2 = await r2.json()
    expect(j2.source).toBe('cache')
  })
})
```

- [ ] **Step 2: Implement route** with zod validation:

```ts
const schema = z.object({
  displayQuantity: z.number().min(0),
  displayUnit: z.string().min(1).max(40),
  // Accept both `null` and omission — older clients may send either.
  ingredientId: z.string().uuid().nullable().optional(),
})
```

The route handler treats `null` and `undefined` identically (both mean "no specific ingredient context").

- [ ] **Step 3: Mount in `apps/api/src/index.ts`**

- [ ] **Step 4: Run smoke locally + commit**

```bash
git commit -m "feat(units): POST /units/resolve endpoint with smoke tests"
```

### Task 2.3 — Extend zod types in `@ona/shared`

**Files:**
- Modify: `packages/shared/src/types/recipe.ts`
- Modify: `packages/shared/src/recipeFormPayload.ts`
- Modify: `apps/api/src/tests/recipeFormContract.test.ts` (extend)

- [ ] **Step 1: Extend contract test to assert new fields round-trip**

Add cases to `recipeFormContract.test.ts`:
- Payload with `displayQuantity: 1, displayUnit: 'cda'` passes `createRecipeSchema`.
- Payload without display fields still passes (nullable optional).
- `servingsConfidence` defaults to `'explicit'` when omitted.

- [ ] **Step 2: Run tests, expect failures**

- [ ] **Step 3: Add fields to `recipeIngredientWriteSchema`**

```ts
const recipeIngredientWriteSchema = z.object({
  // …existing
  displayQuantity: z.number().min(0).nullable().optional(),
  displayUnit: z.string().max(40).nullable().optional(),
  // …existing
})

export const createRecipeSchema = z.object({
  // …existing
  servingsConfidence: z.enum(['explicit', 'estimated']).default('explicit'),
})
```

- [ ] **Step 4: Audit existing consumers of `ExtractedRecipe.servings`**

Before tightening the type, find every reader that handles the nullable case:

```bash
grep -rn "extracted\.servings\|\.servings ?? \|extractedRecipe\.servings" apps/ packages/ | grep -v "node_modules"
```

For each hit, ensure the consumer is OK with a guaranteed `number`. The known sites are:
- `apps/api/src/routes/recipes.ts` — extract-from-image / extract-from-url handlers
- `apps/web/src/app/recipes/new/page.tsx` — `handlePhotoExtracted` and URL importer
- `apps/web/src/components/recipes/PhotoRecipeUpload.tsx`
- `apps/web/src/components/recipes/UrlRecipeImport.tsx`

Anywhere the code reads `extracted.servings ?? <fallback>`, drop the fallback (the field is now always present).

- [ ] **Step 5: Extend `ExtractedRecipe` + `Recipe`**

```ts
export interface ExtractedRecipe {
  // …
  servings: number  // no longer nullable
  servingsConfidence: 'explicit' | 'estimated'
}

export interface Recipe {
  // …
  servingsConfidence: 'explicit' | 'estimated'
}
```

- [ ] **Step 6: Extend `buildRecipePayload`** to pass through display fields from the form state interface.

- [ ] **Step 7: Run tests, expect pass + commit**

```bash
git commit -m "feat(shared): display fields + servingsConfidence in zod schemas (TDD contract test)"
```

### Task 2.4 — `persistRecipe` writes display fields

**Files:**
- Modify: `apps/api/src/services/recipePersistence.ts`
- Modify: `apps/api/src/tests/recipesRoute.smoke.ts` (extend if exists; else add new case)

- [ ] **Step 1: Add a test case** that posts a recipe with `{displayQuantity, displayUnit, quantity, unit}` and verifies the GET returns the same display fields.

- [ ] **Step 2: Update `persistRecipe`**'s ingredient insert to include `display_quantity` + `display_unit`. Update the `RecipeWriteInput` type if needed.

- [ ] **Step 3: Update `toDetailRecipe`** in `apps/api/src/routes/recipes.ts` to read + return the display fields + `servingsConfidence`.

- [ ] **Step 4: Run smoke, expect pass + commit**

```bash
git commit -m "feat(api): persistRecipe + toDetailRecipe carry display fields + servingsConfidence"
```

### Task 2.5 — Extractor prompts return servings + confidence + display/canonical pair

**Files:**
- Modify: `apps/api/src/services/providers/anthropic.ts` (`EXTRACTION_PROMPT`, `TEXT_EXTRACTION_PROMPT`)
- Modify: `apps/api/src/services/recipeExtractor.ts` (parse the new shape)

- [ ] **Step 1: Update both prompts** per the spec's Servings deduction section + adapt the JSON shape:

```json
{
  "servings": 4,
  "servingsConfidence": "explicit",
  "ingredients": [
    { "name": "aceite de oliva virgen",
      "display": { "quantity": 1, "unit": "cda" },
      "canonical": { "quantity": 15, "unit": "ml" } },
    …
  ],
  "steps": [...]
}
```

For each ingredient the LLM returns both. If the recipe text doesn't use abstract units, `display` is null.

- [ ] **Step 2: Update parser** in `anthropic.ts` to read the new fields and pass them upward. Validate `servings ∈ [1, 12]`; clamp + force `'estimated'` if not.

- [ ] **Step 3: Update `recipeExtractor.matchIngredients`** to preserve display fields through ingredient matching.

- [ ] **Step 4: Smoke test the extractor.** Add fixture `apps/api/src/tests/fixtures/recipe-with-abstract-units.txt` containing 1-2 paragraphs of Spanish recipe prose that mixes "1 cda de aceite", "una pizca de sal", and a numeric explicit ingredient. Use `AnthropicProvider.extractRecipeFromText` against it (the smoke runs only when `ANTHROPIC_API_KEY` is set, otherwise `it.skipIf`). Assert the result has:
  - `servings` populated and `servingsConfidence` set
  - At least one ingredient with both `display.{quantity,unit}` and `canonical.{quantity,unit}` set
  - `display.unit` is one of the 29 canonical synonyms (normalize before assertion)

- [ ] **Step 5: Commit**

```bash
git commit -m "feat(extractor): prompts return servings confidence + display/canonical pairs"
```

### Task 2.6 — PR 2 checkpoint

- [ ] Run full API tests + push + watch CI.
- [ ] Merge + deploy `ona-api`.
- [ ] Smoke against prod:
  - `POST /units/resolve` with `{displayQuantity:1, displayUnit:'cda'}` returns 15 ml.
  - Create a recipe via `POST /recipes` with display fields, GET it back, confirm fields round-trip.

---

## PR 3 — Form + UI + spec gate

**Goal:** the human can pick "cda", "puñado", etc. in `/recipes/new`, see `Estimado` badge when relevant, and the scaler shows `1 1/2 cda (23 ml)` style output. Spec gate updates `specs/recipes.md`.

### Task 3.1 — `useUnitResolver` hook

**Files:**
- Create: `apps/web/src/hooks/useUnitResolver.ts`

- [ ] React-query `useMutation` around `POST /units/resolve`. Debounce 250 ms. Cache per-form-instance via `useState`.

- [ ] Unit-test against a mocked `fetch`. Test file: `apps/web/src/hooks/useUnitResolver.test.ts`. Note: `apps/web/` does **not** currently have a vitest config — verify with `ls apps/web/vitest.config.*`. If missing, either:
  - Add a minimal `apps/web/vitest.config.ts` (mirroring `apps/api/vitest.config.ts`) and a `"test": "vitest run"` script in `apps/web/package.json`, OR
  - Skip the hook unit test for v1 and rely on the Playwright spec (Task 3.5) to exercise the resolver round-trip.

### Task 3.2 — Display-unit picker in ingredient rows

**Files:**
- Modify: `apps/web/src/app/recipes/new/page.tsx`

- [ ] Each row now has: ingredient picker | quantity | **display unit selector** | unit (canonical, read-only when display is present).

- [ ] The display-unit selector shows the 29 canonical labels + lets the user type free-form. On selection or blur, fire `useUnitResolver`, populate canonical `(quantity, unit)` from the result.

- [ ] If user picks a known canonical unit (`g`, `ml`, `u`) directly, leave `displayQuantity` / `displayUnit` null.

### Task 3.3 — `Estimado` badge + flip-on-edit

**Files:**
- Modify: `apps/web/src/app/recipes/new/page.tsx`

- [ ] Render badge per the spec when `servingsConfidence === 'estimated'`.
- [ ] `onChange` of the servings input sets `servingsConfidence = 'explicit'`.

### Task 3.4 — `ServingsScaler` propagates factor; ingredient row renders `formatScaled`

**Files:**
- Modify: `apps/web/src/components/recipes/ServingsScaler.tsx`
- Modify (or create): `apps/web/src/components/recipes/detail/IngredientRow.tsx`

- [ ] Detail page renders each ingredient through `formatScaled({ displayQuantity, displayUnit, canonicalQuantity, canonicalUnit, factor })`. Show `primary` as the main label, `secondary` as muted small text below.

### Task 3.5 — Playwright spec

**Files:**
- Modify: `apps/web/e2e/recipe-create.spec.ts`

- [ ] Extend the happy-path spec: pick "cda" from the new display selector, set quantity 1, submit, verify the GET response shows `display_unit='cda', display_quantity=1, quantity=15, unit='ml'`.

- [ ] Add a second spec: scale a saved recipe via `ServingsScaler` to 1.5× and assert that the ingredient row shows `1 1/2 cda` (or fallback to canonical for the rare-factor case).

### Task 3.6 — Spec gate

**Files:**
- Modify: `specs/recipes.md` — Ingredient Model section explains display vs canonical; AI Extraction section explains `servings_confidence`.
- Modify: `specs/index.md` — keywords: "display unit", "canonical", "servings confidence", "cucharada", "puñado".

### Task 3.7 — PR 3 checkpoint

- [ ] Local run: `pnpm --filter @ona/web e2e` passes.
- [ ] Push + watch CI (recipe-create + new units specs).
- [ ] Merge + deploy `ona-web` (and `ona-api` if anything touched server).
- [ ] Manual prod smoke: create a recipe with "1 cda", scale it to 2x and 1.5x, eyeball display.

---

## PR 4 — Backfill + enum tighten + dead-code removal

**Goal:** migrate the 56 system recipes + any user recipes from abstract units to (canonical + display) form. After backfill confirms zero abstract rows remain, ship migration `0009` to tighten the enum, then delete the dead constants in `aggregate.ts`.

### Task 4.1 — Backfill script (TDD)

**Files:**
- Create: `apps/api/scripts/migrateUnitsToDisplay.ts`
- Test: `apps/api/src/tests/migrateUnitsToDisplay.test.ts`

- [ ] **Step 1: Unit test with fixture rows** — feed a synthetic recipe with `unit IN ('cda','cdita','pizca','al_gusto')` and an ingredient with `density=0.92`. Assert post-migration row has correct canonical + display fields. Assert idempotent on a second run.

- [ ] **Step 2: Implement script** following the pattern of `dedupSystemRecipes.ts`: dry-run by default, `--execute` flag, WARN logging for unresolvable rows, idempotent.

- [ ] **Step 3: Tests pass + commit**

```bash
git commit -m "chore(units): backfill script migrateUnitsToDisplay (dry-run by default)"
```

### Task 4.2 — Run backfill in prod

- [ ] **Identify the Postgres service name** on Railway (it may not be the literal "Postgres" — check `docs/deploy.md` and `railway service` output):

```bash
railway service     # interactive: pick the project's Postgres service
# OR list services and look for the postgres one
railway list
```

- [ ] Local dry-run against prod DB (substitute the actual service name from above for `<pg-service>`):

```bash
PROD_DB=$(railway variables --service <pg-service> --kv | grep ^DATABASE_PUBLIC_URL= | cut -d= -f2-)
cd apps/api && DATABASE_URL="$PROD_DB" npx tsx scripts/migrateUnitsToDisplay.ts
```

- [ ] Inspect output. If any WARN ("row R has unit cda but ingredient X lacks density"), decide:
  - Add density to that ingredient via the curator panel, OR
  - Convert that specific row manually with an estimated density.

- [ ] Re-run dry-run until zero warnings.

- [ ] **Execute**:

```bash
DATABASE_URL="$PROD_DB" npx tsx scripts/migrateUnitsToDisplay.ts --execute
```

- [ ] Verify with `psql` query:

```bash
psql "$PROD_DB" -c "select count(*) from recipe_ingredients where unit not in ('g','ml','u');"
```
Expected: 0.

### Task 4.3 — Migration `0009` (enum tighten)

**Files:**
- Create: `apps/api/src/db/migrations/0009_units_canonical_only_check.sql`
- Create: `apps/api/src/db/migrations/0009_rollback.sql`
- Modify: `packages/shared/src/constants/enums.ts` (`UNITS = ['g','ml','u']`)

- [ ] Migration SQL:

```sql
ALTER TABLE recipe_ingredients DROP CONSTRAINT IF EXISTS recipe_ingredients_unit_check;
ALTER TABLE recipe_ingredients
  ADD CONSTRAINT recipe_ingredients_unit_check CHECK (unit IN ('g','ml','u'));
```

- [ ] Rollback SQL (kept in repo, not applied automatically):

```sql
ALTER TABLE recipe_ingredients DROP CONSTRAINT recipe_ingredients_unit_check;
ALTER TABLE recipe_ingredients
  ADD CONSTRAINT recipe_ingredients_unit_check
  CHECK (unit IN ('g','ml','u','cda','cdita','pizca','al_gusto'));
```

- [ ] Update `enums.ts`, regenerate types, fix any TS compile errors that surface.

- [ ] **Grep for stragglers** — find every consumer that pattern-matches on the dropped literals:

```bash
grep -rn "'cda'\|'cdita'\|'pizca'\|'al_gusto'" apps/api/src apps/web/src packages/shared/src \
  --include="*.ts" --include="*.tsx" | grep -v "test\.ts\|\.test\.tsx\|migrations/"
```

Each hit is either: (a) dead code → delete; (b) a place that needs to read `displayUnit` instead → fix. Run `pnpm tsc --noEmit` everywhere as the final safety net.

- [ ] Deploy `ona-api` — migration `0009` applies automatically via `db:migrate`.

- [ ] Verify constraint with `psql`.

### Task 4.4 — Delete dead code in `aggregate.ts` AND `recipeScaler.ts`

**Files:**
- Modify: `apps/api/src/services/nutrition/aggregate.ts`
- Modify: `apps/api/src/services/recipeScaler.ts`
- Modify: `apps/api/src/tests/nutritionAggregate.test.ts` (drop tests covering the dead branches)
- Modify: `apps/api/src/tests/recipeScaler.test.ts` (likewise)

After the `UNITS` enum narrows in Task 4.3, TypeScript will flag every comparison against `'cda'`, `'cdita'`, `'pizca'`, `'al_gusto'` as impossible (`This condition will always return 'false'`). Two files in particular have these patterns:

**`aggregate.ts`:**
- Remove module-level constants `CDA_ML = 15` and `CDITA_ML = 5`.
- Remove the `case 'cda' | 'cdita' | 'pizca' | 'al_gusto'` branches of the unit switch.

**`recipeScaler.ts`:**
- Remove `const NON_SCALING = new Set(['pizca', 'al_gusto'])` (near line 77) and the `if (NON_SCALING.has(...))` short-circuit.
- Remove `if (unit === 'pizca' || unit === 'al_gusto')` branches (near line 112).
- Remove `if (unit === 'cda' || unit === 'cdita')` branches (near line 130). Scaling on canonical `g | ml | u` is unconditionally linear after this point.

- [ ] **Step 1: Delete the constants + dead branches** in both files.

- [ ] **Step 2: Update tests.** Any test passing `unit: 'cda'` now feeds canonical instead. If a test was specifically about the old abstract behavior, delete it (it covered dead code).

- [ ] **Step 3: Full TS + test sweep** across all workspaces:

```bash
pnpm -r exec tsc --noEmit
pnpm -r test
```

Expected: zero TS errors, all tests green. If `tsc` flags `recipeScaler.ts` or `aggregate.ts` for `'This condition will always return false'`, that's a leftover dead branch — delete.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore(nutrition,scaler): delete dead abstract-unit branches (canonical only)"
```

### Task 4.5 — PR 4 checkpoint + spec finalization

- [ ] Full workspace type-check: `pnpm -r exec tsc --noEmit` — zero errors. This catches anything narrowed-`UNITS` would break that the earlier per-file edits missed.
- [ ] CI green.
- [ ] Spec: update Todo Miguel entries in CLAUDE.md if there's a relevant remaining action.
- [ ] Final smoke: create a recipe, edit it, scale it, all flows work end-to-end with the new model.

---

## Risk + rollback per phase

| Phase | If something breaks | Rollback |
|---|---|---|
| PR 1 | Migration 0008 fails | Drizzle `migrate.down` (none of the changes are user-visible). Drop the new columns + table. |
| PR 2 | Extractor returns malformed JSON | Server-side validation falls back to `servings=4 + 'estimated'` + drops `display` fields. Existing photo/URL extraction keeps working. |
| PR 3 | Form regression | Disable display selector by feature flag (env var `NEXT_PUBLIC_UNITS_DISPLAY_ENABLED`); old behavior is intact since underlying schema is backwards compatible. |
| PR 4 | Backfill leaves WARN rows | Skip enum tighten. Keep abstract branches in `aggregate.ts`. Address warnings (likely missing density on a curator ingredient), then retry. |

---

## YAGNI guardrails

- No bulk admin UI for cache management. Curator can edit cached entries via direct SQL if needed.
- No global LLM-call rate limit beyond the existing `IMAGE_GEN_MONTHLY_LIMIT` pattern. If unit-resolution cost surprises us, add `UNIT_LLM_DAILY_CAP` env var in PR 5.
- No multi-display alternates ("show 1 cda AND 15 ml at once with a toggle"). Secondary canonical only appears during scaling.
- No imperial unit storage. The extractor LLM converts at write time.
