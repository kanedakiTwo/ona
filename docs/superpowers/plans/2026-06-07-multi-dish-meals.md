# Multi-dish Meals + Free-text Notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow an ONA meal slot to hold an ordered list of dishes (each either a catalogue recipe or a free-text note), with per-meal-type configurable dish count and course-aware auto-generation.

**Architecture:** Two PRs in sequence. PR A is a no-behaviour-change metadata preparator — adds `recipes.course` enum + an LLM-backfill script + a form dropdown. PR B is the substantive shape change — rewrites `MealSlot` to `{servings?, dishes: Dish[]}`, adds 4 dish-level API routes, makes the auto-generator course-aware, and updates the meal-card UI / plantilla / Vista Semana.

**Tech Stack:** Express 5 · Drizzle ORM · PostgreSQL · Next.js 15 App Router · React 19 · Tailwind v4 · @dnd-kit/sortable · motion/react · vitest · @ona/shared zod types

**Reference spec:** [`docs/superpowers/specs/2026-06-07-multi-dish-meals-design.md`](../specs/2026-06-07-multi-dish-meals-design.md)

---

## Conventions used in this plan

- **TDD-by-default for pure logic.** Helpers in `@ona/shared` and `services/` get a failing test first, then implementation, then green. Route smoke and integration tests can land alongside the implementation in the same commit (route handlers depend on infra setup that's not worth mocking for TDD).
- **Spec-gate per PR.** Each PR closes with a `docs(spec):` commit that updates the affected `specs/*.md` files. See CLAUDE.md.
- **Commit cadence.** One commit per task unless a task explicitly batches related steps.
- **Typecheck before commit.** Every task that touches `.ts`/`.tsx` runs `pnpm --filter @ona/api exec tsc --noEmit` and/or `pnpm --filter @ona/web exec tsc --noEmit`.
- **Manual smoke** at 390 × 844 (mobile) and 1440 × 900 (desktop) for every UI task. The full E2E sweep is **out of scope** (per Miguel's call — the pre-existing red Playwright tests are next PR).
- **Deploy = `railway up`.** No GitHub→Railway auto-deploy. PR A ships first; PR B ships only after PR A is live on prod and the course backfill has been applied.

---

## File structure

### PR A — Course backfill

**New files:**

| Path | Responsibility |
|---|---|
| `apps/api/src/db/migrations/0029_recipes_course.sql` | `ALTER TABLE recipes ADD COLUMN IF NOT EXISTS course text`. |
| `apps/api/src/db/migrations/meta/0029_snapshot.json` | Drizzle snapshot regenerated. |
| `apps/api/scripts/populateRecipeCourses.ts` | LLM-backfill script, mirrors `populatePrepRequirements.ts`. Reads every recipe, asks Claude to classify `starter | main | dessert | null`, writes JSONL to `scripts/output/recipe-courses.jsonl`, then `--apply` flag re-reads and UPDATEs. |
| `apps/api/src/tests/courseValidator.test.ts` | Unit test for the closed `Course` enum validator in `@ona/shared`. |

**Modified files:**

| Path | Change |
|---|---|
| `packages/shared/src/types/recipe.ts` | Add `Course` type, `COURSES` const, `COURSE_LABELS` map, `courseSchema` zod refinement. Add optional `course?: Course \| null` to the `Recipe` type. |
| `packages/shared/src/index.ts` | Re-export the new `Course` symbols. |
| `apps/api/src/db/schema.ts` | Add `course: text('course')` to the `recipes` table. |
| `apps/api/src/db/migrations/meta/_journal.json` | Append the 0029 entry (auto-managed by Drizzle but list it explicitly so the implementer doesn't skip the regen). |
| `apps/api/package.json` | Add `"course:populate": "tsx scripts/populateRecipeCourses.ts"` and `"course:apply": "tsx scripts/populateRecipeCourses.ts --apply"`. |
| `apps/api/src/routes/recipes.ts` | Accept `course` in the create/update payload (zod schema in `@ona/shared` already valid). Return it on GET. |
| `apps/web/src/app/recipes/new/page.tsx` | Add "Tipo de plato" dropdown below "Dificultad". |
| `apps/web/src/app/recipes/[id]/edit/page.tsx` | Same dropdown, seeded from the loaded recipe. |
| `specs/recipes.md` | Document `course` field, the LLM backfill script, and the form dropdown. |

### PR B — Multi-dish + notes

**New files:**

| Path | Responsibility |
|---|---|
| `apps/api/src/db/migrations/0030_menus_dishes.sql` | Empty SQL placeholder (data migration runs from a TS script — see below). |
| `apps/api/src/db/migrations/meta/0030_snapshot.json` | Drizzle snapshot regenerated (schema unchanged but bumps the journal). |
| `apps/api/scripts/migrateMenusToDishes.ts` | One-shot data migration: for every menu, walk `days[i][meal]` and rewrite legacy `{recipeId,…}` to `{servings?, dishes: [{kind:'recipe', recipeId, …}]}`. Idempotent (skips rows already migrated). |
| `packages/shared/src/types/menuDish.ts` | New `Dish` discriminated union (`RecipeDish` \| `NoteDish`), helpers (`isRecipeDish`, `isNoteDish`, `dishLength`, `recipeDishesOf`). |
| `apps/api/src/services/menuDishes.ts` | Pure helpers — `addDish`, `removeDishAt`, `reorderDish`, `patchDish`, `dishCountFor(meal, mealDishCounts)`, `coursesFor(N)`. |
| `apps/api/src/services/courseAwareMatcher.ts` | Thin wrapper over `findRecipeForSlot` that takes a `course` constraint and prefilters candidates with `(course = ? OR course IS NULL)` semantics — see Task B.4. |
| `apps/api/src/tests/menuDishes.test.ts` | Vitest covering all pure helpers. |
| `apps/api/src/tests/courseAwareMatcher.test.ts` | Vitest covering the N=1 exclusion rule and N=2/N=3 progression. |
| `apps/api/src/tests/menusRouteDish.smoke.ts` | Route smoke for the 4 new dish endpoints. |
| `apps/web/src/components/menu/DishRow.tsx` | Per-dish row used inside the multi-dish meal card (thumbnail + name + actions or icon + italic text for notes). |
| `apps/web/src/components/menu/AddDishSheet.tsx` | Bottom sheet with the 3 options (Aleatorio · Elegir · Añadir nota). |
| `apps/web/src/components/profile/MealDishCountControls.tsx` | The "Platos por comida" segmented controls block for `/profile/page.tsx`. |
| `apps/web/src/lib/dishes.ts` | Tiny client-side helpers (compute next missing course, dish display label, etc). |
| `apps/web/src/tests/dishes.test.ts` | Unit tests for the client helpers. |

**Modified files:**

| Path | Change |
|---|---|
| `packages/shared/src/types/menu.ts` | Replace `MealSlot` with `{servings?, dishes: Dish[]}`. Move `pinnedType`, `kind`/`variant`, `leftoverOf`, `imageUrl`/`prepTime`/`totalTime` to `RecipeDish`. Add `mealDishCounts` to the user settings shape. Update `generateMenuSchema` if needed (no body change expected — server reads `mealDishCounts` from `userSettings`). |
| `apps/api/src/services/menuGenerator.ts` | Read `mealDishCounts` from settings via a new `extractMealDishCounts` helper alongside `extractMealDiners`. Compute `coursesFor(count)` per slot. Call `courseAwareMatcher.findForCourse(...)` N times. Collect warnings. |
| `apps/api/src/routes/menus.ts` | Add the 4 dish-level routes, adjust slot-level routes per spec table (Section "API surface — Existing routes"). |
| `apps/api/src/services/shoppingList.ts` | Iterate `slot.dishes`, filter `kind:'recipe'`. Read `dish.variant === 'leftover'` instead of `slot.kind === 'leftover'`. |
| `apps/api/src/services/advisor/summary.ts` (or wherever nutrition aggregates today) | Same iteration pattern. |
| `apps/web/src/app/menu/page.tsx` | Rewrite `EditorialMealCard` for the hybrid render (1-dish editorial / N-dish stacked rows). Inject `<AddDishSheet>` trigger below dish list. Use `<DishRow>` for each dish. |
| `apps/web/src/components/menu/WeekGridView.tsx` | Read `slot.dishes[0]` for the hero photo. Show `+N más` badge when `dishes.length > 1`. |
| `apps/web/src/app/profile/page.tsx` | Mount `<MealDishCountControls>` above the existing day × meal grid in the plantilla section. |
| `apps/web/src/hooks/useMenu.ts` (or wherever menu mutations live) | Add hooks for the 4 new dish endpoints. |
| `apps/web/src/lib/recipeView.ts` or new file | If shopping-list aggregator needs a frontend mirror, update accordingly (likely no change — server is source of truth). |
| `specs/menus.md` | Slot shape, new dish-level routes, plantilla `mealDishCounts`, auto-gen rules, warnings. |
| `specs/shopping.md` | "Notes are skipped from aggregation." |
| `specs/advisor.md` | "Notes contribute zero nutrition." |

---

## PR A — Course backfill

Ship this PR independently. It adds metadata only; no user-visible behaviour changes until PR B reads the field.

### Task A.1: Add `Course` type + validator to `@ona/shared`

**Files:**
- Modify: `packages/shared/src/types/recipe.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/api/src/tests/courseValidator.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/api/src/tests/courseValidator.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { COURSES, COURSE_LABELS, courseSchema, type Course } from '@ona/shared'

describe('Course validator', () => {
  it('accepts the 3 valid course values', () => {
    for (const v of COURSES) {
      expect(courseSchema.safeParse(v).success).toBe(true)
    }
  })
  it('accepts null (recipe is versatile / unclassified)', () => {
    expect(courseSchema.safeParse(null).success).toBe(true)
  })
  it('rejects unknown values', () => {
    expect(courseSchema.safeParse('mainplate').success).toBe(false)
    expect(courseSchema.safeParse('').success).toBe(false)
    expect(courseSchema.safeParse(undefined).success).toBe(false) // explicit null only
  })
  it('exports Spanish labels for every value', () => {
    expect(COURSE_LABELS.starter).toBe('Entrante')
    expect(COURSE_LABELS.main).toBe('Principal')
    expect(COURSE_LABELS.dessert).toBe('Postre')
  })
})
```

- [ ] **Step 2: Run the test, confirm it fails**

```bash
pnpm --filter @ona/api exec vitest run src/tests/courseValidator.test.ts
```

Expected: FAIL — `COURSES` / `courseSchema` / `COURSE_LABELS` / `Course` are not exported yet.

- [ ] **Step 3: Implement in `packages/shared/src/types/recipe.ts`**

Append (near the existing meal/season exports):

```ts
import { z } from 'zod'

export const COURSES = ['starter', 'main', 'dessert'] as const
export type Course = typeof COURSES[number]

export const COURSE_LABELS: Record<Course, string> = {
  starter: 'Entrante',
  main: 'Principal',
  dessert: 'Postre',
}

// Accepts a value matching the closed enum OR `null` (recipe is versatile /
// unclassified — the default after migration 0029 and the default LLM output
// when the model is unsure).
export const courseSchema = z.union([z.enum(COURSES), z.null()])
```

If the `Recipe` interface in the same file has a clear "tags" cluster, add `course?: Course | null` next to it.

- [ ] **Step 4: Re-export from `packages/shared/src/index.ts`**

Find the existing recipe-type re-exports and add `Course`, `COURSES`, `COURSE_LABELS`, `courseSchema`.

- [ ] **Step 5: Rebuild shared + run the test**

```bash
pnpm --filter @ona/shared build
pnpm --filter @ona/api exec vitest run src/tests/courseValidator.test.ts
```

Expected: PASS (4/4).

- [ ] **Step 6: Commit**

```bash
git add packages/shared apps/api/src/tests/courseValidator.test.ts
git commit -m "feat(shared): Course enum + validator + Spanish labels (PR A foundation)"
```

### Task A.2: Migration `0029_recipes_course`

**Files:**
- Create: `apps/api/src/db/migrations/0029_recipes_course.sql`
- Modify: `apps/api/src/db/schema.ts`
- Auto-generated: `apps/api/src/db/migrations/meta/0029_snapshot.json` + `_journal.json` entry

- [ ] **Step 1: Add the column to the Drizzle schema**

In `apps/api/src/db/schema.ts`, find the `recipes` table definition. Add:

```ts
  course: text('course'),  // 'starter' | 'main' | 'dessert' | null; validated at app layer
```

Place it after `difficulty` or wherever the closed-enum text columns cluster.

- [ ] **Step 2: Generate the migration**

```bash
pnpm --filter @ona/api exec drizzle-kit generate
```

This creates `0029_*.sql` + the snapshot. **Rename the SQL file to `0029_recipes_course.sql`** if Drizzle auto-named it differently — match the convention of existing migrations.

- [ ] **Step 3: Make the migration idempotent**

Open the generated `0029_recipes_course.sql` and replace its body with:

```sql
-- Per-recipe course classification: 'starter' | 'main' | 'dessert' | null.
-- Idempotent so a partial apply can be re-run safely. Validation enforced at
-- the application layer via the Zod schema in @ona/shared (closed enum).
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "course" text;
```

- [ ] **Step 4: Apply locally + verify**

```bash
pnpm --filter @ona/api db:migrate
psql "$DATABASE_URL" -c "SELECT column_name FROM information_schema.columns WHERE table_name='recipes' AND column_name='course';"
```

Expected: one row returned, `course | text`.

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @ona/api exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/schema.ts apps/api/src/db/migrations/0029_recipes_course.sql apps/api/src/db/migrations/meta/0029_snapshot.json apps/api/src/db/migrations/meta/_journal.json
git commit -m "feat(db): migration 0029 — recipes.course column (idempotent)"
```

### Task A.3: LLM-backfill script

**Files:**
- Create: `apps/api/scripts/populateRecipeCourses.ts`
- Modify: `apps/api/package.json`

This script mirrors `populatePrepRequirements.ts` line for line — same two-step pipeline (populate → JSONL → manual review → --apply → DB). Read `populatePrepRequirements.ts` first to lift the shape.

- [ ] **Step 1: Scaffold the script**

Create `apps/api/scripts/populateRecipeCourses.ts`:

```ts
/**
 * Populate `recipes.course` for the entire catalogue via Claude. Two-step
 * pipeline, mirroring `populatePrepRequirements.ts`:
 *
 *   1. `pnpm course:populate`
 *        → reads every row from `recipes`
 *        → asks Claude in batches of 50 which course tag it belongs to
 *        → writes JSONL to scripts/output/recipe-courses.jsonl
 *
 *   2. Manual review: open the JSONL, delete/edit lines you disagree with.
 *
 *   3. `pnpm course:apply`
 *        → re-reads the JSONL, UPDATEs the matching rows.
 *
 * Cost: ~5 batched LLM calls for 79 seed recipes, ~$0.10. The prompt defaults
 * to `null` when in doubt — pollution-free.
 */

import path from 'path'
import fs from 'fs/promises'
import { fileURLToPath } from 'url'
import { eq } from 'drizzle-orm'
import Anthropic from '@anthropic-ai/sdk'
import { db } from '../src/db/connection.js'
import { recipes } from '../src/db/schema.js'
import { env } from '../src/config/env.js'
import { COURSES, type Course } from '@ona/shared'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const OUTPUT_PATH = path.join(__dirname, 'output', 'recipe-courses.jsonl')
const BATCH_SIZE = 50
const MODEL = 'claude-sonnet-4-20250514'

interface OutputRow {
  id: string
  name: string
  course: Course | null
}

const SYSTEM_PROMPT = `Eres un asistente que clasifica recetas españolas según el tipo de plato.

Para cada receta, decides si su rol típico en una comida tradicional española es uno de estos casos cerrados:

  - starter   — Entrante / primer plato. Suele ser ligero, preparatorio. Ejemplos: cremas, sopas, ensaladas, gazpacho, salmorejo, croquetas, empanadillas, tortilla pequeña, hummus, tabla de quesos. NO: un cocido completo, una paella.
  - main      — Plato principal / segundo. Comida completa que puede comerse sola. Ejemplos: paella, cocido, lentejas con chorizo, lasaña, chuletón con guarnición, bacalao al pil-pil, pollo asado, hamburguesa con patatas.
  - dessert   — Postre. Dulce o fruta. Ejemplos: flan, arroz con leche, tarta de Santiago, helado, fruta asada, natillas, brownie.

REGLAS:

1. La MAYORÍA del catálogo cae en \`main\` o \`null\`. Solo marca \`starter\` cuando la receta es claramente ligera y preparatoria, y \`dessert\` solo si es dulce explícito.

2. \`null\` es válido y preferido cuando la receta es versátil — funciona como plato único Y también como acompañamiento, según contexto. Ejemplos comunes: arroz blanco, pasta simple, verduras al horno, tortilla francesa, huevos rotos.

3. Una receta que es claramente \`starter\` o \`dessert\` jamás debe marcarse \`main\`. Una crema de calabacín NO es \`main\`.

4. Si dudas, devuelve \`null\`. El menú generador trata \`null\` como "vale como plato único" — es la opción segura.

Output: JSON puro (sin markdown), con la forma:

{"results": [{"id": "uuid", "name": "...", "course": "starter" | "main" | "dessert" | null}, ...]}`

async function classifyBatch(
  client: Anthropic,
  batch: { id: string; name: string }[],
): Promise<OutputRow[]> {
  const userPrompt = JSON.stringify({ recipes: batch }, null, 2)
  const msg = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const block = msg.content.find((c) => c.type === 'text')
  const text = block && block.type === 'text' ? block.text : ''
  const parsed = JSON.parse(text) as { results: OutputRow[] }
  // Validate every row before returning — drop unknown course values.
  return parsed.results.map((r) => ({
    ...r,
    course: r.course === null || (COURSES as readonly string[]).includes(r.course as string)
      ? r.course
      : null,
  }))
}

async function populate(): Promise<void> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
  const all = await db.select({ id: recipes.id, name: recipes.name }).from(recipes)
  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true })
  const stream = await fs.open(OUTPUT_PATH, 'w')
  let total = 0
  for (let i = 0; i < all.length; i += BATCH_SIZE) {
    const batch = all.slice(i, i + BATCH_SIZE)
    process.stdout.write(`[${i}/${all.length}] classifying ${batch.length} recipes…\n`)
    const out = await classifyBatch(client, batch)
    for (const row of out) {
      await stream.write(JSON.stringify(row) + '\n')
      total++
    }
  }
  await stream.close()
  console.log(`✓ Wrote ${total} rows to ${OUTPUT_PATH}`)
  console.log(`Next: review the JSONL, then run with --apply to write to DB.`)
}

async function apply(): Promise<void> {
  const text = await fs.readFile(OUTPUT_PATH, 'utf-8')
  const lines = text.split('\n').filter(Boolean)
  let updated = 0
  for (const line of lines) {
    const row = JSON.parse(line) as OutputRow
    await db.update(recipes).set({ course: row.course }).where(eq(recipes.id, row.id))
    updated++
  }
  console.log(`✓ Updated ${updated} recipes.course rows.`)
}

const args = process.argv.slice(2)
if (args.includes('--apply')) {
  apply().catch((e) => { console.error(e); process.exit(1) })
} else {
  populate().catch((e) => { console.error(e); process.exit(1) })
}
```

- [ ] **Step 2: Add scripts to `apps/api/package.json`**

Find the existing `prep-requirements:populate` entry and add right below:

```json
    "course:populate": "tsx scripts/populateRecipeCourses.ts",
    "course:apply": "tsx scripts/populateRecipeCourses.ts --apply"
```

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @ona/api exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Smoke-run against a small subset (locally)**

```bash
# DO NOT run --apply yet. Just confirm the populate writes a sensible JSONL.
pnpm --filter @ona/api course:populate
head -5 apps/api/scripts/output/recipe-courses.jsonl
```

Expected: a few rows with reasonable course classifications. If the output looks broken (e.g. all null, or course="main" for every dessert), tighten the prompt and retry.

- [ ] **Step 5: Commit**

```bash
git add apps/api/scripts/populateRecipeCourses.ts apps/api/package.json apps/api/scripts/output/recipe-courses.jsonl
git commit -m "feat(api): LLM backfill script for recipes.course (course:populate / course:apply)"
```

The JSONL is committed because it's the source of truth Miguel reviewed before applying — a future migration on a fresh DB can replay it.

### Task A.4: Apply the backfill locally

This is the manual step where Miguel reviews the JSONL and applies it.

- [ ] **Step 1: Review the JSONL**

```bash
wc -l apps/api/scripts/output/recipe-courses.jsonl
# Open the file and scan for misclassifications. Edit any line where Claude
# made an obvious error.
```

- [ ] **Step 2: Apply**

```bash
pnpm --filter @ona/api course:apply
```

Expected: `✓ Updated N recipes.course rows.`

- [ ] **Step 3: Sanity-check the distribution**

```bash
psql "$DATABASE_URL" -c "SELECT course, COUNT(*) FROM recipes GROUP BY course ORDER BY COUNT(*) DESC;"
```

Expected: a believable spread — probably 30-60% `null`, 30-50% `main`, smaller groups for `starter` and `dessert`. If anything looks wildly off (e.g. zero `null` or 100% `main`), revisit the prompt.

- [ ] **Step 4: No commit**

This is a data-only DB change. Nothing to commit. Skip.

### Task A.5: Form dropdown in `/recipes/new` and `/recipes/[id]/edit`

**Files:**
- Modify: `apps/web/src/app/recipes/new/page.tsx`
- Modify: `apps/web/src/app/recipes/[id]/edit/page.tsx`

- [ ] **Step 1: Add the dropdown to `/recipes/new`**

Find the form section near "Dificultad" (search for "Dificultad" or "difficulty"). Add right below it:

```tsx
import { COURSES, COURSE_LABELS } from '@ona/shared'

// In the form state:
const [course, setCourse] = useState<'starter' | 'main' | 'dessert' | ''>('')

// In the JSX, below the Dificultad block:
<div className="space-y-2">
  <label className="text-eyebrow text-[#7A7066]">Tipo de plato</label>
  <select
    value={course}
    onChange={(e) => setCourse(e.target.value as typeof course)}
    className="w-full rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-2 text-[14px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none"
  >
    <option value="">Sin clasificar (auto)</option>
    {COURSES.map((c) => (
      <option key={c} value={c}>
        {COURSE_LABELS[c]}
      </option>
    ))}
  </select>
</div>
```

In the submit handler, include `course: course || null` in the API payload.

- [ ] **Step 2: Mirror the dropdown in `/recipes/[id]/edit`**

Same JSX. Seed the state from `recipe.course` when the recipe loads:

```ts
useEffect(() => {
  if (recipe) setCourse(recipe.course ?? '')
}, [recipe])
```

- [ ] **Step 3: Update the API route to accept the field**

In `apps/api/src/routes/recipes.ts`, find the create + update payload validation. The Zod schema in `@ona/shared` already accepts `course`, but the route handler may need to forward the field to the Drizzle insert/update.

Search for the `insert/update` call(s) on the `recipes` table. Make sure `course` is included:

```ts
.values({ ..., course: payload.course ?? null })
// or
.set({ ..., course: payload.course ?? null })
```

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @ona/api exec tsc --noEmit
pnpm --filter @ona/web exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Manual smoke**

```bash
pnpm --filter @ona/web dev
# Navigate to /recipes/new, fill the form including "Tipo de plato"=Entrante,
# submit. Open the created recipe; the edit form should pre-populate the
# course. Change it to "Postre", save, reload — should persist.
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/recipes/new/page.tsx apps/web/src/app/recipes/[id]/edit/page.tsx apps/api/src/routes/recipes.ts
git commit -m "feat(recipes): course dropdown in /recipes/new and /recipes/[id]/edit"
```

### Task A.6: Update `specs/recipes.md`

**Files:**
- Modify: `specs/recipes.md`

- [ ] **Step 1: Add a "Course classification" section**

Append a new section (place it after "Display Constraints", before "Ingredient prep requirements"):

```markdown
## Course classification (`recipes.course`)

Optional enum tagging the recipe's role in a multi-dish meal: `'starter' | 'main' | 'dessert' | null`. Spanish labels via `COURSE_LABELS` in `@ona/shared` (`Entrante / Principal / Postre`).

`null` means "versatile" — the menu generator treats null-tagged recipes as valid stand-alone dishes for single-dish slots. The matcher uses this field when a slot is configured with 2 or 3 dishes (see [`menus.md`](./menus.md) "Multi-dish slots").

Population:
- Seed catalogue + existing user recipes: one-shot LLM script `pnpm --filter @ona/api course:populate` (→ JSONL → manual review → `course:apply`). Same two-step pattern as `prep-requirements:populate`. Source: `apps/api/scripts/populateRecipeCourses.ts`.
- New recipes: optional dropdown in `/recipes/new` and `/recipes/[id]/edit` (defaults to "Sin clasificar (auto)" = `null`).
```

- [ ] **Step 2: Commit**

```bash
git add specs/recipes.md
git commit -m "docs(spec): recipes.md gets course classification section (PR A)"
```

### Task A.7: Ship PR A

- [ ] **Step 1: Final local checks**

```bash
pnpm --filter @ona/api exec tsc --noEmit
pnpm --filter @ona/web exec tsc --noEmit
pnpm --filter @ona/api exec vitest run
```

Expected: all green.

- [ ] **Step 2: Push + deploy via `railway up`**

```bash
git push origin master
railway up --service ona-api --detach    # migration 0029 runs on boot
railway up --service ona-web --detach    # form dropdown
```

- [ ] **Step 3: Apply the backfill against prod**

After the API deploy is live, run `course:apply` against prod. The script reads `DATABASE_URL` from env. Two options:

  a) Run locally pointing at prod's `DATABASE_URL`:
     ```bash
     DATABASE_URL=$(railway variables get DATABASE_URL --service ona-api) pnpm --filter @ona/api course:apply
     ```
  b) Or via `railway run`:
     ```bash
     railway run --service ona-api pnpm --filter @ona/api course:apply
     ```

Sanity-check the distribution on prod the same way as Task A.4 Step 3.

- [ ] **Step 4: Mark PR A done**

PR B can now read `recipes.course` and assumes it's populated for the catalogue.

---

## PR B — Multi-dish + free-text notes

Ship this only after PR A is live on prod and `recipes.course` is populated.

### Task B.1: New `Dish` type + helpers in `@ona/shared`

**Files:**
- Create: `packages/shared/src/types/menuDish.ts`
- Modify: `packages/shared/src/types/menu.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/api/src/tests/menuDishTypes.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/tests/menuDishTypes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  isRecipeDish,
  isNoteDish,
  recipeDishesOf,
  type Dish,
  type RecipeDish,
  type NoteDish,
} from '@ona/shared'

describe('Dish discriminated union', () => {
  const recipeDish: RecipeDish = { kind: 'recipe', recipeId: 'r1', recipeName: 'Cocido' }
  const noteDish: NoteDish = { kind: 'note', text: 'en casa de Paqui' }

  it('isRecipeDish narrows correctly', () => {
    expect(isRecipeDish(recipeDish)).toBe(true)
    expect(isRecipeDish(noteDish)).toBe(false)
  })

  it('isNoteDish narrows correctly', () => {
    expect(isNoteDish(recipeDish)).toBe(false)
    expect(isNoteDish(noteDish)).toBe(true)
  })

  it('recipeDishesOf filters and preserves order', () => {
    const dishes: Dish[] = [recipeDish, noteDish, { ...recipeDish, recipeId: 'r2' }]
    const out = recipeDishesOf(dishes)
    expect(out.map((d) => d.recipeId)).toEqual(['r1', 'r2'])
  })
})
```

- [ ] **Step 2: Run, confirm fails**

```bash
pnpm --filter @ona/api exec vitest run src/tests/menuDishTypes.test.ts
```

Expected: FAIL (types not exported).

- [ ] **Step 3: Create `packages/shared/src/types/menuDish.ts`**

```ts
import type { Course } from './recipe.js'

export interface RecipeDish {
  kind: 'recipe'
  recipeId: string
  recipeName?: string
  /** Hydrated from `recipes.course` on read; nullable so versatile recipes pass through. */
  course?: Course | null
  /** Per-dish meal-type pin (cremas, legumbres…). Moved from slot in the multi-dish migration. */
  pinnedType?: string | null
  /** `planned` (default) | `leftover` (cloned from a previous slot's recipe-dish). */
  variant?: 'planned' | 'leftover'
  /** Back-reference when `variant === 'leftover'`. Carries the dish position because a slot can have multiple recipes now. */
  leftoverOf?: { day: number; meal: string; dishPosition: number } | null
  /** Hydrated from `recipes.image_url` on every menu response; NOT persisted in JSONB. */
  imageUrl?: string | null
  /** Hydrated alongside `imageUrl`. */
  prepTime?: number | null
  totalTime?: number | null
}

export interface NoteDish {
  kind: 'note'
  /** Free-text dish. Max 120 chars enforced at the API. */
  text: string
}

export type Dish = RecipeDish | NoteDish

export function isRecipeDish(d: Dish): d is RecipeDish {
  return d.kind === 'recipe'
}

export function isNoteDish(d: Dish): d is NoteDish {
  return d.kind === 'note'
}

/** Returns only the recipe dishes, in their original order. */
export function recipeDishesOf(dishes: Dish[]): RecipeDish[] {
  return dishes.filter(isRecipeDish)
}
```

- [ ] **Step 4: Update `packages/shared/src/types/menu.ts`**

Replace the legacy `MealSlot` definition with:

```ts
import type { Dish } from './menuDish.js'

export interface MealSlot {
  /** Slot-level diner override; replaces the household default for every dish in this slot. */
  servings?: number | null
  /** Ordered list of dishes; length ≥ 1 after at least one populate, but `[]` is transient and valid (slot exists but is empty). */
  dishes: Dish[]
}

export interface DayMenu {
  [meal: string]: MealSlot | undefined
}
```

(Remove `pinnedType`, `kind`, `leftoverOf`, `imageUrl`, `prepTime`, `totalTime` from the slot — those moved to `RecipeDish`.)

In the same file, add the new settings shape (or expand the existing one):

```ts
import type { Meal } from '../constants/enums.js'

/** Optional config: how many dishes the menu generator should produce per meal-type. Default 1. */
export type MealDishCounts = Partial<Record<Meal, 1 | 2 | 3>>
```

- [ ] **Step 5: Re-export from `index.ts`**

Add `Dish`, `RecipeDish`, `NoteDish`, `isRecipeDish`, `isNoteDish`, `recipeDishesOf`, `MealDishCounts`.

- [ ] **Step 6: Rebuild + run the test**

```bash
pnpm --filter @ona/shared build
pnpm --filter @ona/api exec vitest run src/tests/menuDishTypes.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/shared apps/api/src/tests/menuDishTypes.test.ts
git commit -m "feat(shared): Dish discriminated union + MealSlot multi-dish shape (PR B foundation)"
```

This commit will break the rest of the codebase (`apps/api`, `apps/web` still expect the legacy slot shape). That's expected — subsequent tasks fix the consumers.

### Task B.2: Pure helpers — `menuDishes.ts`

**Files:**
- Create: `apps/api/src/services/menuDishes.ts`
- Create: `apps/api/src/tests/menuDishes.test.ts`

- [ ] **Step 1: Write the failing test**

`apps/api/src/tests/menuDishes.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import type { Dish, RecipeDish } from '@ona/shared'
import {
  addDish,
  removeDishAt,
  reorderDish,
  patchDish,
  dishCountFor,
  coursesFor,
} from '../services/menuDishes.js'

const r = (id: string, course?: 'starter' | 'main' | 'dessert'): RecipeDish => ({
  kind: 'recipe',
  recipeId: id,
  course: course ?? null,
})

describe('addDish', () => {
  it('appends a dish at the end', () => {
    const before: Dish[] = [r('a')]
    const after = addDish(before, r('b'))
    expect(after.map((d) => (d as RecipeDish).recipeId)).toEqual(['a', 'b'])
  })
  it('does not mutate the input', () => {
    const before: Dish[] = [r('a')]
    addDish(before, r('b'))
    expect(before.length).toBe(1)
  })
})

describe('removeDishAt', () => {
  it('removes at the given index, compacts positions', () => {
    const before: Dish[] = [r('a'), r('b'), r('c')]
    const after = removeDishAt(before, 1)
    expect(after.map((d) => (d as RecipeDish).recipeId)).toEqual(['a', 'c'])
  })
  it('throws when index is out of range', () => {
    expect(() => removeDishAt([r('a')], 5)).toThrow(/out of range/i)
  })
})

describe('reorderDish', () => {
  it('moves a dish from one position to another', () => {
    const before: Dish[] = [r('a'), r('b'), r('c')]
    const after = reorderDish(before, 0, 2)
    expect(after.map((d) => (d as RecipeDish).recipeId)).toEqual(['b', 'c', 'a'])
  })
  it('no-op when from == to', () => {
    const before: Dish[] = [r('a'), r('b')]
    const after = reorderDish(before, 1, 1)
    expect(after).toEqual(before)
  })
  it('throws when either index is out of range', () => {
    expect(() => reorderDish([r('a')], 0, 5)).toThrow()
  })
})

describe('patchDish', () => {
  it('updates note text', () => {
    const before: Dish[] = [{ kind: 'note', text: 'old' }]
    const after = patchDish(before, 0, { text: 'new' })
    expect((after[0] as { text: string }).text).toBe('new')
  })
  it('updates pinnedType on a recipe dish', () => {
    const before: Dish[] = [r('a')]
    const after = patchDish(before, 0, { pinnedType: 'legumbres' })
    expect((after[0] as RecipeDish).pinnedType).toBe('legumbres')
  })
  it('ignores text on a recipe dish', () => {
    const before: Dish[] = [r('a')]
    const after = patchDish(before, 0, { text: 'nope' })
    expect(after[0]).toEqual(before[0])
  })
  it('ignores pinnedType on a note dish', () => {
    const before: Dish[] = [{ kind: 'note', text: 'x' }]
    const after = patchDish(before, 0, { pinnedType: 'legumbres' })
    expect(after[0]).toEqual(before[0])
  })
})

describe('dishCountFor + coursesFor', () => {
  it('dishCountFor falls back to 1 when meal is missing', () => {
    expect(dishCountFor('lunch', {})).toBe(1)
    expect(dishCountFor('lunch', { lunch: 2 })).toBe(2)
  })
  it('coursesFor returns the convention', () => {
    expect(coursesFor(1)).toEqual([null])   // null means "no course constraint"
    expect(coursesFor(2)).toEqual(['starter', 'main'])
    expect(coursesFor(3)).toEqual(['starter', 'main', 'dessert'])
  })
})
```

- [ ] **Step 2: Run, confirm fails**

```bash
pnpm --filter @ona/api exec vitest run src/tests/menuDishes.test.ts
```

Expected: FAIL.

- [ ] **Step 3: Implement `apps/api/src/services/menuDishes.ts`**

```ts
import type { Dish, RecipeDish, NoteDish, MealDishCounts, Course } from '@ona/shared'
import type { Meal } from '@ona/shared'

export function addDish(dishes: Dish[], next: Dish): Dish[] {
  return [...dishes, next]
}

export function removeDishAt(dishes: Dish[], index: number): Dish[] {
  if (index < 0 || index >= dishes.length) {
    throw new Error(`removeDishAt: index ${index} out of range (length ${dishes.length})`)
  }
  return [...dishes.slice(0, index), ...dishes.slice(index + 1)]
}

export function reorderDish(dishes: Dish[], from: number, to: number): Dish[] {
  if (from < 0 || from >= dishes.length || to < 0 || to >= dishes.length) {
    throw new Error(`reorderDish: index out of range`)
  }
  if (from === to) return dishes
  const next = [...dishes]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved)
  return next
}

/**
 * Patch a single dish. Fields that don't apply to the dish's kind are silently
 * ignored (e.g. `text` on a recipe dish, `pinnedType` on a note dish). This
 * lets the route handler accept a uniform body shape without dispatching on kind.
 */
export interface DishPatch {
  text?: string
  pinnedType?: string | null
  course?: Course | null
}

export function patchDish(dishes: Dish[], index: number, patch: DishPatch): Dish[] {
  if (index < 0 || index >= dishes.length) {
    throw new Error(`patchDish: index ${index} out of range`)
  }
  const current = dishes[index]
  const next: Dish =
    current.kind === 'recipe'
      ? {
          ...current,
          ...(patch.pinnedType !== undefined && { pinnedType: patch.pinnedType }),
          ...(patch.course !== undefined && { course: patch.course }),
        }
      : {
          ...current,
          ...(patch.text !== undefined && { text: patch.text }),
        }
  return [...dishes.slice(0, index), next, ...dishes.slice(index + 1)]
}

export function dishCountFor(meal: Meal, counts: MealDishCounts): 1 | 2 | 3 {
  return counts[meal] ?? 1
}

/**
 * Convention map: number of dishes → courses to ask the matcher for.
 *   1 → [null]                     (no course constraint; matcher restricts to main/null)
 *   2 → ['starter', 'main']
 *   3 → ['starter', 'main', 'dessert']
 */
export function coursesFor(count: 1 | 2 | 3): (Course | null)[] {
  if (count === 1) return [null]
  if (count === 2) return ['starter', 'main']
  return ['starter', 'main', 'dessert']
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm --filter @ona/api exec vitest run src/tests/menuDishes.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/menuDishes.ts apps/api/src/tests/menuDishes.test.ts
git commit -m "feat(api): pure dish helpers (add/remove/reorder/patch + dishCountFor/coursesFor)"
```

### Task B.3: Migration `0030` — data rewrite

**Files:**
- Create: `apps/api/src/db/migrations/0030_menus_dishes.sql`
- Create: `apps/api/scripts/migrateMenusToDishes.ts`
- Modify: `apps/api/src/db/migrations/meta/_journal.json` + new snapshot
- Modify: `apps/api/src/db/schema.ts` (no column change — bump for Drizzle awareness only)

The SQL migration is empty (no schema change). The data migration runs as a TS script that the deploy invokes via `RAILPACK_START_CMD` — same pattern as `db:migrate`.

- [ ] **Step 1: Force-create the 0030 migration via Drizzle**

We need a 0030 entry in `_journal.json` so the data-migration script (Step 2) runs at a deterministic point in the deploy. Easiest reliable way: make a *trivial* tracked column tweak that Drizzle picks up, then revert it before commit.

Simpler alternative (recommended): just bump the schema with a no-op comment change to force Drizzle's awareness:

```bash
# Edit schema.ts, add a comment near the menus table (e.g. // PR B: multi-dish migration boundary)
pnpm --filter @ona/api exec drizzle-kit generate
```

Drizzle will detect "no actual change" and may skip. If so, manually create:

1. `apps/api/src/db/migrations/0030_menus_dishes.sql`:
   ```sql
   -- 0030_menus_dishes.sql
   -- No schema change; menus.days JSONB shape is rewritten by
   -- scripts/migrateMenusToDishes.ts which runs in RAILPACK_START_CMD.
   SELECT 1;
   ```

2. `apps/api/src/db/migrations/meta/0030_snapshot.json` — copy `0029_snapshot.json` verbatim (no schema delta) but bump the `"version"` field to `"7"` (or whatever the convention is — open `0029_snapshot.json` to confirm). Keep `"id"` unique (UUID v4).

3. Append to `apps/api/src/db/migrations/meta/_journal.json`:
   ```json
   {
     "idx": 30,
     "version": "7",
     "when": <unix-ms-timestamp>,
     "tag": "0030_menus_dishes",
     "breakpoints": true
   }
   ```
   Match the exact shape of the existing entries — look at `idx: 29` for the template.

**If you spend more than 10 minutes fighting Drizzle here, STOP and escalate.** The data migration can also be wired as a manual `pnpm` script invoked once during deploy instead of via a numbered migration — that's the fallback path.

- [ ] **Step 2: Write the data-migration script**

`apps/api/scripts/migrateMenusToDishes.ts`:

```ts
/**
 * One-shot data migration: rewrite menus.days[i][meal] from the legacy
 * single-recipe shape { recipeId, recipeName, … } to the multi-dish shape
 * { servings?, dishes: [{ kind:'recipe', recipeId, … }] }.
 *
 * Idempotent: rows already in the new shape (detected via `Array.isArray(slot.dishes)`)
 * are skipped. Safe to re-run after a partial apply.
 *
 * Triggered automatically on the next `ona-api` boot via RAILPACK_START_CMD.
 */
import { eq } from 'drizzle-orm'
import { db } from '../src/db/connection.js'
import { menus } from '../src/db/schema.js'

type LegacySlot = {
  recipeId: string
  recipeName?: string
  servings?: number | null
  pinnedType?: string | null
  kind?: 'planned' | 'leftover' | null
  leftoverOf?: { day: number; meal: string } | null
  imageUrl?: string | null
  prepTime?: number | null
  totalTime?: number | null
}

type NewSlot = {
  servings?: number | null
  dishes: Array<{
    kind: 'recipe'
    recipeId: string
    recipeName?: string
    pinnedType?: string | null
    variant?: 'planned' | 'leftover'
    leftoverOf?: { day: number; meal: string; dishPosition: number } | null
  }>
}

function migrateSlot(slot: unknown): NewSlot | undefined {
  if (slot == null) return undefined
  if (typeof slot !== 'object') return undefined
  if ('dishes' in slot && Array.isArray((slot as { dishes: unknown }).dishes)) {
    return slot as NewSlot   // already migrated
  }
  const legacy = slot as LegacySlot
  if (!legacy.recipeId) return undefined
  return {
    servings: legacy.servings ?? null,
    dishes: [
      {
        kind: 'recipe',
        recipeId: legacy.recipeId,
        recipeName: legacy.recipeName,
        pinnedType: legacy.pinnedType ?? null,
        variant: legacy.kind === 'leftover' ? 'leftover' : 'planned',
        leftoverOf: legacy.leftoverOf
          ? { ...legacy.leftoverOf, dishPosition: 0 }
          : null,
      },
    ],
  }
}

async function run(): Promise<void> {
  const rows = await db.select({ id: menus.id, days: menus.days }).from(menus)
  let migrated = 0
  let skipped = 0
  for (const row of rows) {
    const days = row.days as unknown
    if (!Array.isArray(days)) { skipped++; continue }
    let changed = false
    const newDays = days.map((day: Record<string, unknown>) => {
      const out: Record<string, unknown> = {}
      for (const meal of Object.keys(day)) {
        const migratedSlot = migrateSlot(day[meal])
        if (migratedSlot && migratedSlot !== day[meal]) changed = true
        out[meal] = migratedSlot
      }
      return out
    })
    if (!changed) { skipped++; continue }
    // CRITICAL: scope the UPDATE to the current row's id. Without the WHERE
    // clause every iteration rewrites the entire menus table.
    await db.update(menus).set({ days: newDays as any }).where(eq(menus.id, row.id))
    migrated++
  }
  console.log(`✓ Migrated ${migrated} menus (${skipped} already in new shape).`)
}

run().catch((e) => { console.error(e); process.exit(1) })
```

(The actual `eq` import from drizzle-orm is needed — keep the import block accurate.)

- [ ] **Step 3: Wire the script into the deploy boot sequence**

In Railway's `RAILPACK_START_CMD` for `ona-api`, prepend the data migration:

```
pnpm --filter @ona/api db:migrate && pnpm --filter @ona/api tsx scripts/migrateMenusToDishes.ts && node apps/api/dist/index.js
```

(Document this in `docs/deploy.md` under "Pre-PR-B deploy steps". The implementer must update the Railway env var manually before `railway up`.)

- [ ] **Step 4: Run the migration locally + verify**

```bash
pnpm --filter @ona/api db:migrate
pnpm --filter @ona/api tsx scripts/migrateMenusToDishes.ts
psql "$DATABASE_URL" -c "SELECT id, jsonb_path_query(days::jsonb, '\$[0].lunch.dishes[0].recipeId') FROM menus LIMIT 3;"
```

Expected: the query returns rows where lunch has a `dishes[]` array.

- [ ] **Step 5: Run it a second time — confirm idempotent**

```bash
pnpm --filter @ona/api tsx scripts/migrateMenusToDishes.ts
```

Expected: `✓ Migrated 0 menus (N already in new shape).`

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/db/migrations/0030_menus_dishes.sql apps/api/src/db/migrations/meta apps/api/scripts/migrateMenusToDishes.ts
git commit -m "feat(db): migration 0030 + script — rewrite menus.days to multi-dish shape (idempotent)"
```

### Task B.4: Course-aware matcher wrapper

**Files:**
- Create: `apps/api/src/services/courseAwareMatcher.ts`
- Create: `apps/api/src/tests/courseAwareMatcher.test.ts`

- [ ] **Step 1: Write the failing tests**

`apps/api/src/tests/courseAwareMatcher.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { findForCourse } from '../services/courseAwareMatcher.js'
import type { RecipeWithIngredients } from '../services/recipeMatcher.js'

function r(id: string, course: 'starter' | 'main' | 'dessert' | null): RecipeWithIngredients & { course: typeof course } {
  return {
    id,
    name: id,
    meals: ['lunch'],
    seasons: ['summer'],
    tags: [],
    ingredients: [],
    course,
  }
}

const baseOptions = {
  meal: 'lunch' as const,
  season: 'summer' as const,
  usedRecipeIds: new Set<string>(),
  restrictions: [],
  favoriteRecipeIds: new Set<string>(),
}

describe('courseAwareMatcher.findForCourse', () => {
  it('with course=null excludes starters and desserts from candidates', () => {
    const all = [r('s1', 'starter'), r('m1', 'main'), r('d1', 'dessert'), r('u1', null)]
    const picked = findForCourse(all, null, baseOptions)
    expect(picked).toBeDefined()
    expect(picked!.id).toMatch(/m1|u1/)   // never s1 or d1
  })

  it('with course="starter" only picks starters', () => {
    const all = [r('s1', 'starter'), r('m1', 'main'), r('d1', 'dessert')]
    const picked = findForCourse(all, 'starter', baseOptions)
    expect(picked?.id).toBe('s1')
  })

  it('with course="main" only picks mains', () => {
    const all = [r('s1', 'starter'), r('m1', 'main')]
    const picked = findForCourse(all, 'main', baseOptions)
    expect(picked?.id).toBe('m1')
  })

  it('with course="dessert" only picks desserts', () => {
    const all = [r('s1', 'starter'), r('d1', 'dessert')]
    const picked = findForCourse(all, 'dessert', baseOptions)
    expect(picked?.id).toBe('d1')
  })

  it('returns undefined when no candidates match (caller should record a warning)', () => {
    const all = [r('m1', 'main')]
    const picked = findForCourse(all, 'dessert', baseOptions)
    expect(picked).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run, confirm fails**

```bash
pnpm --filter @ona/api exec vitest run src/tests/courseAwareMatcher.test.ts
```

Expected: FAIL (`findForCourse` not exported).

- [ ] **Step 3: Implement `apps/api/src/services/courseAwareMatcher.ts`**

```ts
import { findRecipeForSlot, type MatcherOptions, type RecipeWithIngredients } from './recipeMatcher.js'
import type { Course } from '@ona/shared'

type WithCourse = RecipeWithIngredients & { course?: Course | null }

/**
 * Course-aware wrapper around findRecipeForSlot. Filters the candidate pool
 * upstream of the matcher's other criteria (season, banned, restrictions, …)
 * so the matcher only sees recipes that fit the target course.
 *
 * Rule:
 *   - course === 'starter' | 'main' | 'dessert': only that course.
 *   - course === null: matcher's "single-dish" mode → only main OR null.
 */
export function findForCourse(
  pool: WithCourse[],
  course: Course | null,
  options: MatcherOptions,
): WithCourse | undefined {
  const filtered = pool.filter((r) => {
    const c = r.course ?? null
    if (course === null) return c === 'main' || c === null
    return c === course
  })
  return findRecipeForSlot(filtered, options) as WithCourse | undefined
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
pnpm --filter @ona/api exec vitest run src/tests/courseAwareMatcher.test.ts
```

Expected: PASS (5/5).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/courseAwareMatcher.ts apps/api/src/tests/courseAwareMatcher.test.ts
git commit -m "feat(api): course-aware matcher wrapper (N=1 excludes starter/dessert)"
```

### Task B.5: Auto-generator honors `mealDishCounts`

**Files:**
- Modify: `apps/api/src/services/menuGenerator.ts`

- [ ] **Step 1: Add `extractMealDishCounts` helper**

Just below `extractMealDiners` (around line 127 of `menuGenerator.ts`), add a parallel reader:

```ts
import type { MealDishCounts } from '@ona/shared'

/**
 * Per-meal-type dish count, parsed from userSettings.template's junk-drawer
 * blob: `{ mealDishCounts: { breakfast?: 1|2|3, lunch?: 1|2|3, ... } }`.
 * Missing entries default to 1 in `dishCountFor`. Invalid values (anything
 * outside 1/2/3) are dropped.
 */
export function extractMealDishCounts(raw: unknown): MealDishCounts {
  if (!raw || typeof raw !== 'object') return {}
  const blob = raw as { mealDishCounts?: unknown }
  const mdc = blob.mealDishCounts
  if (!mdc || typeof mdc !== 'object') return {}
  const out: MealDishCounts = {}
  for (const [meal, count] of Object.entries(mdc as Record<string, unknown>)) {
    if (count === 1 || count === 2 || count === 3) {
      out[meal as keyof MealDishCounts] = count
    }
  }
  return out
}
```

- [ ] **Step 2: Update the slot-fill loop**

Find where the generator iterates `(day, meal)` and calls `findRecipeForSlot(...)`. Replace the single-recipe pick with a loop over `coursesFor(dishCountFor(meal, counts))`:

```ts
import { findForCourse } from './courseAwareMatcher.js'
import { dishCountFor, coursesFor } from './menuDishes.js'
import type { Dish, RecipeDish } from '@ona/shared'
// `extractMealDishCounts` lives in this same file (Step 1 above); call it directly,
// no import line needed.

// At the top of the generator (where userSettings is parsed):
const mealDishCounts = extractMealDishCounts(rawTemplate)

// Inside the slot loop:
const wantedCount = dishCountFor(meal, mealDishCounts)
const wantedCourses = coursesFor(wantedCount)
const dishes: Dish[] = []
const warnings: string[] = []

for (const course of wantedCourses) {
  const picked = findForCourse(recipesWithIngredients, course, {
    meal, season, usedRecipeIds, restrictions, favoriteRecipeIds,
    bannedRecipeIds, dayIndex, dislikes, availableEquipment, maxPrepMinutes,
  })
  if (!picked) {
    warnings.push(`no_${course ?? 'main'}_available_${meal}_d${dayIndex}`)
    continue
  }
  usedRecipeIds.add(picked.id)
  dishes.push({
    kind: 'recipe',
    recipeId: picked.id,
    recipeName: picked.name,
    course: picked.course ?? null,
  })
}

// Set the slot:
day[meal] = { servings: defaultDinersForSlot, dishes }
```

Return `warnings` in the generator's result. Surface them up to the route response (Task B.6).

- [ ] **Step 3: Typecheck**

```bash
pnpm --filter @ona/api exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/api/src/services/menuGenerator.ts
git commit -m "feat(menu): generator honors mealDishCounts + course progression (with warnings)"
```

### Task B.6: API — dish-level routes + slot-level adjustments

**Files:**
- Modify: `apps/api/src/routes/menus.ts`
- Create: `apps/api/src/tests/menusRouteDish.smoke.ts`

This is the biggest API change. Break it into sub-steps.

#### Task B.6.a: Adjust existing slot-level routes

- [ ] **Step 1: Update `POST /menu/generate` to surface warnings**

Find the route around line 100. After `runGenerator(...)` returns, include `warnings` in the response JSON:

```ts
const { menu, warnings } = await runGenerator(...)
res.json({ ...menu, warnings })
```

- [ ] **Step 2: Update `PUT /menu/:menuId/day/:day/meal/:meal` to operate on dishes**

This is the single-slot regenerate handler (find it with `grep -n "router\.put.*meal" apps/api/src/routes/menus.ts` — it's the route at line ~305 in current master). With multi-dish, it regenerates all recipe dishes (notes stay in place). Pseudocode:

```ts
// Inside the existing PUT handler, after the slot is loaded:
const currentRecipeIndexes: number[] = []
slot.dishes.forEach((d, i) => { if (d.kind === 'recipe') currentRecipeIndexes.push(i) })

// Re-pick a recipe for each, preserving the course at that position:
const newDishes = [...slot.dishes]
for (const i of currentRecipeIndexes) {
  const currentCourse = (slot.dishes[i] as RecipeDish).course ?? null
  const picked = findForCourse(recipesWithIngredients, currentCourse, matcherOptions)
  if (!picked) continue   // keep the old dish if no candidate
  newDishes[i] = {
    kind: 'recipe',
    recipeId: picked.id,
    recipeName: picked.name,
    course: picked.course ?? null,
  }
}

// Notes at positions outside currentRecipeIndexes are untouched.
days[day][meal] = { ...slot, dishes: newDishes }
```

- [ ] **Step 3: Update `PATCH /menu/:menuId/day/:day/meal/:meal`**

Strip `pinnedType` from the body schema; that field moved to dish-level. Keep `servings`.

- [ ] **Step 4: Update the existing `POST /menu/:menuId/ban` (no per-slot ban route exists)**

Reality check: the codebase only has `POST /menu/:menuId/ban` with body `{recipeId}` — there's no per-slot ban endpoint. The spec's mention of `?dishPosition=N` was based on a misread. The existing route already takes `recipeId` directly in the body, so it works unchanged with multi-dish — the UI's "..." action menu on a dish-row passes that dish's `recipeId` and the ban applies week-wide as before. **No code change needed in this step**; just leave the route as-is. Mark the step done.

- [ ] **Step 5: Update `POST /menu/:menuId/day/:day/leftover`**

Param name is `:day` (the target day), not `:targetDay` — check the existing handler at line ~1006 in master. Body already carries `{sourceDay, sourceMeal, targetMeal}`. With multi-dish:

```ts
// Inside the handler, after loading sourceSlot:
const clonedDishes: Dish[] = sourceSlot.dishes
  .map((d, sourcePos) => d.kind === 'recipe'
    ? {
        ...d,
        variant: 'leftover' as const,
        leftoverOf: { day: sourceDay, meal: sourceMeal, dishPosition: sourcePos },
      }
    : null
  )
  .filter((d): d is RecipeDish => d !== null)
// Notes are dropped — they don't make sense as "leftovers".
days[day][targetMeal] = { servings: sourceSlot.servings, dishes: clonedDishes }
```

- [ ] **Step 6: Typecheck after each sub-step**

```bash
pnpm --filter @ona/api exec tsc --noEmit
```

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/routes/menus.ts
git commit -m "refactor(menus): existing slot routes consume new dishes[] shape"
```

#### Task B.6.b: New dish-level routes

- [ ] **Step 1: Add `POST /dish` (append a dish)**

After the existing `POST /menu/:menuId/day/:day/meal/:meal` route (around line 521), add:

```ts
const addDishSchema = z.union([
  z.object({ kind: z.literal('recipe'), recipeId: z.string().uuid(), course: courseSchema.optional(), pinnedType: z.string().nullable().optional() }),
  z.object({ kind: z.literal('note'), text: z.string().min(1).max(120) }),
])

router.post('/menu/:menuId/day/:day/meal/:meal/dish', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const day = Number(req.params.day)
    const meal = String(req.params.meal)
    const parsed = addDishSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid dish payload', details: parsed.error.issues })
      return
    }
    const [menu] = await db.select().from(menus).where(eq(menus.id, menuId)).limit(1)
    if (!menu) { res.status(404).json({ error: 'Menu not found' }); return }
    const days = menu.days as DayMenu[]
    const slot = days[day]?.[meal] ?? { servings: null, dishes: [] }
    const next = addDish(slot.dishes, parsed.data)
    days[day][meal] = { ...slot, dishes: next }
    await db.update(menus).set({ days: days as any }).where(eq(menus.id, menuId))
    res.json({ position: next.length - 1, dish: next[next.length - 1] })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
```

- [ ] **Step 2: Add `DELETE /dish/:position`**

```ts
router.delete('/menu/:menuId/day/:day/meal/:meal/dish/:position', async (req: AuthRequest, res) => {
  try {
    const menuId = String(req.params.menuId)
    const day = Number(req.params.day)
    const meal = String(req.params.meal)
    const position = Number(req.params.position)
    const [menu] = await db.select().from(menus).where(eq(menus.id, menuId)).limit(1)
    if (!menu) { res.status(404).json({ error: 'Menu not found' }); return }
    const days = menu.days as DayMenu[]
    const slot = days[day]?.[meal]
    if (!slot) { res.status(404).json({ error: 'Slot not found' }); return }
    if (position < 0 || position >= slot.dishes.length) {
      res.status(400).json({ error: 'Position out of range' }); return
    }
    const next = removeDishAt(slot.dishes, position)
    days[day][meal] = { ...slot, dishes: next }
    await db.update(menus).set({ days: days as any }).where(eq(menus.id, menuId))
    res.json({ dishes: next })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
})
```

- [ ] **Step 3: Add `PATCH /dish/:position`**

Body: `{text?, pinnedType?, newPosition?, course?}`.

**Precedence rule** (codify in the handler):
- If `newPosition` is present, ignore the other fields and call `reorderDish(dishes, position, newPosition)`. The reorder is the only operation for this request.
- Otherwise call `patchDish(dishes, position, {text, pinnedType, course})`.

This keeps the request unambiguous — "patch and move" in one round-trip is not supported. A client that needs both fires two PATCH calls.

```ts
const patchDishSchema = z.object({
  text: z.string().max(120).optional(),
  pinnedType: z.string().nullable().optional(),
  newPosition: z.number().int().nonnegative().optional(),
  course: courseSchema.optional(),
})

router.patch('/menu/:menuId/day/:day/meal/:meal/dish/:position', async (req, res) => {
  // ...load menu, parse body, apply reorderDish OR patchDish, save.
})
```

- [ ] **Step 4: Add `POST /dish/:position/regenerate`**

Aleatorio on one dish. Reject 400 if the dish is a note.

```ts
router.post('/menu/:menuId/day/:day/meal/:meal/dish/:position/regenerate', async (req, res) => {
  // ...load menu+slot, get dishes[position]; if it's a note → 400.
  // Build matcher options from user settings + week context (existing helpers).
  // Call findForCourse(allRecipes, currentDish.course ?? null, options).
  // Replace dishes[position] with the new recipe dish; preserve order.
})
```

- [ ] **Step 5: Typecheck**

```bash
pnpm --filter @ona/api exec tsc --noEmit
```

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/routes/menus.ts
git commit -m "feat(menus): 4 dish-level routes (POST/DELETE/PATCH/POST regenerate)"
```

#### Task B.6.c: Route smoke tests

- [ ] **Step 1: Write `apps/api/src/tests/menusRouteDish.smoke.ts`**

Mirror the existing `menusRoute.smoke.ts` shape (read it first to lift the harness — `seedTestMenu`, `signTokenFor`, `request(app)` etc).

Skeleton to expand (each block is one `it()`):

```ts
import { describe, it, expect, beforeAll } from 'vitest'
// reuse the helpers from menusRoute.smoke.ts: app, signTokenFor, seedTestMenu
// (extract them into a shared test helper if not already shared)

describe('Dish-level routes', () => {
  let menuId: string
  let ownerToken: string
  let otherToken: string

  beforeAll(async () => {
    ({ menuId, ownerToken, otherToken } = await seedTestMenu())   // returns ids + tokens for owner and a different user
  })

  describe('POST /dish', () => {
    it('appends a recipe dish and returns position', async () => { /* expect status 200, position === current length */ })
    it('appends a note dish', async () => { /* body {kind:'note', text:'pan con tomate'} */ })
    it('400 on missing kind', async () => { /* expect 400, error mentions Invalid */ })
    it('400 on text > 120 chars', async () => { /* expect 400 */ })
    it('403 when caller does not own the menu', async () => { /* otherToken → 403 */ })
  })

  describe('DELETE /dish/:position', () => {
    it('removes the dish and decrements subsequent positions', async () => { /* … */ })
    it('400 on position out of range', async () => { /* … */ })
    it('403 cross-user', async () => { /* … */ })
  })

  describe('PATCH /dish/:position', () => {
    it('edits note text', async () => { /* … */ })
    it('reorders via newPosition', async () => { /* assert order */ })
    it('ignores text on a recipe dish', async () => { /* recipe dish payload still has its name afterwards */ })
    it('403 cross-user', async () => { /* … */ })
  })

  describe('POST /dish/:position/regenerate', () => {
    it('replaces the recipe at that position', async () => { /* assert new recipeId */ })
    it('400 when targeting a note dish', async () => { /* … */ })
    it('403 cross-user', async () => { /* … */ })
  })
})
```

Aim for one assertion per `it()`. The IDOR checks (`403 cross-user`) reuse `otherToken` — the IDOR guard from PR #7 means a single 403 assertion per route suffices.

- [ ] **Step 2: Run**

```bash
pnpm --filter @ona/api exec vitest run src/tests/menusRouteDish.smoke.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/api/src/tests/menusRouteDish.smoke.ts
git commit -m "test(menus): route smoke for the 4 dish-level endpoints + IDOR"
```

### Task B.7: Shopping list + nutrition aggregators

**Files:**
- Modify: `apps/api/src/services/shoppingList.ts`
- Modify: `apps/api/src/services/advisor/summary.ts` (or wherever nutrition aggregates)
- Modify: `apps/api/src/tests/shoppingList.test.ts` (or create if missing)

- [ ] **Step 1: Find every place the legacy slot-shape `recipeId` is read**

Narrow the grep to avoid false positives from unrelated `.recipeId` accesses (favourites, shopping items, ingredient overrides — those stay as-is):

```bash
grep -rn 'slot\.recipeId\|slot\.kind\|slot\.imageUrl\|slot\.prepTime\|slot\.totalTime\|slot\.pinnedType' apps/api/src/services/ | grep -v '\.test\.ts'
```

Expected files: `shoppingList.ts`, `menuGenerator.ts`, anything under `services/advisor/`. If a hit appears in a service you didn't expect (e.g. `pantryMatcher.ts`), open it and adapt the read.

- [ ] **Step 2: Replace each read with a `dishes[]` iteration**

Pattern:

```ts
// Before
const recipeId = slot.recipeId
const isLeftover = slot.kind === 'leftover'

// After
for (const dish of slot.dishes) {
  if (dish.kind !== 'recipe') continue
  const recipeId = dish.recipeId
  const isLeftover = dish.variant === 'leftover'
  // ...existing per-recipe logic
}
```

`servings` stays at slot level (no change to that read).

- [ ] **Step 3: Write/extend the shopping aggregator test**

Add cases:
- Slot with one recipe + one note → only the recipe contributes to `ShoppingItem[]`.
- Slot with only a note → contributes 0 items.
- Slot with two recipes referring to the same recipeId → `sumDinersByRecipe` collapses them.

```bash
pnpm --filter @ona/api exec vitest run src/tests/shoppingList.test.ts
```

Expected: PASS.

- [ ] **Step 4: Typecheck**

```bash
pnpm --filter @ona/api exec tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/shoppingList.ts apps/api/src/services/advisor apps/api/src/tests
git commit -m "feat(aggregators): shopping + nutrition iterate dishes[], skip notes"
```

### Task B.8: Frontend hooks for the 4 dish endpoints

**Files:**
- Modify: `apps/web/src/hooks/useMenu.ts` (or wherever menu hooks live)

- [ ] **Step 1: Add 4 hooks**

```ts
export function useAddDish() {
  return useMutation({
    mutationFn: async (args: { menuId: string; day: number; meal: string; payload: AddDishPayload }) => {
      return apiFetch(`/menu/${args.menuId}/day/${args.day}/meal/${args.meal}/dish`, {
        method: 'POST',
        body: JSON.stringify(args.payload),
      })
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['menu'] }),
  })
}

export function useRemoveDish() { /* same shape, DELETE */ }
export function usePatchDish() { /* same shape, PATCH */ }
export function useRegenerateDish() { /* same shape, POST /regenerate */ }
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @ona/web exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/hooks/useMenu.ts
git commit -m "feat(hooks): useAddDish / useRemoveDish / usePatchDish / useRegenerateDish"
```

### Task B.9: `<DishRow>` component

**Files:**
- Create: `apps/web/src/components/menu/DishRow.tsx`

- [ ] **Step 1: Scaffold**

```tsx
"use client"

import type { Dish } from '@ona/shared'
import { Coffee, Sparkles, X } from 'lucide-react'

interface Props {
  dish: Dish
  onClickThumb?: () => void
  onRegenerate?: () => void
  onRemove?: () => void
  onEditNote?: () => void
}

export function DishRow({ dish, onClickThumb, onRegenerate, onRemove, onEditNote }: Props) {
  if (dish.kind === 'note') {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-[#DDD6C5] bg-[#FFFEFA] px-3 py-2.5">
        <Coffee size={16} className="shrink-0 text-[#7A7066]" />
        <p className="flex-1 truncate text-[13px] italic text-[#4A4239]">{dish.text}</p>
        {onEditNote && <button onClick={onEditNote} className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">Editar</button>}
        {onRemove && <button onClick={onRemove} aria-label="Quitar"><X size={14} className="text-[#7A7066]" /></button>}
      </div>
    )
  }
  // Recipe dish
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-2.5">
      <button onClick={onClickThumb} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-[#F2EDE0]">
        {dish.imageUrl
          ? <img src={dish.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          : <div className="flex h-full w-full items-center justify-center text-[#7A7066]"><Sparkles size={18} /></div>}
      </button>
      <div className="min-w-0 flex-1">
        {dish.course && (
          <p className="m-0 text-[9px] uppercase tracking-[0.15em] text-[#7A7066]">
            {dish.course === 'starter' ? 'Entrante' : dish.course === 'dessert' ? 'Postre' : 'Principal'}
          </p>
        )}
        <p className="truncate text-[13px] font-medium text-[#1A1612]">{dish.recipeName ?? '—'}</p>
        {dish.totalTime != null && <p className="text-[11px] text-[#7A7066]">{dish.totalTime} min</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {onRegenerate && <button onClick={onRegenerate} className="text-[10px] uppercase tracking-[0.12em] text-[#C65D38]">Aleatorio</button>}
        {onRemove && <button onClick={onRemove} aria-label="Quitar"><X size={14} className="text-[#7A7066]" /></button>}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

```bash
pnpm --filter @ona/web exec tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/menu/DishRow.tsx
git commit -m "feat(menu): DishRow component (recipe + note rendering)"
```

### Task B.10: `<AddDishSheet>` bottom sheet

**Files:**
- Create: `apps/web/src/components/menu/AddDishSheet.tsx`

- [ ] **Step 1: Scaffold**

3 buttons: Aleatorio (auto-pick next missing course) · Elegir del catálogo (opens existing `RecipePickerSheet`) · Añadir nota (textarea with 120-char counter).

Read the existing `RecipePickerSheet.tsx` for the sheet shell pattern (motion, backdrop, exit gesture).

- [ ] **Step 2: Typecheck + manual smoke**

Mount it in a story or directly in `/menu` for a quick check. Make sure each option calls the right hook.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/menu/AddDishSheet.tsx
git commit -m "feat(menu): AddDishSheet (Aleatorio / Elegir / Añadir nota)"
```

### Task B.11: `<EditorialMealCard>` hybrid render

**Files:**
- Modify: `apps/web/src/app/menu/page.tsx` (the inline `EditorialMealCard` at ~line 890)

- [ ] **Step 1: Branch the render** (find the function with `grep -n "function EditorialMealCard" apps/web/src/app/menu/page.tsx` — line numbers drift between sessions)

```tsx
function EditorialMealCard({ meal, ... }: Props) {
  const dishCount = meal.dishes.length

  // Empty slot (DELETE last dish landed here): render the same placeholder
  // as a never-populated slot. The "+ Añadir plato" trigger sits at the bottom
  // of the stacked card body — share it across this branch and the multi-dish
  // branch by rendering MultiDishStackedCard with an empty dishes[].
  if (dishCount === 0) {
    return <MultiDishStackedCard slot={meal} ... />
  }

  if (dishCount === 1) {
    return <SingleDishHeroCard dish={meal.dishes[0]} slot={meal} ... />
  }
  return <MultiDishStackedCard slot={meal} ... />
}
```

`<SingleDishHeroCard>` keeps the current hero look. `<MultiDishStackedCard>` renders an eyebrow header + `<DishRow>` per dish + `+ Añadir plato` button.

- [ ] **Step 2: Wire up the per-dish actions**

Each `<DishRow>` calls the hooks from Task B.8. The slot-level actions (servings, lock) stay in the eyebrow.

- [ ] **Step 3: Add DnD reorder within the slot**

Use `@dnd-kit/sortable` (already in the project, see `apps/web/src/components/recipes/SortableStepsList.tsx` for the pattern). Grip handle on each `<DishRow>`. On drop, call `usePatchDish` with `{newPosition}`.

- [ ] **Step 4: Manual smoke at 390 + 1440**

Test: single-dish slot renders unchanged. Multi-dish (manually crafted via DB) renders the stacked card. `+ Añadir plato` opens the sheet. Per-dish Aleatorio / Quitar work. DnD reorder works.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/menu/page.tsx
git commit -m "feat(menu): EditorialMealCard hybrid render (single-dish hero / multi-dish stack) + DnD reorder"
```

### Task B.12: Vista Semana `+N más` badge

**Files:**
- Modify: `apps/web/src/components/menu/WeekGridView.tsx`

- [ ] **Step 1: Read `dishes[0]` for the hero photo**

Replace any `slot.recipeId` / `slot.imageUrl` reads with `slot.dishes[0]?.kind === 'recipe' ? slot.dishes[0] : null`. If the first dish is a note, render the existing "no photo" fallback with the note text.

- [ ] **Step 2: Add the badge**

Where the recipe name is rendered, append:

```tsx
{slot.dishes.length > 1 && (
  <span className="ml-1 text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">
    +{slot.dishes.length - 1} más
  </span>
)}
```

- [ ] **Step 3: Typecheck + manual smoke**

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/menu/WeekGridView.tsx
git commit -m "feat(menu): Vista Semana shows '+N más' badge when slot has multi-dish"
```

### Task B.13: `<MealDishCountControls>` + plantilla integration

**Files:**
- Create: `apps/web/src/components/profile/MealDishCountControls.tsx`
- Modify: `apps/web/src/app/profile/page.tsx`

- [ ] **Step 1: Scaffold the component**

```tsx
"use client"

import { MEAL_LABELS } from '@/lib/labels'
import type { Meal } from '@ona/shared'

const MEALS: Meal[] = ['breakfast', 'lunch', 'dinner', 'snack']

interface Props {
  value: Partial<Record<Meal, 1 | 2 | 3>>
  onChange: (next: Partial<Record<Meal, 1 | 2 | 3>>) => void
}

export function MealDishCountControls({ value, onChange }: Props) {
  return (
    <section className="space-y-2">
      <h3 className="text-eyebrow text-[#7A7066]">Platos por comida</h3>
      <div className="space-y-2">
        {MEALS.map((meal) => {
          const current = value[meal] ?? 1
          return (
            <div key={meal} className="flex items-center justify-between rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] px-4 py-3">
              <span className="text-[14px] text-[#1A1612]">{MEAL_LABELS[meal]}</span>
              <div className="inline-flex gap-1 rounded-full border border-[#DDD6C5] bg-[#FAF6EE] p-0.5">
                {[1, 2, 3].map((n) => (
                  <button
                    key={n}
                    onClick={() => onChange({ ...value, [meal]: n as 1 | 2 | 3 })}
                    className={`rounded-full px-3 py-1 text-[12px] ${current === n ? 'bg-[#1A1612] text-[#FAF6EE]' : 'text-[#7A7066]'}`}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
```

- [ ] **Step 2: Mount in `/profile/page.tsx`**

Find the plantilla section (the day × meal grid). Mount `<MealDishCountControls>` above the grid. Wire to the existing `userSettings` mutation — store the value in the same template blob as `mealDishCounts`.

- [ ] **Step 3: Verify the server reads it**

The `extractMealDishCounts` helper from Task B.5 already handles this. Smoke: change the lunch count to 2 in `/profile`, save, click "Regenerar semana" on `/menu` → the regenerated week should produce 2-dish lunches.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/profile/MealDishCountControls.tsx apps/web/src/app/profile/page.tsx
git commit -m "feat(profile): MealDishCountControls for plantilla (1/2/3 platos por meal-type)"
```

### Task B.14: Update specs

**Files:**
- Modify: `specs/menus.md`
- Modify: `specs/shopping.md`
- Modify: `specs/advisor.md`

- [ ] **Step 1: `menus.md` — Multi-dish section**

Append a section near "Menu Structure":

```markdown
## Multi-dish slots

Each `MealSlot` now holds `dishes: Dish[]` (ordered). A `Dish` is either a `RecipeDish` (catalogue recipe) or a `NoteDish` (free-text, `{kind:'note', text}`).

Per-meal-type dish count lives in `userSettings.template.mealDishCounts: { breakfast?: 1|2|3, ... }`. Default 1. The generator maps:
- 1 → matcher restricted to `course IN ('main') OR course IS NULL` (single-plate convention; starters and desserts are auto-skipped).
- 2 → `[starter, main]`.
- 3 → `[starter, main, dessert]`.

When a course has no candidates, the generator emits a warning `no_<course>_available_<meal>_d<dayIndex>` in the response and produces fewer dishes for that slot. The UI shows a toast with the warning list.

Notes are excluded from the matcher and added only via manual UI (`+ Añadir plato` → "Añadir nota"). They don't contribute to shopping or nutrition.

### Dish-level routes (all under `/menu/:menuId/day/:day/meal/:meal/dish`)

- `POST` — append a dish (recipe or note). Body discriminated by `kind`.
- `DELETE /:position` — remove. Subsequent positions decrement.
- `PATCH /:position` — edit `{text? | pinnedType? | newPosition? | course?}`. Fields that don't apply to the dish kind are ignored.
- `POST /:position/regenerate` — Aleatorio on one dish, respects its course. 400 on a note.

All gated by the `:menuId` IDOR guard from PR #7 (400/404/403 short-circuit before any body parsing).

### Per-dish vs slot-level behaviour

- **Slot-level (unchanged)**: `servings`, `locked`, move-slot (DnD between slots moves the whole slot).
- **Per-dish (new)**: `course`, `pinnedType`, `variant: 'planned'|'leftover'`, `leftoverOf.dishPosition`, reorder within slot.
```

- [ ] **Step 2: `shopping.md` — Note semantics**

Append:

```markdown
### Note dishes

A meal slot may contain `NoteDish` entries (`{kind:'note', text}`) alongside recipe dishes. The shopping aggregator iterates `slot.dishes` and processes only `kind:'recipe'` entries; notes contribute zero items. A day whose only dish is a note ("comemos fuera") produces no shopping items for that meal.
```

- [ ] **Step 3: `advisor.md` — Nutrition exclusion**

Append:

```markdown
### Multi-dish + notes

The advisor nutrition aggregator (and all weekly nutrient summaries) iterate `slot.dishes` and process only `kind:'recipe'`. Notes contribute zero calories. A user logging "comemos en casa de Paqui" as a note for lunch will see that meal as 0 kcal in the weekly summary — by design.
```

- [ ] **Step 4: Commit**

```bash
git add specs/menus.md specs/shopping.md specs/advisor.md
git commit -m "docs(spec): multi-dish + notes — menus.md, shopping.md, advisor.md (PR B)"
```

### Task B.15: Ship PR B

- [ ] **Step 1: Final local checks**

```bash
pnpm --filter @ona/api exec tsc --noEmit
pnpm --filter @ona/web exec tsc --noEmit
pnpm --filter @ona/api exec vitest run
```

Expected: all green.

- [ ] **Step 2: Update Railway's `RAILPACK_START_CMD` for `ona-api`**

Per Task B.3 Step 3, the start command must now include the data migration:

```
pnpm --filter @ona/api db:migrate && pnpm --filter @ona/api tsx scripts/migrateMenusToDishes.ts && node apps/api/dist/index.js
```

Verify via Railway dashboard or `railway variables get` before deploying.

- [ ] **Step 3: Deploy API first**

```bash
git push origin master
railway up --service ona-api --detach
```

Watch the boot logs for the migration message: `✓ Migrated N menus`.

- [ ] **Step 4: Deploy web**

```bash
railway up --service ona-web --detach
```

- [ ] **Step 5: Smoke-test prod**

- Open `/menu` at desktop. Existing menus should render with single-dish slots looking identical to before.
- Change `/profile` plantilla → lunch=2 platos → save.
- Click "Regenerar semana" → lunches should come back as 2-dish slots.
- Add a free-text note ("pan con tomate") to a dinner slot. Verify it renders italic in the meal card.
- Visit `/shopping` — confirm the note doesn't appear as a shopping item.

- [ ] **Step 6: Mark PR B done**

Update `CLAUDE.md` "Backlog — shipped" entries with:

```markdown
_Multi-dish meals + free-text notes — shipped 2026-06-XX. Slots hold ordered `dishes[]`; each dish is a catalogue recipe or a free-text note. Per-meal-type dish count (1/2/3) configurable in plantilla. Course-aware auto-generator with N=1 excluding starter/dessert. 4 new dish-level API routes + UI hybrid render. See [`docs/superpowers/specs/2026-06-07-multi-dish-meals-design.md`](./docs/superpowers/specs/2026-06-07-multi-dish-meals-design.md)._
```

Commit + push.

---

## Definition of done

- [ ] PR A merged + `course:apply` run against prod with sensible distribution.
- [ ] PR B merged + data migration applied on prod (no menu row left in legacy shape).
- [ ] `pnpm exec tsc --noEmit` passes on `@ona/api` and `@ona/web`.
- [ ] `pnpm exec vitest run` passes on `@ona/api` (all new tests green).
- [ ] Manual smoke at desktop + mobile confirms: existing single-dish menus untouched; new 2/3-dish slots render correctly; notes render italic without thumbnail; shopping list ignores notes.
- [ ] Specs updated: `recipes.md` (PR A), `menus.md` + `shopping.md` + `advisor.md` (PR B).
- [ ] `CLAUDE.md` backlog updated.
- [ ] No new dependencies (this uses existing `@dnd-kit/sortable`, `motion/react`, Zod).

## Notes for the implementer

- **Mobile invariant is sacred for PR B.** Every UI change in `EditorialMealCard`, `WeekGridView`, `/profile/page.tsx` must keep the < md render byte-identical to today's (single-dish + horizontal day-strip etc).
- **The matcher's existing criteria still apply**. `findForCourse` only adds a course filter on top — season, banned, restrictions, equipment all still run.
- **Idempotency matters for both migrations.** Both `0029` (ADD COLUMN IF NOT EXISTS) and `0030` (script skips already-migrated rows) must be safe to re-run after a partial apply.
- **Deploy order is fixed**: API first (so the migration runs and the new endpoints exist), then web. This was already the convention before PR #7; the new data migration tightens it further.
- **Todo Miguel: update `RAILPACK_START_CMD` for `ona-api`** before `railway up` of PR B. Current: `pnpm --filter @ona/api db:migrate && node apps/api/dist/index.js`. New: `pnpm --filter @ona/api db:migrate && pnpm --filter @ona/api tsx scripts/migrateMenusToDishes.ts && node apps/api/dist/index.js`. This is a Railway dashboard env-var change — Claude cannot make it. Append a Todo Miguel item in CLAUDE.md when this plan kicks off PR B.
- **No E2E in this plan**. Per Miguel's call, the pre-existing red Playwright tests (cook locator + create redirect) are the next PR after PR B ships. Manual smoke covers regression in the meantime.

## Skills referenced

- `@superpowers:subagent-driven-development` — recommended execution path.
- `@superpowers:executing-plans` — alternative for batched inline execution.
- `@superpowers:test-driven-development` — followed throughout (pure logic tests-first).
