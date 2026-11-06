# «Cocinar ahora» — plan de trabajo

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa superpowers:subagent-driven-development (recomendado) o superpowers:executing-plans para hacer este plan tarea a tarea. Los pasos usan casillas (`- [ ]`) para seguir el avance.

**Objetivo:** una pestaña «Cocinar» que, con cuatro preguntas (tiempo, personas, si se puede comprar algo y la despensa confirmada), propone una receta preferente y dos alternativas, la pone en la comida de hoy, abre el modo cocina y deja el menú en «✓ Comido» al terminar.

**Arquitectura:** cada ingrediente de receta gana un papel (imprescindible / secundario) y sustitutos; la oficina los marca en el catálogo y, mientras no estén, decide una regla automática pura. Una búsqueda pura (`services/cookNow/search.ts`) filtra con el cargador del menú (`loadMatchableRecipes` + `matchRecipes`) y ordena con la despensa. Cuatro rutas `/cook-now/*` sirven a la web; la lógica compartida entre web y API (comida de ahora, platos planeados, días a los que mover) vive en `@ona/shared`.

**Diseño aprobado:** [docs/superpowers/specs/2026-11-03-cocinar-ahora-design.md](../specs/2026-11-03-cocinar-ahora-design.md). Léelo antes de empezar.

**Tecnología:** Express + Drizzle (PostgreSQL) en `apps/api`, Next.js 15 + React 19 + TanStack Query + Tailwind v4 en `apps/web`, zod en `packages/shared`, vitest y Playwright.

---

## Antes de empezar

- **Rama y carpeta:** varias sesiones de Claude trabajan a la vez en `~/ona`. Trabaja en una carpeta aparte, **fuera de `.claude/`**:
  ```bash
  cd ~/ona && git fetch origin && git worktree add ~/ona-cocinar -b feat/cocinar-ahora origin/master
  cd ~/ona-cocinar && pnpm install --frozen-lockfile
  ```
  Comprueba primero que el diseño y este plan están en `origin/master` (`git ls-tree origin/master docs/superpowers/plans/ | grep cocinar`). Si no, súbelos antes como documentación (directo a `master` está permitido para docs) o la carpeta nueva no los tendrá.
- **Puerta de crecimiento** (D-158, en el `CLAUDE.md`): esta función protege el paso **«primer acierto»** de la línea de crecimiento (cocinar un plato del menú): «Terminar» con contexto de menú deja el plato comido y registrado con su `menuId`. Lo vemos con los eventos de la tarea 12 bis (`cook_now_proposed`, `cook_now_chosen` y `meal_cooked` con `fromMenu`). No añade pasos entre el alta y la primera semana resuelta: la pestaña es opcional y el Menú solo gana un enlace discreto.
- **El paquete compartido se compila:** tras tocar `packages/shared`, `pnpm --filter @ona/shared build` antes de correr las pruebas de la API o de la web.
- **Comandos:**
  - Una prueba de la API: `pnpm --filter @ona/api exec vitest run src/tests/<fichero>.test.ts`
  - Tipos: `pnpm --filter @ona/api lint` y `pnpm --filter @ona/web exec tsc --noEmit`
  - Playwright: `pnpm --filter @ona/web e2e -- e2e/<fichero>.spec.ts` (proyecto `mobile-chromium`, 390×844)
- **A producción solo se llega publicando desde la oficina** (`mcp__oficina__publicar` o el botón «Publicar»). Nunca `git push` a `master`, nunca `railway up`.
- **Textos de la app en español**, comentarios del código en inglés como el resto del repo.
- **Commits pequeños**, uno por tarea, terminando con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Mapa de ficheros

**Nuevos**
| Fichero | Para qué |
|---|---|
| `packages/shared/src/types/ingredientRole.ts` | `INGREDIENT_ROLES`, `IngredientRole`, esquema zod del marcado |
| `packages/shared/src/cookNow.ts` | comida de ahora, platos planeados, días a los que mover, línea de cada propuesta, esquemas zod de `/cook-now/*` |
| `apps/api/src/services/ingredientRoles.ts` | conservar marcado al editar, copiarlo, regla automática |
| `apps/api/src/services/cookNow/search.ts` | búsqueda pura: tiempo, cobertura, filtro, orden |
| `apps/api/src/services/cookNow/place.ts` | pura: poner la receta en la comida y mover lo planeado |
| `apps/api/src/services/cookNow/load.ts` | lo que lee de la BD: candidatas, despensa, básicos, menú de hoy |
| `apps/api/src/services/cookNow/phrase.ts` | la frase de Mimo |
| `apps/api/src/routes/cookNow.ts` | `GET /cook-now/today`, `POST /cook-now/proposal`, `POST /cook-now/phrase`, `POST /cook-now/choose` |
| `apps/api/src/routes/ingredientRoles.ts` | `GET /admin/recipes/ingredient-roles/pending`, `PUT /admin/recipes/:id/ingredient-roles` |
| `apps/api/src/middleware/cocinaAuth.ts` | token de escritura de Cocina (`x-cocina-token`) o JWT de admin |
| `apps/web/src/app/cocinar/page.tsx` | la pestaña |
| `apps/web/src/components/cocinar/*` | tarjeta de hoy, preguntas, despensa a confirmar, propuesta, hoja «¿Y las…?», «Con lo que tienes» |
| `apps/web/src/components/pantry/PantryManager.tsx` | la despensa entera, sacada de `/profile/pantry` |
| `apps/web/src/hooks/useCookNow.ts` | hooks de TanStack Query |
| `apps/web/src/lib/cookHref.ts` | enlace al modo cocina con contexto de menú |
| `apps/web/src/lib/cookNowPayload.ts` | cuerpos de `/cook-now/*` que manda la web (con prueba de contrato) |
| `apps/web/src/lib/menuDiners.ts` | comensales del hogar contados como el Menú |
| `apps/web/e2e/cook-now.spec.ts` | el recorrido entero |
| `specs/cook-now.md` | spec nueva |

**Se tocan:** `apps/api/src/db/schema.ts`, una migración nueva, `services/recipePersistence.ts`, `routes/recipes.ts` (copia; se retira `match-pantry`), `services/assistant/skills.ts` (copia), `services/matchableRecipes.ts`, `services/recipeMatcher.ts` (tipo), `services/catalogImport.ts`, `scripts/catalogImport.ts` (dependencia nueva), `config/env.ts`, `index.ts`, `services/routeTemplates.ts`, `services/usageEvents.ts`, `apps/web/src/components/shared/Navbar.tsx` y `DesktopSidebar.tsx`, `app/menu/page.tsx`, `components/menu/DayMeals.tsx`, `app/recipes/[id]/cook/page.tsx`, `components/cooking/CookingShell.tsx`, `app/profile/pantry/page.tsx`, `app/profile/page.tsx` (enlace), `lib/usagePaths.ts`, y las specs y el `CLAUDE.md`.

**Se retiran:** `services/pantryMatcher.ts`, `tests/pantryMatcher.test.ts`, `hooks/usePantryMatch.ts`, `components/menu/PantryMatchCard.tsx`, la ruta `GET /recipes/match-pantry`.

---

## Fase 1 — Imprescindibles, secundarios y su marcado

### Tarea 1: tipos compartidos y columnas nuevas

**Ficheros:**
- Crear: `packages/shared/src/types/ingredientRole.ts`
- Modificar: `packages/shared/src/index.ts`, `apps/api/src/db/schema.ts:422-445`
- Crear: migración generada por drizzle-kit en `apps/api/src/db/migrations/`

- [ ] **Paso 1: tipos compartidos**

```ts
// packages/shared/src/types/ingredientRole.ts
import { z } from 'zod'

/**
 * Role of an ingredient inside one recipe («Cocinar ahora», 2026-11-03):
 * essential = without it it isn't that dish; secondary = it can be left out.
 * Marked by Cocina for catalogue recipes; null = not marked yet (the
 * automatic rule in the API decides).
 */
export const INGREDIENT_ROLES = ['essential', 'secondary'] as const
export type IngredientRole = (typeof INGREDIENT_ROLES)[number]

export const ingredientRoleMarkSchema = z.object({
  recipeIngredientId: z.string().uuid(),
  role: z.enum(INGREDIENT_ROLES),
  substituteIngredientIds: z.array(z.string().uuid()).max(5).default([]),
})
export type IngredientRoleMark = z.infer<typeof ingredientRoleMarkSchema>

export const ingredientRolesUpdateSchema = z.array(ingredientRoleMarkSchema).min(1).max(80)
```

En `packages/shared/src/index.ts`, junto a las otras exportaciones de `types/`:

```ts
export { INGREDIENT_ROLES, ingredientRoleMarkSchema, ingredientRolesUpdateSchema } from './types/ingredientRole.js'
export type { IngredientRole, IngredientRoleMark } from './types/ingredientRole.js'
```

- [ ] **Paso 2: columnas en `recipeIngredients`** (`apps/api/src/db/schema.ts`, dentro de la tabla, después de `displayUnit`):

```ts
  /**
   * «Cocinar ahora»: essential | secondary, marked by Cocina for catalogue
   * recipes (services/ingredientRoles.ts). Null = not marked: the automatic
   * rule decides. Survives edits (persistRecipe) and copies.
   */
  role: text('role'),
  /** Catalogue ingredients that can stand in for this one (nata → leche). */
  substituteIngredientIds: uuid('substitute_ingredient_ids').array().notNull().default(sql`ARRAY[]::uuid[]`),
```

y en el bloque de índices y `check(...)` de la tabla, añade:

```ts
  check('recipe_ingredients_role_check', sql`role IS NULL OR role IN ('essential', 'secondary')`),
```

- [ ] **Paso 3: generar la migración**

Run: `pnpm --filter @ona/api exec drizzle-kit generate --name ingredient_roles`
Expected: una migración nueva `01NN_ingredient_roles.sql` (el siguiente número libre; el journal ya lleva `idx` y `tag` desfasados, no los cuadres a mano) con `ALTER TABLE "recipe_ingredients" ADD COLUMN "role" text;`, `ADD COLUMN "substitute_ingredient_ids" uuid[] DEFAULT ARRAY[]::uuid[] NOT NULL;` y el `CHECK`. Si al publicar otra rama ya usa ese número, renumera.

- [ ] **Paso 4: compilar y comprobar tipos**

Run: `pnpm --filter @ona/shared build && pnpm --filter @ona/api lint`
Expected: sin errores.

- [ ] **Paso 5: commit**

```bash
git add packages/shared/src/types/ingredientRole.ts packages/shared/src/index.ts apps/api/src/db/schema.ts apps/api/src/db/migrations/
git commit -m "feat(recipes): papel de cada ingrediente (imprescindible/secundario) y sustitutos"
```

### Tarea 2: el marcado sobrevive a las ediciones

**Ficheros:**
- Crear: `apps/api/src/services/ingredientRoles.ts`
- Modificar: `apps/api/src/services/recipePersistence.ts:79-95` (tipo) y `:538-583` (edición e inserción)
- Test: `apps/api/src/tests/ingredientRoles.test.ts`

- [ ] **Paso 1: prueba que falla**

```ts
// apps/api/src/tests/ingredientRoles.test.ts
import { describe, expect, it } from 'vitest'
import { carryIngredientMarks, ingredientMarksOf } from '../services/ingredientRoles.js'

const prev = (id: string, ingredientId: string, role: 'essential' | 'secondary' | null, subs: string[] = []) => ({
  id,
  ingredientId,
  role,
  substituteIngredientIds: subs,
})

describe('carryIngredientMarks', () => {
  it('keeps the marks of a row that comes back with the same id', () => {
    const out = carryIngredientMarks([prev('r1', 'pollo', 'essential', ['pavo'])], [{ id: 'r1', ingredientId: 'pollo' }])
    expect(out).toEqual([{ role: 'essential', substituteIngredientIds: ['pavo'] }])
  })

  it('falls back to the ingredient id when the row id is new', () => {
    const out = carryIngredientMarks([prev('r1', 'perejil', 'secondary')], [{ id: 'nuevo', ingredientId: 'perejil' }])
    expect(out[0].role).toBe('secondary')
  })

  it('a new ingredient comes unmarked', () => {
    const out = carryIngredientMarks([prev('r1', 'pollo', 'essential')], [{ id: 'r2', ingredientId: 'nata' }])
    expect(out).toEqual([{ role: null, substituteIngredientIds: [] }])
  })

  it('the same ingredient twice (two sections) keeps each row its own marks', () => {
    const out = carryIngredientMarks(
      [prev('masa', 'harina', 'essential'), prev('rebozado', 'harina', 'secondary')],
      [
        { id: 'rebozado', ingredientId: 'harina' },
        { id: 'masa', ingredientId: 'harina' },
      ],
    )
    expect(out.map((o) => o.role)).toEqual(['secondary', 'essential'])
  })

  it('a row id reused for another ingredient does not carry the old marks', () => {
    const out = carryIngredientMarks([prev('r1', 'pollo', 'essential')], [{ id: 'r1', ingredientId: 'tofu' }])
    expect(out[0].role).toBeNull()
  })
})

describe('ingredientMarksOf', () => {
  it('copies role and substitutes, defaulting to unmarked', () => {
    expect(ingredientMarksOf({ role: 'secondary', substituteIngredientIds: ['a'] })).toEqual({ role: 'secondary', substituteIngredientIds: ['a'] })
    expect(ingredientMarksOf({})).toEqual({ role: null, substituteIngredientIds: [] })
  })
})
```

- [ ] **Paso 2: ver que falla**

Run: `pnpm --filter @ona/api exec vitest run src/tests/ingredientRoles.test.ts`
Expected: FAIL, `Cannot find module '../services/ingredientRoles.js'`.

- [ ] **Paso 3: implementación mínima**

```ts
// apps/api/src/services/ingredientRoles.ts
/**
 * «Cocinar ahora» (specs/cook-now.md): each recipe ingredient is essential
 * or secondary and may list substitutes. Cocina marks catalogue recipes
 * (routes/ingredientRoles.ts); until then `autoIngredientRole` decides.
 */
import type { IngredientRole } from '@ona/shared'

export interface IngredientMarks {
  role: IngredientRole | null
  substituteIngredientIds: string[]
}

export interface MarkedRow extends IngredientMarks {
  id: string
  ingredientId: string
}

const UNMARKED: IngredientMarks = { role: null, substituteIngredientIds: [] }

/** The marks a copied row carries (both «Añadir a mis recetas» paths). */
export function ingredientMarksOf(row: { role?: string | null; substituteIngredientIds?: string[] | null }): IngredientMarks {
  return {
    role: row.role === 'essential' || row.role === 'secondary' ? row.role : null,
    substituteIngredientIds: [...(row.substituteIngredientIds ?? [])],
  }
}

/**
 * Pure: the marks each row of an edited recipe keeps. First by row id (the
 * edit form sends them back) when the ingredient is the same; then by
 * ingredient id for the rows left (an ingredient can appear twice, in two
 * sections). New ingredients come unmarked.
 */
export function carryIngredientMarks(
  previous: readonly MarkedRow[],
  next: ReadonlyArray<{ id: string; ingredientId: string }>,
): IngredientMarks[] {
  const used = new Set<string>()
  const out: Array<IngredientMarks | null> = next.map(() => null)
  next.forEach((n, i) => {
    const p = previous.find((q) => q.id === n.id && q.ingredientId === n.ingredientId)
    if (p) {
      out[i] = ingredientMarksOf(p)
      used.add(p.id)
    }
  })
  next.forEach((n, i) => {
    if (out[i]) return
    const p = previous.find((q) => !used.has(q.id) && q.ingredientId === n.ingredientId)
    if (p) {
      out[i] = ingredientMarksOf(p)
      used.add(p.id)
    }
  })
  return out.map((m) => m ?? { ...UNMARKED, substituteIngredientIds: [] })
}
```

- [ ] **Paso 4: ver que pasa**

Run: `pnpm --filter @ona/api exec vitest run src/tests/ingredientRoles.test.ts`
Expected: PASS (6 pruebas).

- [ ] **Paso 5: usarlo en `persistRecipe`**

En `RecipeIngredientWriteInput` (`recipePersistence.ts:79`), añade:

```ts
  /** «Cocinar ahora»: explicit marks (Cocina's batch). Absent = carry the previous ones on edit, else unmarked. */
  role?: IngredientRole | null
  substituteIngredientIds?: string[]
```

En modo edición, **antes** de borrar las filas de ingredientes (`recipePersistence.ts:544`), lee las anteriores:

```ts
      const previousMarks = await tx
        .select({
          id: recipeIngredientsTable.id,
          ingredientId: recipeIngredientsTable.ingredientId,
          role: recipeIngredientsTable.role,
          substituteIngredientIds: recipeIngredientsTable.substituteIngredientIds,
        })
        .from(recipeIngredientsTable)
        .where(eq(recipeIngredientsTable.recipeId, id))
      carried = carryIngredientMarks(
        previousMarks.map((r) => ({ ...r, ...ingredientMarksOf(r) })),
        input.ingredients.map((ing, i) => ({ id: ingredientRowIds[i], ingredientId: ing.ingredientId })),
      )
```

con `let carried: IngredientMarks[] | null = null` declarado antes del `if (opts.recipeId)`. En la inserción (`recipePersistence.ts:569`), cada fila añade:

```ts
          role: ing.role !== undefined ? ing.role : carried?.[i]?.role ?? null,
          substituteIngredientIds: ing.substituteIngredientIds ?? carried?.[i]?.substituteIngredientIds ?? [],
```

Importa `carryIngredientMarks`, `ingredientMarksOf` y el tipo `IngredientMarks` de `./ingredientRoles.js`, y `IngredientRole` de `@ona/shared`.

- [ ] **Paso 6: tipos y pruebas de recetas**

Run: `pnpm --filter @ona/api lint && pnpm --filter @ona/api exec vitest run src/tests/recipeFormContract.test.ts src/tests/ingredientRoles.test.ts`
Expected: PASS. El formulario de la web no manda `role` (queda `undefined`), así que en una edición se conserva lo anterior.

- [ ] **Paso 7: commit**

```bash
git add apps/api/src/services/ingredientRoles.ts apps/api/src/services/recipePersistence.ts apps/api/src/tests/ingredientRoles.test.ts
git commit -m "feat(recipes): el marcado de ingredientes sobrevive a editar la receta"
```

### Tarea 3: las dos copias llevan el marcado

**Ficheros:**
- Modificar: `apps/api/src/routes/recipes.ts:1147-1158`, `apps/api/src/services/assistant/skills.ts:2771-2782`
- Test: `apps/api/src/tests/ingredientRoles.test.ts` (guarda de código)

- [ ] **Paso 1: prueba que falla** (al final de `ingredientRoles.test.ts`)

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('both copy paths carry the marks', () => {
  const src = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8')
  it.each(['routes/recipes.ts', 'services/assistant/skills.ts'])('%s spreads ingredientMarksOf into the copied rows', (file) => {
    expect(src(file)).toMatch(/\.\.\.ingredientMarksOf\(ing\)/)
  })
})
```

Run: `pnpm --filter @ona/api exec vitest run src/tests/ingredientRoles.test.ts`
Expected: FAIL en los dos ficheros.

- [ ] **Paso 2: copiar el marcado**

En los dos `tx.insert(recipeIngredients).values(sourceIngredients.map((ing, i) => ({ ... })))`, añade al final del objeto `...ingredientMarksOf(ing),` e importa `ingredientMarksOf` de `../services/ingredientRoles.js` (en `skills.ts`, `../ingredientRoles.js`). `sourceIngredients` ya se lee con `select()` entero, así que trae `role` y `substituteIngredientIds`.

- [ ] **Paso 3: ver que pasa**

Run: `pnpm --filter @ona/api exec vitest run src/tests/ingredientRoles.test.ts && pnpm --filter @ona/api lint`
Expected: PASS.

- [ ] **Paso 4: commit**

```bash
git add apps/api/src/routes/recipes.ts apps/api/src/services/assistant/skills.ts apps/api/src/tests/ingredientRoles.test.ts
git commit -m "feat(recipes): «Añadir a mis recetas» (web y Mimo) copia el marcado de ingredientes"
```

### Tarea 4: la regla automática

**Ficheros:**
- Modificar: `apps/api/src/services/ingredientRoles.ts`
- Test: `apps/api/src/tests/ingredientRoles.test.ts`

- [ ] **Paso 1: prueba que falla**

```ts
import { autoIngredientRole, recipeGrams, roleOf, type RoleLine } from '../services/ingredientRoles.js'

const line = (over: Partial<RoleLine>): RoleLine => ({ ingredientName: 'x', quantity: 100, unit: 'g', ...over })

describe('autoIngredientRole', () => {
  const total = 1000
  it('protein, cereal and legume are essential whatever they weigh', () => {
    expect(autoIngredientRole(line({ category: 'proteina', quantity: 50 }), total)).toBe('essential')
    expect(autoIngredientRole(line({ category: 'Cereal', quantity: 10 }), total)).toBe('essential')
    expect(autoIngredientRole(line({ category: 'legumbre', quantity: 10 }), total)).toBe('essential')
  })
  it('15 % of the recipe weight or more is essential; less is secondary', () => {
    expect(autoIngredientRole(line({ quantity: 150 }), total)).toBe('essential')
    expect(autoIngredientRole(line({ quantity: 149 }), total)).toBe('secondary')
  })
  it('units with a weight count in grams', () => {
    expect(autoIngredientRole(line({ quantity: 2, unit: 'u', unitWeight: 200 }), total)).toBe('essential')
  })
  it('a line that cannot be weighed is secondary', () => {
    expect(autoIngredientRole(line({ quantity: 1, unit: 'cdita' }), total)).toBe('secondary')
  })
  it('optional, «al gusto», «pizca» and zero quantity are secondary', () => {
    expect(autoIngredientRole(line({ quantity: 500, optional: true }), total)).toBe('secondary')
    expect(autoIngredientRole(line({ quantity: 500, note: 'al gusto' }), total)).toBe('secondary')
    expect(autoIngredientRole(line({ quantity: 500, displayUnit: 'pizca' }), total)).toBe('secondary')
    expect(autoIngredientRole(line({ quantity: 0, category: 'proteina' }), total)).toBe('secondary')
  })
  it('the units al_gusto and pizca are secondary, even for a cereal', () => {
    expect(autoIngredientRole(line({ quantity: 1, unit: 'al_gusto', category: 'cereal' }), total)).toBe('secondary')
    expect(autoIngredientRole(line({ quantity: 1, unit: 'pizca' }), total)).toBe('secondary')
  })
  it('with no category only the weight decides', () => {
    expect(autoIngredientRole(line({ category: null, quantity: 400 }), total)).toBe('essential')
  })
})

describe('recipeGrams', () => {
  it('adds what can be weighed, leaving out basics', () => {
    expect(recipeGrams([line({ quantity: 300 }), line({ ingredientName: 'Sal', quantity: 10 }), line({ quantity: 1, unit: 'cdita' })])).toBe(300)
  })
})

describe('roleOf', () => {
  it('a mark wins over the rule, except an optional line is always secondary', () => {
    expect(roleOf(line({ role: 'essential', quantity: 1 }), 1000)).toBe('essential')
    expect(roleOf(line({ role: 'essential', optional: true }), 1000)).toBe('secondary')
    expect(roleOf(line({ role: null, quantity: 900 }), 1000)).toBe('essential')
  })
})
```

Run: `pnpm --filter @ona/api exec vitest run src/tests/ingredientRoles.test.ts`
Expected: FAIL, `autoIngredientRole is not a function`.

- [ ] **Paso 2: implementación** (al final de `ingredientRoles.ts`)

```ts
import { lineGrams } from './catalogRecipeAudit.js'
import { normalizeText } from './dietaryRestrictions.js'
import { isBasicIngredient } from './withWhatIHave.js'

/** Categories whose ingredient defines the dish (seeded `ingredients.category`). */
export const ESSENTIAL_CATEGORIES = ['proteina', 'cereal', 'legumbre'] as const
/** A line weighing at least this share of the recipe is essential. */
export const ESSENTIAL_WEIGHT_SHARE = 0.15

export interface RoleLine {
  ingredientName: string
  quantity: number
  unit: string
  category?: string | null
  optional?: boolean
  note?: string | null
  displayUnit?: string | null
  unitWeight?: number | null
  density?: number | null
  edibleFraction?: number | null
  role?: IngredientRole | null
}

function gramsOf(l: RoleLine): number | null {
  return lineGrams({
    name: l.ingredientName,
    quantity: l.quantity,
    unit: l.unit,
    unitWeight: l.unitWeight ?? null,
    density: l.density ?? null,
    edibleFraction: l.edibleFraction ?? null,
    note: l.note ?? null,
  })
}

/** Grams of the recipe that can be weighed, basics left out. */
export function recipeGrams(lines: readonly RoleLine[]): number {
  return lines.reduce((sum, l) => (isBasicIngredient(l.ingredientName) ? sum : sum + (gramsOf(l) ?? 0)), 0)
}

const TO_TASTE = /\b(al gusto|pizca)\b/

/** Pure: the role of an unmarked line (specs/cook-now.md → «Regla automática»). */
export function autoIngredientRole(l: RoleLine, totalGrams: number): IngredientRole {
  if (l.optional) return 'secondary'
  if (!(l.quantity > 0)) return 'secondary'
  if (l.unit === 'al_gusto' || l.unit === 'pizca') return 'secondary'
  if (TO_TASTE.test(normalizeText(`${l.note ?? ''} ${l.displayUnit ?? ''}`))) return 'secondary'
  const category = normalizeText(l.category ?? '')
  if ((ESSENTIAL_CATEGORIES as readonly string[]).includes(category)) return 'essential'
  const g = gramsOf(l)
  if (g == null || totalGrams <= 0) return 'secondary'
  return g / totalGrams >= ESSENTIAL_WEIGHT_SHARE ? 'essential' : 'secondary'
}

/** Cocina's mark if there is one, else the rule. An optional line is always secondary. */
export function roleOf(l: RoleLine, totalGrams: number): IngredientRole {
  if (l.optional) return 'secondary'
  return l.role ?? autoIngredientRole(l, totalGrams)
}
```

Si `lineGrams` devuelve algo para `cdita` (comprueba `rawLineGrams` en `catalogRecipeAudit.ts:188`), cambia la prueba «a line that cannot be weighed» a una unidad que no pese (por ejemplo `u` sin `unitWeight` y con un nombre que no sea huevo).

- [ ] **Paso 3: ver que pasa**

Run: `pnpm --filter @ona/api exec vitest run src/tests/ingredientRoles.test.ts`
Expected: PASS.

- [ ] **Paso 4: commit**

```bash
git add apps/api/src/services/ingredientRoles.ts apps/api/src/tests/ingredientRoles.test.ts
git commit -m "feat(recipes): regla automática de imprescindibles y secundarios"
```

### Tarea 5: rutas para que Cocina marque

**Ficheros:**
- Crear: `apps/api/src/middleware/cocinaAuth.ts`, `apps/api/src/routes/ingredientRoles.ts`
- Modificar: `apps/api/src/config/env.ts`, `apps/api/src/index.ts`, `apps/api/src/services/routeTemplates.ts`
- Test: `apps/api/src/tests/cocinaAuth.test.ts`, `apps/api/src/tests/ingredientRolesRoute.test.ts`

- [ ] **Paso 1: prueba del middleware** (mismo patrón que `createMetricsAuth`)

```ts
// apps/api/src/tests/cocinaAuth.test.ts
import { describe, expect, it, vi } from 'vitest'
import { createCocinaAuth } from '../middleware/cocinaAuth.js'

function run(headers: Record<string, string>, expected = 'secreto') {
  const res = { statusCode: 200, body: null as unknown, status(c: number) { this.statusCode = c; return this }, json(b: unknown) { this.body = b; return this } }
  const next = vi.fn()
  const adminAuth = vi.fn((_req, _res, n) => n())
  const req = { get: (h: string) => headers[h.toLowerCase()] } as any
  createCocinaAuth({ expectedToken: () => expected, adminAuth })(req, res as any, next)
  return { res, next, adminAuth }
}

describe('cocinaAuth', () => {
  it('no header → admin JWT path', () => {
    const { adminAuth, next } = run({})
    expect(adminAuth).toHaveBeenCalled()
    expect(next).toHaveBeenCalled()
  })
  it('right token → next', () => expect(run({ 'x-cocina-token': 'secreto' }).next).toHaveBeenCalled())
  it('wrong token → 401, no JWT fallback', () => {
    const { res, next, adminAuth } = run({ 'x-cocina-token': 'otro' })
    expect(res.statusCode).toBe(401)
    expect(next).not.toHaveBeenCalled()
    expect(adminAuth).not.toHaveBeenCalled()
  })
  it('token unset → 401 even with a header', () => expect(run({ 'x-cocina-token': '' }, '').res.statusCode).toBe(401))
})
```

Run: `pnpm --filter @ona/api exec vitest run src/tests/cocinaAuth.test.ts`
Expected: FAIL, módulo no encontrado.

- [ ] **Paso 2: middleware y variable**

En `config/env.ts`, junto a `METRICS_READ_TOKEN` y con el mismo estilo: `COCINA_WRITE_TOKEN: process.env.COCINA_WRITE_TOKEN ?? ''`.

```ts
// apps/api/src/middleware/cocinaAuth.ts
import type { NextFunction, Request, RequestHandler, Response } from 'express'
import { env } from '../config/env.js'
import { authMiddleware, requireAdmin } from './auth.js'
import { tokenMatches } from './metricsAuth.js'

/**
 * Guard for the two routes Cocina (the office) uses to mark catalogue
 * ingredients (specs/cook-now.md): an admin JWT, or the header
 * `x-cocina-token` equal to `COCINA_WRITE_TOKEN`. The token is mounted on
 * those two routes only and reads nothing but catalogue recipes.
 *   - header present → token mode only (wrong or unset token → 401);
 *   - header absent  → `authMiddleware` + `requireAdmin`.
 */
export function createCocinaAuth(deps: {
  expectedToken: () => string
  adminAuth: (req: Request, res: Response, next: NextFunction) => void
}): RequestHandler {
  return (req, res, next) => {
    const provided = req.get('x-cocina-token')
    if (provided === undefined) {
      deps.adminAuth(req, res, next)
      return
    }
    const expected = deps.expectedToken()
    if (!expected || !tokenMatches(provided, expected)) {
      res.status(401).json({ error: 'Token de Cocina no válido.', code: 'COCINA_TOKEN_INVALID' })
      return
    }
    next()
  }
}

export const cocinaAuth = createCocinaAuth({
  expectedToken: () => env.COCINA_WRITE_TOKEN,
  adminAuth: (req, res, next) => {
    void authMiddleware(req, res, () => requireAdmin(req, res, next))
  },
})
```

Run: `pnpm --filter @ona/api exec vitest run src/tests/cocinaAuth.test.ts`
Expected: PASS.

- [ ] **Paso 3: prueba de la validación del marcado**

La ruta valida con `ingredientRolesUpdateSchema` y además comprueba en un helper puro que cada `recipeIngredientId` es de esa receta:

```ts
// apps/api/src/tests/ingredientRolesRoute.test.ts
import { describe, expect, it } from 'vitest'
import { ingredientRolesUpdateSchema } from '@ona/shared'
import { foreignRowIds } from '../routes/ingredientRoles.js'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

describe('PUT /admin/recipes/:id/ingredient-roles body', () => {
  it('accepts marks with substitutes', () => {
    expect(ingredientRolesUpdateSchema.safeParse([{ recipeIngredientId: id(1), role: 'essential', substituteIngredientIds: [id(2)] }]).success).toBe(true)
  })
  it('rejects an unknown role and an empty list', () => {
    expect(ingredientRolesUpdateSchema.safeParse([{ recipeIngredientId: id(1), role: 'clave' }]).success).toBe(false)
    expect(ingredientRolesUpdateSchema.safeParse([]).success).toBe(false)
  })
  it('flags rows that are not of the recipe', () => {
    expect(foreignRowIds([id(1), id(3)], new Set([id(1), id(2)]))).toEqual([id(3)])
  })
})
```

Run: `pnpm --filter @ona/api exec vitest run src/tests/ingredientRolesRoute.test.ts`
Expected: FAIL, `foreignRowIds` no existe.

- [ ] **Paso 4: rutas**

```ts
// apps/api/src/routes/ingredientRoles.ts
/**
 * Cocina marks catalogue ingredients (specs/cook-now.md):
 *   GET /admin/recipes/ingredient-roles/pending?limit=N  catalogue recipes (drafts included)
 *       with any ingredient unmarked, with their ingredients, oldest first.
 *   PUT /admin/recipes/:id/ingredient-roles  [{ recipeIngredientId, role, substituteIngredientIds }]
 * Only catalogue recipes (author_id IS NULL): households' own recipes never
 * go through the office (privacy) and keep the automatic rule.
 */
import { Router } from 'express'
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm'
import { ingredientRolesUpdateSchema } from '@ona/shared'
import { db } from '../db/connection.js'
import { ingredients, recipeIngredients, recipes } from '../db/schema.js'
import { cocinaAuth } from '../middleware/cocinaAuth.js'

const router = Router()

/** Pure: ids in the body that aren't rows of the recipe. */
export function foreignRowIds(ids: readonly string[], recipeRowIds: ReadonlySet<string>): string[] {
  return ids.filter((id) => !recipeRowIds.has(id))
}

router.get('/admin/recipes/ingredient-roles/pending', cocinaAuth, async (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit ?? '10'), 10) || 10))
    const pending = await db
      .selectDistinct({ id: recipes.id, name: recipes.name, createdAt: recipes.createdAt })
      .from(recipes)
      .innerJoin(recipeIngredients, eq(recipeIngredients.recipeId, recipes.id))
      .where(and(isNull(recipes.authorId), isNull(recipeIngredients.role)))
      .orderBy(asc(recipes.createdAt))
      .limit(limit)
    if (pending.length === 0) {
      res.json([])
      return
    }
    const rows = await db
      .select({
        recipeId: recipeIngredients.recipeId,
        recipeIngredientId: recipeIngredients.id,
        name: ingredients.name,
        category: ingredients.category,
        quantity: recipeIngredients.quantity,
        unit: recipeIngredients.unit,
        optional: recipeIngredients.optional,
        note: recipeIngredients.note,
        section: recipeIngredients.section,
        role: recipeIngredients.role,
      })
      .from(recipeIngredients)
      .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
      .where(inArray(recipeIngredients.recipeId, pending.map((p) => p.id)))
      .orderBy(asc(recipeIngredients.displayOrder))
    res.json(
      pending.map((p) => ({
        id: p.id,
        name: p.name,
        ingredients: rows.filter((r) => r.recipeId === p.id).map(({ recipeId: _r, ...r }) => r),
      })),
    )
  } catch (err) {
    console.error('GET /admin/recipes/ingredient-roles/pending error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.put('/admin/recipes/:id/ingredient-roles', cocinaAuth, async (req, res) => {
  try {
    const parsed = ingredientRolesUpdateSchema.safeParse(req.body)
    if (!parsed.success) {
      res.status(400).json({ error: 'Marcado no válido', issues: parsed.error.issues })
      return
    }
    const recipeId = String(req.params.id)
    const [recipe] = await db.select({ id: recipes.id, authorId: recipes.authorId }).from(recipes).where(eq(recipes.id, recipeId)).limit(1)
    if (!recipe || recipe.authorId !== null) {
      res.status(404).json({ error: 'Receta del catálogo no encontrada' })
      return
    }
    const own = await db.select({ id: recipeIngredients.id }).from(recipeIngredients).where(eq(recipeIngredients.recipeId, recipeId))
    const foreign = foreignRowIds(parsed.data.map((m) => m.recipeIngredientId), new Set(own.map((r) => r.id)))
    if (foreign.length > 0) {
      res.status(400).json({ error: 'Hay ingredientes que no son de esta receta', ids: foreign })
      return
    }
    await db.transaction(async (tx) => {
      for (const m of parsed.data) {
        await tx
          .update(recipeIngredients)
          .set({ role: m.role, substituteIngredientIds: m.substituteIngredientIds })
          .where(eq(recipeIngredients.id, m.recipeIngredientId))
      }
    })
    res.json({ updated: parsed.data.length })
  } catch (err) {
    console.error('PUT /admin/recipes/:id/ingredient-roles error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
```

(Quita los imports que no uses, como `sql`.) En `index.ts`, importa `ingredientRoleRoutes from './routes/ingredientRoles.js'` y móntalo **justo después de `app.use(metricsRoutes)`** (hacia `index.ts:198`), con un comentario como los de al lado («Same reason: accepts `x-cocina-token`»). **No** lo pongas junto a `adminRoutes`: `userRoutes`, `menuRoutes`, `advisorRoutes` y `assistantRoutes`, montados antes, llevan un `router.use(authMiddleware)` que contesta 401 a una petición que solo trae `x-cocina-token`. En `routeTemplates.ts`, añade `'/admin/recipes/ingredient-roles/pending'` y `'/admin/recipes/:x/ingredient-roles'` en orden alfabético.

- [ ] **Paso 5: pruebas y tipos**

Run: `pnpm --filter @ona/api exec vitest run src/tests/ingredientRolesRoute.test.ts src/tests/cocinaAuth.test.ts src/tests/agentView.test.ts && pnpm --filter @ona/api lint`
Expected: PASS (`agentView.test.ts` compara `routeTemplates.ts` con las rutas montadas).

Comprueba el montaje de verdad con la API en marcha y `COCINA_WRITE_TOKEN=prueba`:

```bash
curl -s -o /dev/null -w '%{http_code}\n' localhost:8765/admin/recipes/ingredient-roles/pending -H 'x-cocina-token: prueba'
```

Expected: `200` (un `401` aquí quiere decir que el router está montado detrás de un `router.use(authMiddleware)`).

- [ ] **Paso 6: commit**

```bash
git add apps/api/src/middleware/cocinaAuth.ts apps/api/src/routes/ingredientRoles.ts apps/api/src/config/env.ts apps/api/src/index.ts apps/api/src/services/routeTemplates.ts apps/api/src/tests/cocinaAuth.test.ts apps/api/src/tests/ingredientRolesRoute.test.ts
git commit -m "feat(admin): rutas para que Cocina marque los ingredientes del catálogo"
```

### Tarea 6: las tandas JSON de Cocina traen el marcado

**Ficheros:**
- Modificar: `apps/api/src/services/catalogImport.ts` (`DraftIngredient`, `PersistDraftInput.ingredients`, `CatalogImportDeps`, `draftsFromCocinaJson` y el `deps.persistDraft({ … ingredients: matched.map(…) })` de `importOne`: búscalos por nombre, porque `origin/master` movió unas 20 líneas) y `apps/api/src/services/catalogImportDb.ts` (`createDbCatalogImportDeps` y `persistCatalogDraft`). Las dependencias se crean **solo** ahí: las usan el script `scripts/catalogImport.ts` y la importación desde la web de admin (`routes/catalogReview.ts`, `/admin/catalog-import/jobs`).
- Test: `apps/api/src/tests/catalogImportFile.test.ts` y `catalogImport.test.ts`

- [ ] **Paso 1: prueba que falla** (en `catalogImportFile.test.ts`, que ya prueba `draftsFromCocinaJson`)

```ts
it('reads imprescindible and sustitutos per ingredient', () => {
  const [d] = draftsFromCocinaJson(
    { recipes: [{ name: 'Crema de calabacín', ingredients: [
      { name: 'calabacín', qty: 800, unit: 'g', imprescindible: true },
      { name: 'nata', qty: 100, unit: 'ml', imprescindible: false, sustitutos: ['leche'] },
      { name: 'perejil', qty: 5, unit: 'g' },
    ], steps: ['a'] }] },
    { origin: 'cocina' } as any,
  )
  expect(d.ingredients.map((i) => i.role)).toEqual(['essential', 'secondary', undefined])
  expect(d.ingredients[1].substitutes).toEqual(['leche'])
})
```

y en `catalogImport.test.ts`, con las dependencias falsas que ya usa ese fichero, una prueba que compruebe que `persistDraft` recibe `role` y `substituteIngredientIds` (los sustitutos resueltos por la dependencia nueva `findIngredientIds`; un nombre que no casa se descarta y se apunta en `log`).

Run: `pnpm --filter @ona/api exec vitest run src/tests/catalogImportFile.test.ts src/tests/catalogImport.test.ts`
Expected: FAIL.

- [ ] **Paso 2: implementación**
  - `DraftIngredient`: `role?: IngredientRole` y `substitutes?: string[]`.
  - `draftsFromCocinaJson`: `role: i.imprescindible === true ? 'essential' : i.imprescindible === false ? 'secondary' : undefined`, `substitutes: Array.isArray(i.sustitutos) ? i.sustitutos.map(String).filter(Boolean) : undefined`.
  - `CatalogImportDeps`: `findIngredientIds: (names: string[]) => Promise<Array<string | null>>` (obligatoria, para que ningún camino la olvide). **Nunca crea ingredientes.** Impleméntala en `createDbCatalogImportDeps` (`catalogImportDb.ts`) con `tokenSetMatch` (de `services/ingredientTokenMatch.ts`) contra los nombres del catálogo. Llámala solo cuando la receta tiene algún sustituto, y añade una falsa (`async (names) => names.map(() => null)`) en las dependencias falsas de `catalogImport.test.ts` **y** de `catalogReview.test.ts` (`fakeDeps`), que también construye las suyas.
  - Al construir `ingredients` para `persistDraft`: `role: ingredients[i].role ?? null`; `substituteIngredientIds`: los ids que devuelve `findIngredientIds` para `ingredients[i].substitutes` (los `null` se quitan y se escribe en `deps.log` «sustituto sin casar: <nombre> (<receta>)»).
  - `PersistDraftInput.ingredients` gana `role` y `substituteIngredientIds`. `persistCatalogDraft` ya pasa `input.ingredients` tal cual a `persistRecipe`, así que allí basta con ampliar el tipo (campos de la tarea 2).

- [ ] **Paso 3: ver que pasa**

Run: `pnpm --filter @ona/api exec vitest run src/tests/catalogImportFile.test.ts src/tests/catalogImport.test.ts src/tests/catalogReview.test.ts && pnpm --filter @ona/api lint`
Expected: PASS.

- [ ] **Paso 4: commit**

```bash
git add apps/api/src/services/catalogImport.ts apps/api/src/services/catalogImportDb.ts apps/api/src/tests/catalogImportFile.test.ts apps/api/src/tests/catalogImport.test.ts apps/api/src/tests/catalogReview.test.ts
git commit -m "feat(catalogo): las tandas de Cocina traen imprescindibles y sustitutos"
```

---

## Fase 2 — La búsqueda

### Tarea 7: el cargador del menú trae lo que la búsqueda necesita

**Ficheros:**
- Modificar: `apps/api/src/services/recipeMatcher.ts:45-58` (tipo), `apps/api/src/services/matchableRecipes.ts:44-95`

- [ ] **Paso 1:** en `RecipeWithIngredients['ingredients']` añade campos opcionales (no rompen a nadie):

```ts
    /** Row id + «Cocinar ahora» marks (specs/cook-now.md). */
    rowId?: string
    optional?: boolean
    displayUnit?: string | null
    category?: string | null
    role?: 'essential' | 'secondary' | null
    substituteIngredientIds?: string[]
```

- [ ] **Paso 2:** en el `select` de `riRows` de `loadMatchableRecipes`, añade `rowId: recipeIngredients.id`, `optional: recipeIngredients.optional`, `displayUnit: recipeIngredients.displayUnit`, `category: ingredients.category`, `role: recipeIngredients.role` y `substituteIngredientIds: recipeIngredients.substituteIngredientIds`, y pásalos al objeto de cada ingrediente (`role: row.role === 'essential' || row.role === 'secondary' ? row.role : null`, `substituteIngredientIds: row.substituteIngredientIds ?? []`).

- [ ] **Paso 3:** comprobar que nada cambia para el menú.

Run: `pnpm --filter @ona/api lint && pnpm --filter @ona/api exec vitest run src/tests/recipeMatcher.test.ts src/tests/withWhatIHave.test.ts`
Expected: PASS (si alguno de esos ficheros no existe, corre los que empiecen por `recipeMatcher` o `menu`).

- [ ] **Paso 4: commit**

```bash
git add apps/api/src/services/recipeMatcher.ts apps/api/src/services/matchableRecipes.ts
git commit -m "refactor(menu): el cargador de recetas trae el marcado y la categoría de cada ingrediente"
```

### Tarea 8: lo compartido entre web y API

**Ficheros:**
- Crear: `packages/shared/src/cookNow.ts`
- Modificar: `packages/shared/src/index.ts`
- Test: `apps/api/src/tests/cookNowShared.test.ts`

- [ ] **Paso 1: prueba que falla**

```ts
// apps/api/src/tests/cookNowShared.test.ts
import { describe, expect, it } from 'vitest'
import { cookNowHitLine, cookNowMeal, cookNowProposalSchema, displaceTargets, plannedRecipeDishes } from '@ona/shared'

const recipe = (name: string, variant?: string) => ({ kind: 'recipe' as const, recipeId: name, recipeName: name, ...(variant ? { variant: variant as any } : {}) })

describe('cookNowMeal', () => {
  it('lunch until 16:00, then dinner', () => {
    expect(cookNowMeal({}, 13)).toBe('lunch')
    expect(cookNowMeal({}, 16)).toBe('dinner')
  })
  it('lunch already eaten → dinner; both eaten → none', () => {
    expect(cookNowMeal({ lunch: { dishes: [], eaten: true } }, 13)).toBe('dinner')
    expect(cookNowMeal({ dinner: { dishes: [], eaten: true } }, 20)).toBeNull()
  })
})

describe('plannedRecipeDishes', () => {
  it('leaves out leftovers, every táper (freezer, fridge, cooked) and notes', () => {
    const slot = {
      dishes: [
        recipe('Lentejas'),
        recipe('Táper', 'leftover'),
        recipe('Croquetas', 'freezer'),
        recipe('Táper de la nevera', 'fridge'),
        recipe('Sobras de otro día', 'cooked'),
        { kind: 'note' as const, text: 'pan' },
      ],
    }
    expect(plannedRecipeDishes(slot).map((d) => d.recipeName)).toEqual(['Lentejas'])
  })
})

describe('displaceTargets', () => {
  const days = [
    { lunch: { dishes: [recipe('Lentejas')] } },
    { lunch: { dishes: [recipe('Merluza')] } },
    {},
    { lunch: { dishes: [recipe('Pollo')] } },
    {}, {}, {},
  ]
  it('from tomorrow to Sunday, saying what each would replace', () => {
    const t = displaceTargets(days, 0, 'lunch', { '3': { lunch: true } }, [2])
    expect(t.map((x) => x.day)).toEqual([1, 2, 3, 4, 5, 6])
    expect(t[0]).toMatchObject({ replaces: 'Merluza', disabled: false })
    expect(t[1]).toMatchObject({ replaces: null, disabled: true }) // skipped day
    expect(t[2]).toMatchObject({ disabled: true }) // locked
  })
  it('Sunday has nowhere to go', () => expect(displaceTargets(days, 6, 'lunch', {}, [])).toEqual([]))
})

describe('cookNowHitLine', () => {
  it('says what is missing, what can be left out or swapped', () => {
    expect(cookNowHitLine({ missingEssential: [], short: [], missingSecondary: [], substitutions: [] })).toBe('No te falta nada')
    expect(cookNowHitLine({ missingEssential: [], short: [], missingSecondary: ['perejil', 'comino'], substitutions: [] })).toBe('Puedes hacerla sin perejil y comino')
    expect(cookNowHitLine({ missingEssential: ['pollo'], short: [], missingSecondary: [], substitutions: [] })).toBe('Te falta: pollo')
    expect(cookNowHitLine({ missingEssential: ['arroz'], short: ['arroz'], missingSecondary: [], substitutions: [] })).toBe('Te falta un poco de arroz')
    expect(cookNowHitLine({ missingEssential: [], short: [], missingSecondary: [], substitutions: [{ missing: 'nata', use: 'leche' }] })).toBe('Cambia la nata por leche')
  })
})

describe('cookNowProposalSchema', () => {
  it('accepts the four answers', () => {
    expect(cookNowProposalSchema.safeParse({ minutes: 30, servings: 2, canBuy: false }).success).toBe(true)
    expect(cookNowProposalSchema.safeParse({ minutes: null, servings: 4, canBuy: true }).success).toBe(true)
  })
  it('rejects odd minutes and zero people', () => {
    expect(cookNowProposalSchema.safeParse({ minutes: 20, servings: 2, canBuy: false }).success).toBe(false)
    expect(cookNowProposalSchema.safeParse({ minutes: 30, servings: 0, canBuy: false }).success).toBe(false)
  })
})
```

Run: `pnpm --filter @ona/shared build && pnpm --filter @ona/api exec vitest run src/tests/cookNowShared.test.ts`
Expected: FAIL, las funciones no existen.

- [ ] **Paso 2: implementación**

```ts
// packages/shared/src/cookNow.ts
/**
 * «Cocinar ahora» (specs/cook-now.md): what the web and the API share —
 * which meal «now» is, which dishes of a slot count as planned, the days a
 * planned dish can move to, the line under each proposal and the request
 * schemas of /cook-now/*.
 */
import { z } from 'zod'
import type { DayMenu, LockedSlots, MealSlot } from './types/menu.js'
import { isRecipeDish, isTaperVariant, type RecipeDish } from './types/menuDish.js'

export const COOK_NOW_MINUTES = [15, 30, 45] as const
export type CookNowMeal = 'lunch' | 'dinner'

/** Lunch until 16:00 (Madrid, like Mimo), then dinner; a meal already eaten is skipped. */
export function cookNowMeal(day: DayMenu, hour: number): CookNowMeal | null {
  const order: CookNowMeal[] = hour < 16 ? ['lunch', 'dinner'] : ['dinner']
  return order.find((m) => !day[m]?.eaten) ?? null
}

/** Recipe dishes cooked for this slot: not leftovers, not tápers (freezer, fridge, another day's), not notes. */
export function plannedRecipeDishes(slot: MealSlot | null | undefined): RecipeDish[] {
  return (slot?.dishes ?? []).filter(isRecipeDish).filter((d) => d.variant !== 'leftover' && !isTaperVariant(d.variant))
}

export interface DisplaceTarget {
  day: number
  /** Names of the recipe dishes it would replace, joined; null = free. */
  replaces: string | null
  /** Skipped day or locked meal. */
  disabled: boolean
}

/** The rest of the week (tomorrow → Sunday), same meal, for «Pasarlas a otro día». */
export function displaceTargets(days: readonly DayMenu[], fromDay: number, meal: string, locked: LockedSlots, skippedDays: readonly number[]): DisplaceTarget[] {
  const out: DisplaceTarget[] = []
  for (let day = fromDay + 1; day <= 6; day++) {
    const names = (days[day]?.[meal]?.dishes ?? []).filter(isRecipeDish).map((d) => d.recipeName ?? '').filter(Boolean)
    out.push({
      day,
      replaces: names.length > 0 ? listEs(names) : null,
      disabled: skippedDays.includes(day) || !!locked[String(day)]?.[meal],
    })
  }
  return out
}

function listEs(items: readonly string[]): string {
  return items.length <= 1 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} y ${items[items.length - 1]}`
}

export interface CookNowHitFacts {
  missingEssential: string[]
  /** Essentials the pantry has but not enough of (also in missingEssential). */
  short: string[]
  missingSecondary: string[]
  substitutions: Array<{ missing: string; use: string }>
}

/** The short line under a proposal. */
export function cookNowHitLine(h: CookNowHitFacts): string {
  if (h.missingEssential.length > 0) {
    const notShort = h.missingEssential.filter((n) => !h.short.includes(n))
    if (notShort.length === 0) return `Te falta un poco de ${listEs(h.short)}`
    return `Te falta: ${listEs(h.missingEssential.map((n) => (h.short.includes(n) ? `un poco de ${n}` : n)))}`
  }
  if (h.substitutions.length > 0) {
    const s = h.substitutions[0]
    return `Cambia la ${s.missing} por ${s.use}`
  }
  if (h.missingSecondary.length > 0) return `Puedes hacerla sin ${listEs(h.missingSecondary)}`
  return 'No te falta nada'
}

export const cookNowProposalSchema = z.object({
  minutes: z.union([z.literal(15), z.literal(30), z.literal(45), z.null()]),
  servings: z.number().int().min(1).max(20),
  canBuy: z.boolean(),
  /** «Con lo que tienes» card: only recipes that use something from the pantry. */
  requirePantryUse: z.boolean().optional(),
})
export type CookNowProposalRequest = z.infer<typeof cookNowProposalSchema>

export const cookNowChooseSchema = z.object({
  recipeId: z.string().uuid(),
  /** People of question 2 when it differs from the household's default diners (not the slot's); null = the household default. */
  servings: z.number().int().min(1).max(20).nullable(),
  /** Day (0–6, same week and meal) the planned dishes move to; null = remove them. */
  displacedTo: z.number().int().min(0).max(6).nullable(),
})
export type CookNowChooseRequest = z.infer<typeof cookNowChooseSchema>

export const cookNowPhraseSchema = z.object({ recipeId: z.string().uuid() })
```

«Cambia la nata por leche» lleva artículo femenino fijo: si Cocina marca sustitutos de nombres masculinos («el tomate»), cambia la plantilla a `Cambia ${s.missing} por ${s.use}` y la prueba a la vez. Exporta todo desde `packages/shared/src/index.ts`.

- [ ] **Paso 3: ver que pasa**

Run: `pnpm --filter @ona/shared build && pnpm --filter @ona/api exec vitest run src/tests/cookNowShared.test.ts`
Expected: PASS.

- [ ] **Paso 4: commit**

```bash
git add packages/shared/src/cookNow.ts packages/shared/src/index.ts apps/api/src/tests/cookNowShared.test.ts
git commit -m "feat(cocinar): reglas compartidas de «Cocinar ahora» (comida de ahora, mover lo planeado, línea de la propuesta)"
```

### Tarea 9: la búsqueda pura

**Ficheros:**
- Crear: `apps/api/src/services/cookNow/search.ts`
- Test: `apps/api/src/tests/cookNowSearch.test.ts`

- [ ] **Paso 1: prueba que falla** (escríbela entera antes de implementar)

```ts
// apps/api/src/tests/cookNowSearch.test.ts
import { describe, expect, it } from 'vitest'
import { fitOf, rankCookNow, type CookNowCandidate, type CookNowContext } from '../services/cookNow/search.js'

const ing = (name: string, over: Record<string, unknown> = {}) => ({ ingredientId: name, ingredientName: name, quantity: 200, unit: 'g', ...over })
const recipe = (name: string, totalTime: number | null, ingredients: ReturnType<typeof ing>[], over: Partial<CookNowCandidate> = {}): CookNowCandidate => ({
  id: name, name, servings: 4, totalTime, ingredients, ...over,
})
const pantry = (name: string, quantity = 1000, over: Record<string, unknown> = {}) => ({ ingredientId: name, name, quantity, unit: 'g', expiresAt: null, ...over })
const ctx = (over: Partial<CookNowContext> = {}): CookNowContext => ({
  pantry: [], staples: [], substituteNames: new Map(), boost: new Set(), cookedRecently: new Set(), today: '2026-11-03', ...over,
})
const answers = (over = {}) => ({ minutes: 30 as 15 | 30 | 45 | null, servings: 4, canBuy: false, ...over })

describe('fitOf', () => {
  it('fits, margin up to +20 %, out beyond; no time is out; no limit fits', () => {
    expect(fitOf({ totalTime: 30 }, 30)).toBe('fits')
    expect(fitOf({ totalTime: 36 }, 30)).toBe('margin')
    expect(fitOf({ totalTime: 37 }, 30)).toBeNull()
    expect(fitOf({ totalTime: null }, 30)).toBeNull()
    expect(fitOf({ totalTime: 240 }, null)).toBe('fits')
  })
})

describe('rankCookNow · «solo lo que hay»', () => {
  const tortilla = recipe('Tortilla', 25, [ing('huevo', { category: 'proteina' }), ing('patata', { quantity: 600 }), ing('perejil', { quantity: 5 })])
  it('a missing secondary does not take the recipe out', () => {
    const { hits } = rankCookNow([tortilla], answers(), ctx({ pantry: [pantry('huevo'), pantry('patata')] }))
    expect(hits).toHaveLength(1)
    expect(hits[0].missingSecondary).toEqual(['perejil'])
    expect(hits[0].missingEssential).toEqual([])
  })
  it('a missing essential takes it out, unless nothing fits: then one missing thing is shown', () => {
    const { hits, fallback } = rankCookNow([tortilla], answers(), ctx({ pantry: [pantry('patata')] }))
    expect(fallback).toBe(true)
    expect(hits[0].missingEssential).toEqual(['huevo'])
  })
  it('basics never count, staples count as at home, substitutes in the pantry count', () => {
    const crema = recipe('Crema', 30, [ing('calabacín', { quantity: 800 }), ing('nata', { quantity: 300, unit: 'ml', role: 'essential', substituteIngredientIds: ['leche'] }), ing('Sal', { quantity: 5 }), ing('cebolla', { quantity: 300 })])
    const { hits } = rankCookNow([crema], answers(), ctx({ pantry: [pantry('calabacín'), pantry('leche')], staples: ['Cebollas'], substituteNames: new Map([['leche', 'leche']]) }))
    expect(hits).toHaveLength(1)
    expect(hits[0].substitutions).toEqual([{ missing: 'nata', use: 'leche' }])
  })
  it('not enough of an essential (same unit) counts as missing and short', () => {
    const arroz = recipe('Arroz', 30, [ing('arroz', { category: 'cereal', quantity: 300 })])
    const { hits, fallback } = rankCookNow([arroz], answers({ servings: 4 }), ctx({ pantry: [pantry('arroz', 100)] }))
    expect(fallback).toBe(true)
    expect(hits[0].short).toEqual(['arroz'])
  })
  it('different units are taken as enough', () => {
    const arroz = recipe('Arroz', 30, [ing('arroz', { category: 'cereal', quantity: 300 })])
    const { hits, fallback } = rankCookNow([arroz], answers(), ctx({ pantry: [pantry('arroz', 1, { unit: 'u' })] }))
    expect(fallback).toBe(false)
    expect(hits).toHaveLength(1)
  })
  it('servings scale what is needed', () => {
    const arroz = recipe('Arroz', 30, [ing('arroz', { category: 'cereal', quantity: 400 })])
    expect(rankCookNow([arroz], answers({ servings: 1 }), ctx({ pantry: [pantry('arroz', 100)] })).fallback).toBe(false)
  })
})

describe('rankCookNow · «sí, algo»', () => {
  it('allows up to two missing essentials', () => {
    const r = recipe('Guiso', 40, [ing('ternera', { category: 'proteina' }), ing('patata', { quantity: 800 }), ing('zanahoria', { quantity: 400 })])
    expect(rankCookNow([r], answers({ minutes: 45, canBuy: true }), ctx({ pantry: [pantry('patata')] })).hits).toHaveLength(1)
    expect(rankCookNow([r], answers({ minutes: 45, canBuy: true }), ctx()).hits).toHaveLength(0)
  })
})

describe('rankCookNow · order', () => {
  it('fits before margin, then fewer missing essentials, then more pantry (expiring counts double), then fewer missing secondaries', () => {
    const a = recipe('A margen', 35, [ing('huevo', { category: 'proteina' })])
    const b = recipe('B cabe', 25, [ing('huevo', { category: 'proteina' })])
    expect(rankCookNow([a, b], answers(), ctx({ pantry: [pantry('huevo')] })).hits.map((h) => h.recipe.name)).toEqual(['B cabe', 'A margen'])

    const c = recipe('C usa uno', 20, [ing('huevo', { category: 'proteina' })])
    const d = recipe('D usa caducado', 20, [ing('pollo', { category: 'proteina' })])
    const order = rankCookNow([c, d], answers(), ctx({ pantry: [pantry('huevo'), pantry('pollo', 1000, { expiresAt: '2026-11-05' })] })).hits.map((h) => h.recipe.name)
    expect(order).toEqual(['D usa caducado', 'C usa uno'])
  })
  it('«Repetir a menudo» before, cooked in the last 7 days after, as tie-breaks', () => {
    const e = recipe('E', 20, [ing('huevo', { category: 'proteina' })])
    const f = recipe('F', 20, [ing('huevo', { category: 'proteina' })])
    const g = recipe('G', 20, [ing('huevo', { category: 'proteina' })])
    const hits = rankCookNow([e, f, g], answers(), ctx({ pantry: [pantry('huevo')], boost: new Set(['G']), cookedRecently: new Set(['E']) })).hits
    expect(hits.map((h) => h.recipe.name)).toEqual(['G', 'F', 'E'])
  })
})
```

Run: `pnpm --filter @ona/api exec vitest run src/tests/cookNowSearch.test.ts`
Expected: FAIL, módulo no encontrado.

- [ ] **Paso 2: implementación**

```ts
// apps/api/src/services/cookNow/search.ts
/**
 * «Cocinar ahora» search (specs/cook-now.md), pure. The candidates already
 * passed the menu's filters (allergies, diet, dislikes, vetoes, «Mejor no»,
 * equipment, meal, season, course — load.ts); here: time, what the house
 * has (pantry, staples, substitutes), essentials vs secondaries, order.
 */
import { recipeTotalMinutes } from '@ona/shared'
import type { CookNowHitFacts } from '@ona/shared'
import { nameHasTerm, normalizeText } from '../dietaryRestrictions.js'
import { recipeGrams, roleOf, type RoleLine } from '../ingredientRoles.js'
import { isBasicIngredient, singularTerm } from '../withWhatIHave.js'

export const TIME_MARGIN = 1.2
export const MAX_MISSING_WHEN_BUYING = 2
export const EXPIRING_DAYS = 3
export const HOUSE_SERVINGS = 4

export interface CookNowIngredient extends RoleLine {
  ingredientId: string
  substituteIngredientIds?: string[]
}

export interface CookNowCandidate {
  id: string
  name: string
  servings?: number | null
  totalTime?: number | null
  prepTime?: number | null
  cookTime?: number | null
  ingredients: CookNowIngredient[]
}

export interface PantryLine {
  ingredientId: string | null
  name: string
  quantity: number
  unit: string
  expiresAt: string | null
}

export interface CookNowContext {
  pantry: PantryLine[]
  /** Active household staples (free text). */
  staples: string[]
  /** Substitute ingredient id → name, for the line «Cambia la nata por leche». */
  substituteNames: Map<string, string>
  /** «Repetir a menudo» (5 stars, «Me encanta»). */
  boost: Set<string>
  /** Cooked by the household in the last 7 days. */
  cookedRecently: Set<string>
  /** YYYY-MM-DD, Madrid. */
  today: string
}

export interface CookNowAnswers {
  minutes: number | null
  servings: number
  canBuy: boolean
}

export type CookNowFit = 'fits' | 'margin'

export interface CookNowHit<R extends CookNowCandidate = CookNowCandidate> extends CookNowHitFacts {
  recipe: R
  fit: CookNowFit
  /** Pantry ingredients it uses, and those expiring within 3 days. */
  uses: string[]
  expiring: string[]
}

export function fitOf(r: { totalTime?: number | null; prepTime?: number | null; cookTime?: number | null }, minutes: number | null): CookNowFit | null {
  const total = recipeTotalMinutes(r)
  if (total == null) return null
  if (minutes == null || total <= minutes) return 'fits'
  return total <= Math.floor(minutes * TIME_MARGIN) ? 'margin' : null
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((Date.parse(`${toIso}T12:00:00Z`) - Date.parse(`${fromIso}T12:00:00Z`)) / 86_400_000)
}

/** A catalogue-linked pantry row with something in it: same id, or its name's word inside the ingredient's. */
function pantryRowFor(ing: CookNowIngredient, pantry: readonly PantryLine[]): PantryLine | undefined {
  const name = normalizeText(ing.ingredientName)
  return pantry.find(
    (p) => p.ingredientId != null && p.quantity > 0 && (p.ingredientId === ing.ingredientId || nameHasTerm(name, singularTerm(p.name))),
  )
}

function isStaple(ing: CookNowIngredient, staples: readonly string[]): boolean {
  const name = normalizeText(ing.ingredientName)
  return staples.some((s) => {
    const term = singularTerm(s)
    return term.length > 0 && nameHasTerm(name, term)
  })
}

/** Pure: what one recipe uses and lacks, given the house. */
export function evaluateRecipe<R extends CookNowCandidate>(recipe: R, answers: CookNowAnswers, ctx: CookNowContext): Omit<CookNowHit<R>, 'fit'> {
  const lines = recipe.ingredients.filter((i) => !isBasicIngredient(i.ingredientName))
  const total = recipeGrams(lines)
  const scale = answers.servings / (recipe.servings && recipe.servings > 0 ? recipe.servings : HOUSE_SERVINGS)
  const hit: Omit<CookNowHit<R>, 'fit'> = { recipe, missingEssential: [], short: [], missingSecondary: [], substitutions: [], uses: [], expiring: [] }
  const seen = new Set<string>()
  for (const ing of lines) {
    if (seen.has(ing.ingredientName)) continue
    seen.add(ing.ingredientName)
    const role = roleOf(ing, total)
    const row = pantryRowFor(ing, ctx.pantry)
    if (row) {
      if (role === 'essential' && row.unit === ing.unit && row.quantity < ing.quantity * scale) {
        hit.missingEssential.push(ing.ingredientName)
        hit.short.push(ing.ingredientName)
        continue
      }
      hit.uses.push(ing.ingredientName)
      if (row.expiresAt && daysBetween(ctx.today, row.expiresAt) <= EXPIRING_DAYS) hit.expiring.push(ing.ingredientName)
      continue
    }
    if (isStaple(ing, ctx.staples)) continue
    const sub = (ing.substituteIngredientIds ?? []).find((id) => ctx.pantry.some((p) => p.ingredientId === id && p.quantity > 0))
    if (sub) {
      hit.substitutions.push({ missing: ing.ingredientName, use: ctx.substituteNames.get(sub) ?? '' })
      continue
    }
    if (ing.optional) continue
    if (role === 'essential') hit.missingEssential.push(ing.ingredientName)
    else hit.missingSecondary.push(ing.ingredientName)
  }
  return hit
}

/** Pure: filter by time and what's missing, then order (each criterion only breaks the previous one's ties). */
export function rankCookNow<R extends CookNowCandidate>(
  candidates: readonly R[],
  answers: CookNowAnswers,
  ctx: CookNowContext,
): { hits: CookNowHit<R>[]; fallback: boolean } {
  const evaluated: CookNowHit<R>[] = []
  for (const recipe of candidates) {
    const fit = fitOf(recipe, answers.minutes)
    if (!fit) continue
    evaluated.push({ ...evaluateRecipe(recipe, answers, ctx), fit })
  }
  const limit = answers.canBuy ? MAX_MISSING_WHEN_BUYING : 0
  let pool = evaluated.filter((h) => h.missingEssential.length <= limit)
  let fallback = false
  if (!answers.canBuy && pool.length === 0) {
    pool = evaluated.filter((h) => h.missingEssential.length === 1)
    fallback = pool.length > 0
  }
  const pantryScore = (h: CookNowHit<R>) => h.uses.length + h.expiring.length
  pool.sort(
    (a, b) =>
      Number(a.fit === 'margin') - Number(b.fit === 'margin') ||
      a.missingEssential.length - b.missingEssential.length ||
      pantryScore(b) - pantryScore(a) ||
      a.missingSecondary.length - b.missingSecondary.length ||
      Number(ctx.boost.has(b.recipe.id)) - Number(ctx.boost.has(a.recipe.id)) ||
      Number(ctx.cookedRecently.has(a.recipe.id)) - Number(ctx.cookedRecently.has(b.recipe.id)) ||
      a.recipe.name.localeCompare(b.recipe.name, 'es'),
  )
  return { hits: pool, fallback }
}
```

- [ ] **Paso 3: ver que pasa**

Run: `pnpm --filter @ona/api exec vitest run src/tests/cookNowSearch.test.ts`
Expected: PASS. Si `recipeTotalMinutes` no se exporta de `@ona/shared`, expórtalo desde `types/cookingTime.ts` en el `index.ts` (ya se usa dentro de `fitsTimeBudget`).

- [ ] **Paso 4: commit**

```bash
git add apps/api/src/services/cookNow/search.ts apps/api/src/tests/cookNowSearch.test.ts packages/shared/src/index.ts
git commit -m "feat(cocinar): búsqueda de «Cocinar ahora» (tiempo, despensa, imprescindibles y secundarios)"
```

### Tarea 10: poner la receta en la comida (pura)

**Ficheros:**
- Crear: `apps/api/src/services/cookNow/place.ts`
- Test: `apps/api/src/tests/cookNowPlace.test.ts`

- [ ] **Paso 1: prueba que falla**

```ts
// apps/api/src/tests/cookNowPlace.test.ts
import { describe, expect, it } from 'vitest'
import { placeCookNowRecipe } from '../services/cookNow/place.js'

const r = (name: string, extra: Record<string, unknown> = {}) => ({ kind: 'recipe' as const, recipeId: name, recipeName: name, ...extra })
const week = () => [
  { dinner: { servings: 3, dishes: [r('Lentejas', { pinnedType: 'legumbres' }), { kind: 'note' as const, text: 'pan' }] } },
  { dinner: { dishes: [r('Merluza')] }, lunch: { dishes: [r('Táper', { variant: 'leftover', leftoverOf: { day: 0, meal: 'dinner', dishPosition: 0 } })] } },
  {}, {}, {}, {}, {},
] as any[]
const tortilla = r('Tortilla')

describe('placeCookNowRecipe', () => {
  it('replaces every dish of the slot with the new one, with the servings asked', () => {
    const out = placeCookNowRecipe(week(), { day: 0, meal: 'dinner' }, tortilla, 2, null)
    expect(out[0].dinner).toEqual({ servings: 2, dishes: [tortilla] })
  })
  it('without servings keeps no override', () => {
    expect(placeCookNowRecipe(week(), { day: 0, meal: 'dinner' }, tortilla, null, null)[0].dinner).toEqual({ dishes: [tortilla] })
  })
  it('moves the planned recipe dishes (settings kept) to the chosen day, replacing what was there', () => {
    const out = placeCookNowRecipe(week(), { day: 0, meal: 'dinner' }, tortilla, null, 1)
    expect(out[1].dinner.dishes).toEqual([r('Lentejas', { pinnedType: 'legumbres' })])
  })
  it('leftovers of the moved slot follow it', () => {
    const out = placeCookNowRecipe(week(), { day: 0, meal: 'dinner' }, tortilla, null, 3)
    expect(out[1].lunch.dishes[0].leftoverOf).toEqual({ day: 3, meal: 'dinner', dishPosition: 0 })
  })
  it('does not mutate the input', () => {
    const w = week()
    placeCookNowRecipe(w, { day: 0, meal: 'dinner' }, tortilla, null, 1)
    expect(w[0].dinner.dishes[0].recipeName).toBe('Lentejas')
  })
})
```

Run: `pnpm --filter @ona/api exec vitest run src/tests/cookNowPlace.test.ts`
Expected: FAIL.

- [ ] **Paso 2: implementación**

```ts
// apps/api/src/services/cookNow/place.ts
/**
 * «Cocinar esta» (specs/cook-now.md → §4), pure: the chosen recipe replaces
 * every dish of the meal; the planned recipe dishes (plannedRecipeDishes)
 * move to `displacedTo` — same meal, replacing its dishes — or go. Leftovers
 * pointing at the moved slot point at its new place. Locked meals are
 * refused by the route before calling this.
 */
import { isRecipeDish, plannedRecipeDishes, type DayMenu, type RecipeDish } from '@ona/shared'

export function placeCookNowRecipe(
  days: readonly DayMenu[],
  at: { day: number; meal: string },
  dish: RecipeDish,
  servings: number | null,
  displacedTo: number | null,
): DayMenu[] {
  const next: DayMenu[] = structuredClone(days as DayMenu[])
  while (next.length < 7) next.push({})
  const planned = plannedRecipeDishes(next[at.day]?.[at.meal])
  if (displacedTo != null && displacedTo !== at.day && planned.length > 0) {
    const target = next[displacedTo]?.[at.meal]
    const { eaten: _e, eatenAt: _a, ...rest } = target ?? { dishes: [] }
    next[displacedTo] = { ...(next[displacedTo] ?? {}), [at.meal]: { ...rest, dishes: planned } }
    for (const day of next) {
      for (const slot of Object.values(day ?? {})) {
        for (const d of slot?.dishes ?? []) {
          if (isRecipeDish(d) && d.leftoverOf?.day === at.day && d.leftoverOf.meal === at.meal) {
            d.leftoverOf = { ...d.leftoverOf, day: displacedTo }
          }
        }
      }
    }
  }
  next[at.day] = { ...(next[at.day] ?? {}), [at.meal]: { ...(servings != null ? { servings } : {}), dishes: [dish] } }
  return next
}
```

- [ ] **Paso 3: ver que pasa**

Run: `pnpm --filter @ona/api exec vitest run src/tests/cookNowPlace.test.ts`
Expected: PASS.

- [ ] **Paso 4: commit**

```bash
git add apps/api/src/services/cookNow/place.ts apps/api/src/tests/cookNowPlace.test.ts
git commit -m "feat(cocinar): poner la receta en la comida de ahora y mover lo planeado"
```

### Tarea 11: lo que se lee de la base de datos y las rutas `today`, `proposal` y `choose`

**Ficheros:**
- Crear: `apps/api/src/services/cookNow/load.ts`, `apps/api/src/routes/cookNow.ts`
- Modificar: `apps/api/src/index.ts`, `apps/api/src/services/routeTemplates.ts`
- Test: `apps/api/src/tests/cookNowLoad.test.ts` (la parte pura de `load.ts`)

- [ ] **Paso 1: prueba de la parte pura** — `candidatesFor` decide qué recetas del cargador del menú entran (plato principal o versátil):

```ts
// apps/api/src/tests/cookNowLoad.test.ts
import { describe, expect, it } from 'vitest'
import { isCookNowCourse } from '../services/cookNow/load.js'

describe('isCookNowCourse', () => {
  it('main and versatile dishes only', () => {
    expect(isCookNowCourse('main')).toBe(true)
    expect(isCookNowCourse(null)).toBe(true)
    expect(isCookNowCourse('starter')).toBe(false)
    expect(isCookNowCourse('dessert')).toBe(false)
  })
})
```

Run: `pnpm --filter @ona/api exec vitest run src/tests/cookNowLoad.test.ts`
Expected: FAIL.

- [ ] **Paso 2: `load.ts`**

Funciones (cada una con un comentario de una línea, como el resto de `services/`):

- `isCookNowCourse(course: string | null): boolean` → `course == null || course === 'main'`.
- `loadCookNowToday(userId, now = new Date())`: con `madridParts(now)`, `madridWeekStart(now)` (de `services/madridTime.ts`) y el menú de esa semana del hogar (mismo `where` que `menuOfWeek` en `assistant/skills.ts:96`: `scopeWhere(menus.userId, menus.householdId, await resolveScope(userId))` + `eq(menus.weekStart, weekStart)`, el más reciente). Devuelve `{ weekStart, day, meal: cookNowMeal(days[day] ?? {}, hour), menu | null, planned: plannedRecipeDishes(slot), locked: !!menu?.locked?.[day]?.[meal], slotServings: slot?.servings ?? null, targets: displaceTargets(days, day, meal, locked, skippedDays) }`. Para los platos planeados, lee de `recipes` `name`, `imageUrl` y `totalTime`.
- `loadCookNowCandidates(userId, meal, weekday)`: `loadSlotPickContext({ userId, householdId, weekStart, bannedRecipeIds: menu?.bannedRecipeIds ?? [] }, userId)` (de `services/menuSlotPick.ts`), y después `matchRecipes(ctx.recipes, { meal, season: ctx.season, usedRecipeIds: new Set(), restrictions: ctx.restrictions, ...ctx.rated, dislikes: ctx.dislikes, availableEquipment: ctx.availableEquipment, unavailableEquipment: ctx.unavailableEquipment, dayIndex: weekday })` y `.filter((r) => isCookNowCourse(r.course))`. **Sin `timeBudget`:** el tiempo lo decide la respuesta. Devuelve también `boost` (el `loadHouseholdRatingSets(userId).boost`).
- `loadCookNowHouse(userId)`: despensa del hogar (`pantryItems` por `household_id`, `getPrimaryHouseholdId`), básicos activos (`listActiveStaplesForHousehold`), cocinadas en los últimos 7 días (`listRecentCookLogs(userId, 200)` filtrado por `cookedAt`), y `today` (`madridParts(new Date()).isoDate`).
- `findCookNowProposal(userId, answers)`: junta las tres, carga `substituteNames` (nombres de todos los `substituteIngredientIds` de las candidatas, una sola consulta a `ingredients`), llama a `rankCookNow`, filtra con `uses.length > 0` si `requirePantryUse`, corta a 3 y añade `imageUrl` de cada una (una consulta a `recipes`). Respuesta:

```ts
{
  meal: 'lunch' | 'dinner' | null,
  fallback: boolean,
  items: Array<{
    recipe: { id: string; name: string; imageUrl: string | null; totalTime: number | null }
    fit: 'fits' | 'margin'
    missingEssential: string[]; short: string[]; missingSecondary: string[]
    substitutions: Array<{ missing: string; use: string }>
    uses: string[]; expiring: string[]
  }>
}
```

Sin comida de ahora (`meal === null`), la búsqueda usa la cena (`'dinner'`) y `meal` vuelve como `null` para que la web lo diga.

- [ ] **Paso 3: rutas**

```ts
// apps/api/src/routes/cookNow.ts
/**
 * «Cocinar ahora» (specs/cook-now.md):
 *   GET  /cook-now/today     the meal of now, what was planned, where it can move
 *   POST /cook-now/proposal  { minutes, servings, canBuy, requirePantryUse? } → 0–3 recipes
 *   POST /cook-now/phrase    { recipeId } → { text | null } (Mimo's line, Task 12)
 *   POST /cook-now/choose    { recipeId, servings, displacedTo } → puts it in the meal of now
 */
import { Router } from 'express'
import { cookNowChooseSchema, cookNowProposalSchema } from '@ona/shared'
import { authMiddleware, type AuthRequest } from '../middleware/auth.js'
import { requireActiveAccount } from '../services/accountAccess.js'
import { chooseCookNowRecipe, findCookNowProposal, loadCookNowToday } from '../services/cookNow/load.js'

const router = Router()
router.use('/cook-now', authMiddleware)

router.get('/cook-now/today', async (req: AuthRequest, res) => {
  try {
    const t = await loadCookNowToday(req.userId!)
    res.json({ weekStart: t.weekStart, day: t.day, meal: t.meal, menuId: t.menu?.id ?? null, planned: t.planned, locked: t.locked, slotServings: t.slotServings, targets: t.targets })
  } catch (err) {
    console.error('GET /cook-now/today error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/cook-now/proposal', async (req: AuthRequest, res) => {
  const parsed = cookNowProposalSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Respuestas no válidas', issues: parsed.error.issues })
    return
  }
  try {
    res.json(await findCookNowProposal(req.userId!, parsed.data))
  } catch (err) {
    console.error('POST /cook-now/proposal error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

router.post('/cook-now/choose', requireActiveAccount(), async (req: AuthRequest, res) => {
  const parsed = cookNowChooseSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Elección no válida', issues: parsed.error.issues })
    return
  }
  try {
    res.json(await chooseCookNowRecipe(req, parsed.data))
  } catch (err) {
    console.error('POST /cook-now/choose error:', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
```

`chooseCookNowRecipe(req, body)` en `load.ts`:
1. `loadCookNowToday(req.userId!)`. Sin `meal` → `{ placed: false, reason: 'no_meal' }`. Comida bloqueada → `{ placed: false, reason: 'locked' }`.
2. La receta tiene que ser visible para el usuario (`visibleRecipeWhere(await visibleAuthorIds(userId))`, como en `assistant/skills.ts:710`) y no estar vetada esa semana; si no, `{ placed: false, reason: 'not_found' | 'banned' }`.
3. `displacedTo` solo vale si está en `targets` y no está `disabled`; si no, 400.
4. Con menú: `placeCookNowRecipe(...)`, `UPDATE menus SET days`, y `recordMenuEdits(req, menu, [...slotDiff(day, meal, antes, [dish]), ...(displacedTo != null ? slotDiff(displacedTo, meal, antesDestino, despuesDestino) : [])])` (de `services/menuEdits.ts`). Sin menú: insertar una fila con solo ese plato, como `pickWhatIHaveRecipe` (`assistant/skills.ts:727-735`).
5. Respuesta `{ placed: true, menuId, weekStart, day, meal }`.

El plato: `{ kind: 'recipe', recipeId, recipeName }` (como Mimo).

En `index.ts`, `app.use(cookNowRoutes)` junto a `cookLogRoutes`. En `routeTemplates.ts`, `'/cook-now/choose'`, `'/cook-now/proposal'` y `'/cook-now/today'` (la de `phrase` entra en la tarea 12, con su ruta: `agentView.test.ts` falla si hay plantilla sin ruta).

**Comida bloqueada antes de elegir:** `GET /cook-now/today` ya dice `locked`, así que la web avisa en la propuesta misma (tarea 16) y no espera a la respuesta de `choose`.

- [ ] **Paso 4: probar**

Run: `pnpm --filter @ona/api exec vitest run src/tests/cookNowLoad.test.ts src/tests/cookNowSearch.test.ts src/tests/cookNowPlace.test.ts src/tests/agentView.test.ts && pnpm --filter @ona/api lint`
Expected: PASS.

Prueba a mano contra la base de datos de pruebas (`pnpm --filter @ona/api dev` y un usuario sembrado):

```bash
TOKEN=... ; curl -s -X POST localhost:8765/cook-now/proposal -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{"minutes":null,"servings":2,"canBuy":true}' | jq '.items[0]'
curl -s localhost:8765/cook-now/today -H "Authorization: Bearer $TOKEN" | jq
```

Expected: un objeto con `recipe`, `fit` y las listas; `today` con `meal` y `targets`.

- [ ] **Paso 5: commit**

```bash
git add apps/api/src/services/cookNow/load.ts apps/api/src/routes/cookNow.ts apps/api/src/index.ts apps/api/src/services/routeTemplates.ts apps/api/src/tests/cookNowLoad.test.ts
git commit -m "feat(cocinar): rutas de «Cocinar ahora» (hoy, propuesta y elegir)"
```

### Tarea 12: la frase de Mimo

**Ficheros:**
- Crear: `apps/api/src/services/cookNow/phrase.ts`
- Modificar: `apps/api/src/routes/cookNow.ts`
- Test: `apps/api/src/tests/cookNowPhrase.test.ts`

- [ ] **Paso 1: prueba que falla**

```ts
// apps/api/src/tests/cookNowPhrase.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setCostSinkForTests } from '../services/costLedger.js'
import { cleanPhrase, cookNowPhrase, phraseFacts } from '../services/cookNow/phrase.js'

const costRows: unknown[] = []
beforeAll(() => setCostSinkForTests(async (row) => void costRows.push(row)))
afterAll(() => setCostSinkForTests(null))

const facts = { recipeName: 'Tortilla de calabacín', uses: ['calabacín', 'huevo'], expiring: ['calabacín'], lastCookedDaysAgo: 12, repeat: true, missingSecondary: ['perejil'] }

describe('phraseFacts', () => {
  it('lists only the facts given', () => {
    const t = phraseFacts(facts)
    expect(t).toContain('calabacín, huevo')
    expect(t).toContain('Caduca pronto: calabacín')
    expect(t).toContain('hace 12 días')
    expect(t).toContain('Repetir a menudo')
  })
})

describe('cleanPhrase', () => {
  it('first line, no quotes, at most 160 characters', () => {
    expect(cleanPhrase('«Te gasta el calabacín.»\nOtra')).toBe('Te gasta el calabacín.')
    expect(cleanPhrase('x'.repeat(300)).length).toBeLessThanOrEqual(160)
    expect(cleanPhrase('   ')).toBeNull()
  })
})

describe('cookNowPhrase', () => {
  const ok = async () => ({ content: [{ type: 'text', text: 'Te gasta el calabacín, que caduca pronto.' }], usage: { input_tokens: 1, output_tokens: 1 } })
  it('returns the model line', async () => {
    expect(await cookNowPhrase('u', facts, { create: ok as any, paused: async () => false })).toBe('Te gasta el calabacín, que caduca pronto.')
  })
  it('null when the model fails, is slow or the account is paused', async () => {
    expect(await cookNowPhrase('u', facts, { create: async () => { throw new Error('x') }, paused: async () => false })).toBeNull()
    expect(await cookNowPhrase('u', facts, { create: () => new Promise(() => {}), paused: async () => false, timeoutMs: 10 })).toBeNull()
    expect(await cookNowPhrase('u', facts, { create: ok as any, paused: async () => true })).toBeNull()
  })
})
```

Run: `pnpm --filter @ona/api exec vitest run src/tests/cookNowPhrase.test.ts`
Expected: FAIL.

- [ ] **Paso 2: implementación** (sigue el patrón de `services/fridgeReader.ts:246-280`)

```ts
// apps/api/src/services/cookNow/phrase.ts
/**
 * Mimo's line on the preferred «Cocinar ahora» recipe (specs/cook-now.md):
 * one short sentence written only from the facts given. The only live AI
 * call of the feature; billed as `cook_now_phrase`, outside Mimo's monthly
 * cap; a paused account gets none. Never throws: null on any failure or
 * after 5 s.
 */
import Anthropic from '@anthropic-ai/sdk'
import { env } from '../../config/env.js'
import { CLAUDE_MODEL, LOW_EFFORT, withThinkingRoom } from '../../config/models.js'
import { isAccountPaused } from '../accountAccess.js'
import { anthropicUnits, recordCost } from '../costLedger.js'

export interface PhraseFactsInput {
  recipeName: string
  uses: string[]
  expiring: string[]
  lastCookedDaysAgo: number | null
  repeat: boolean
  missingSecondary: string[]
}

export const COOK_NOW_PHRASE_PROMPT = `Eres Mimo, el asistente de Mimoia. Alguien va a cocinar ahora y Mimoia le propone una receta. Escribe UNA frase corta (15 palabras como mucho), en español de España y tuteando, que diga por qué esta receta le encaja ahora. Usa solo los datos que te doy; no inventes ingredientes, fechas ni gustos. Sin emojis ni comillas.`

export function phraseFacts(f: PhraseFactsInput): string {
  const lines = [`Receta: ${f.recipeName}`]
  if (f.uses.length) lines.push(`Usa de su despensa: ${f.uses.join(', ')}`)
  if (f.expiring.length) lines.push(`Caduca pronto: ${f.expiring.join(', ')}`)
  if (f.lastCookedDaysAgo != null) lines.push(`La cocinó por última vez hace ${f.lastCookedDaysAgo} días`)
  if (f.repeat) lines.push('La marcó como «Repetir a menudo»')
  if (f.missingSecondary.length) lines.push(`Puede hacerla sin: ${f.missingSecondary.join(', ')}`)
  return lines.join('\n')
}

export function cleanPhrase(raw: string): string | null {
  const first = raw.split('\n').map((l) => l.trim()).find(Boolean) ?? ''
  const unquoted = first.replace(/^[«"“']+|[»"”']+$/g, '').trim()
  return unquoted ? unquoted.slice(0, 160) : null
}

type CreateFn = (p: Anthropic.MessageCreateParamsNonStreaming) => Promise<{ content: Array<{ type: string; text?: string }>; usage?: unknown }>

export async function cookNowPhrase(
  userId: string,
  facts: PhraseFactsInput,
  deps: { create?: CreateFn; paused?: (id: string) => Promise<boolean>; timeoutMs?: number; householdId?: string | null } = {},
): Promise<string | null> {
  try {
    if (await (deps.paused ?? ((id) => isAccountPaused(id, new Date())))(userId)) return null
    let create = deps.create
    if (!create) {
      if (!env.ANTHROPIC_API_KEY) return null
      const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
      create = (p) => client.messages.create(p) as any
    }
    const call = create({
      model: CLAUDE_MODEL,
      max_tokens: withThinkingRoom(80),
      ...LOW_EFFORT,
      system: COOK_NOW_PHRASE_PROMPT,
      messages: [{ role: 'user', content: phraseFacts(facts) }],
    } as Anthropic.MessageCreateParamsNonStreaming)
    const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), deps.timeoutMs ?? 5000))
    const response = await Promise.race([call, timeout])
    if (!response) return null
    // Outside Mimo's monthly cap: billed to the household, not to the user's
    // monthly sum (getUserMonthlySpendEur reads cost_events by user_id).
    if (response.usage) {
      recordCost({ feature: 'cook_now_phrase', provider: 'anthropic', model: CLAUDE_MODEL, units: anthropicUnits(response.usage as any), userId: null, householdId: deps.householdId ?? null })
    }
    const text = response.content.find((b) => b.type === 'text')?.text ?? ''
    return cleanPhrase(text)
  } catch (err) {
    console.warn('[cook-now-phrase] failed:', (err as Error)?.message ?? err)
    return null
  }
}
```

Comprueba la firma real de `isAccountPaused` (`services/accountAccess.ts:83`) y ajústala. Comprueba también que `getUserMonthlySpendEur` (`costLedger.ts:173`) suma por `user_id` y no por hogar; si suma por hogar, excluye la `feature` `cook_now_phrase` en esa suma y añade una prueba. La ruta pasa `householdId: await getPrimaryHouseholdId(userId)`.

- [ ] **Paso 3: ruta** — en `routes/cookNow.ts`:

```ts
router.post('/cook-now/phrase', async (req: AuthRequest, res) => {
  const parsed = cookNowPhraseSchema.safeParse(req.body)
  if (!parsed.success) {
    res.status(400).json({ error: 'Receta no válida' })
    return
  }
  try {
    const facts = await loadPhraseFacts(req.userId!, parsed.data.recipeId) // load.ts: evaluateRecipe + getRecipeCookStats + boost
    res.json({ text: facts ? await cookNowPhrase(req.userId!, facts, { householdId: await getPrimaryHouseholdId(req.userId!) }) : null })
  } catch (err) {
    console.error('POST /cook-now/phrase error:', err)
    res.json({ text: null })
  }
})
```

`loadPhraseFacts` en `load.ts`: la receta (de `loadMatchableRecipes`, por id), `loadCookNowHouse`, `evaluateRecipe(recipe, { minutes: null, servings: recipe.servings ?? 4, canBuy: true }, ctx)` para `uses`, `expiring` y `missingSecondary`; `getRecipeCookStats(userId, recipeId)` para los días desde la última vez; `boost.has(recipeId)` para `repeat`. `null` si la receta no es visible.

- [ ] **Paso 4: ver que pasa**

Run: `pnpm --filter @ona/api exec vitest run src/tests/cookNowPhrase.test.ts && pnpm --filter @ona/api lint`
Expected: PASS.

- [ ] **Paso 5: commit**

```bash
git add apps/api/src/services/cookNow/phrase.ts apps/api/src/services/cookNow/load.ts apps/api/src/routes/cookNow.ts apps/api/src/services/routeTemplates.ts apps/api/src/tests/cookNowPhrase.test.ts
git commit -m "feat(cocinar): la frase de Mimo en la receta preferente"
```

(En el paso 3, añade `'/cook-now/phrase'` a `routeTemplates.ts`.)

### Tarea 12 bis: eventos de uso (puerta de crecimiento)

**Ficheros:**
- Modificar: `apps/api/src/services/usageEvents.ts` (`USAGE_EVENTS`, `ROUTE_EVENTS`), la sección de eventos de `/admin/usage` (mira `specs/metrics.md` para saber dónde se cuentan) y `specs/metrics.md`
- Test: `apps/api/src/tests/usageEvents.test.ts`

- [ ] **Paso 1: prueba que falla** (en el `describe('routeUsageEvent (web requests)')` que ya existe):

```ts
  it('«Cocinar ahora»: proposal, choose and a cook from the menu', () => {
    expect(routeUsageEvent(req('POST', '/cook-now/proposal', { minutes: 30, servings: 2, canBuy: false }))).toEqual({ name: 'cook_now_proposed', props: { canBuy: false }, channel: 'web' })
    // The «Con lo que tienes» card asks the same route: not a proposal anyone asked for.
    expect(routeUsageEvent(req('POST', '/cook-now/proposal', { minutes: null, servings: 2, canBuy: false, requirePantryUse: true }))).toBeNull()
    expect(routeUsageEvent(req('POST', '/cook-now/choose', { recipeId: 'r', servings: null, displacedTo: 2 }))).toEqual({ name: 'cook_now_chosen', props: { displaced: true }, channel: 'web' })
    expect(routeUsageEvent(req('POST', '/cook-logs', { recipeId: 'r', menuId: 'm' }))).toEqual({ name: 'meal_cooked', props: { fromMenu: true }, channel: 'web' })
    expect(routeUsageEvent(req('POST', '/cook-logs', { recipeId: 'r' }))).toEqual({ name: 'meal_cooked', props: { fromMenu: false }, channel: 'web' })
  })
```

Run: `pnpm --filter @ona/api exec vitest run src/tests/usageEvents.test.ts`
Expected: FAIL. Si otra prueba espera `meal_cooked` sin `props`, cámbiala a la vez.

- [ ] **Paso 2: implementación**
  - `USAGE_EVENTS`: `'cook_now_proposed'` y `'cook_now_chosen'`.
  - `ROUTE_EVENTS`:

```ts
  {
    method: 'POST',
    re: /^\/cook-now\/proposal\/?$/,
    event: (req) => (req.body?.requirePantryUse ? null : { name: 'cook_now_proposed', props: { canBuy: Boolean(req.body?.canBuy) } }),
  },
  { method: 'POST', re: /^\/cook-now\/choose\/?$/, event: (req) => ({ name: 'cook_now_chosen', props: { displaced: req.body?.displacedTo != null } }) },
```

  y la de `/cook-logs` pasa a `event: (req) => ({ name: 'meal_cooked', props: { fromMenu: Boolean(req.body?.menuId) } })`. Si el tipo de `event` no admite `null`, ajústalo (`routeUsageEvent` ya trata un `ev` vacío).
  - `/admin/usage`: las dos filas nuevas con su recuento, como las demás, y en `specs/metrics.md` qué cuenta cada una y que protegen el «primer acierto» (D-158).

- [ ] **Paso 3: ver que pasa**

Run: `pnpm --filter @ona/api exec vitest run src/tests/usageEvents.test.ts src/tests/usageEventsPro120.test.ts && pnpm --filter @ona/api lint`
Expected: PASS.

- [ ] **Paso 4: commit**

```bash
git add apps/api/src/services/usageEvents.ts apps/api/src/tests/usageEvents.test.ts specs/metrics.md
git commit -m "feat(metricas): eventos de «Cocinar ahora» y si lo cocinado viene del menú"
```

(Añade también al `git add` el fichero de `/admin/usage` que hayas tocado.)

---

## Fase 3 — La pestaña «Cocinar»

### Tarea 13: barra de cinco pestañas, ruta protegida y uso medido

**Ficheros:**
- Modificar: `apps/web/src/components/shared/Navbar.tsx:7-14,45`, `apps/web/src/components/shared/DesktopSidebar.tsx:12-15`, `apps/web/src/lib/usagePaths.ts:8,23-35`, `apps/api/src/services/usageEvents.ts:374`, `apps/api/src/tests/routeAccess.test.ts:37`, `apps/api/src/tests/webUsagePaths.test.ts`, `CLAUDE.md` («Common pitfalls», la línea de la barra). La plantilla `'/cocinar'` de `routeTemplates.ts` entra en la tarea 15, con la página.

- [ ] **Paso 1: pruebas que fallan**
  - En `webUsagePaths.test.ts`: `expect(screenOfPath('/cocinar')).toBe('cocinar')` y que `USAGE_SCREENS` contiene `'cocinar'`.
  - En `routeAccess.test.ts`: añade `'/cocinar'` a `PROTECTED`.

Run: `pnpm --filter @ona/api exec vitest run src/tests/webUsagePaths.test.ts src/tests/routeAccess.test.ts`
Expected: FAIL la de uso; la de acceso ya pasa, porque toda página es protegida por defecto.

- [ ] **Paso 2: implementación**
  - `usageEvents.ts`: `'cocinar'` en `USAGE_SCREENS`. `usagePaths.ts`: `'cocinar'` en `UsageScreen` y `if (p === "/cocinar") return "cocinar"`. La línea de `/profile/pantry` → `'despensa'` se queda (ya no se alcanza tras la redirección, pero mantiene el histórico legible); anótalo en `feature-usage.md` en la tarea 20.
  - `Navbar.tsx`: `import { CalendarDays, ChefHat, ShoppingCart, BookOpen, User } from "lucide-react"`; en `NAV_ITEMS`, después de Menú, `{ href: "/cocinar", label: "Cocinar", icon: ChefHat }`; `grid-cols-4` pasa a `grid-cols-5`; en el comentario, «four tabs» pasa a «five tabs».
  - `DesktopSidebar.tsx`: la misma entrada después de Menú.
  - `CLAUDE.md`: en «Common pitfalls», «The bottom tab bar (`Navbar`) is fixed, full width, with visible labels» añade «five tabs: Menú, Cocinar, Compra, Recetas, Perfil».

- [ ] **Paso 3: ver que pasa y buscar pruebas que cuenten pestañas**

Run: `pnpm --filter @ona/api exec vitest run src/tests/webUsagePaths.test.ts src/tests/routeAccess.test.ts && grep -rn "toHaveCount(4)\|grid-cols-4\|nth(3)" apps/web/e2e | head`
Expected: PASS; ajusta los e2e que cuenten 4 pestañas.

- [ ] **Paso 4: commit**

```bash
git add apps/web/src/components/shared/Navbar.tsx apps/web/src/components/shared/DesktopSidebar.tsx apps/web/src/lib/usagePaths.ts apps/api/src/services/usageEvents.ts apps/api/src/tests/webUsagePaths.test.ts apps/api/src/tests/routeAccess.test.ts CLAUDE.md
git commit -m "feat(cocinar): pestaña «Cocinar» en la barra de abajo y en la lateral"
```

### Tarea 14: la despensa se muda

**Ficheros:**
- Crear: `apps/web/src/components/pantry/PantryManager.tsx`
- Modificar: `apps/web/src/app/profile/pantry/page.tsx`, `apps/web/src/app/profile/page.tsx` (enlace «Despensa»), `apps/api/src/tests/redesignDSubPerfil.test.ts:12`

- [ ] **Paso 1:** mueve **todo** el contenido de `PantryPage` (estado, formulario, lista agrupada y `PantryRow`) de `app/profile/pantry/page.tsx` a `components/pantry/PantryManager.tsx` como `export function PantryManager()`, sin el envoltorio `SubPage` (la pestaña pone el suyo). No cambies la conducta.

- [ ] **Paso 2:** `/profile/pantry` redirige:

```tsx
// apps/web/src/app/profile/pantry/page.tsx
import { redirect } from "next/navigation"

/** The pantry lives in the «Cocinar» tab since 2026-11 (specs/cook-now.md). */
export default function PantryRedirect() {
  redirect("/cocinar#despensa")
}
```

- [ ] **Paso 3:** el enlace de Perfil a la despensa apunta a `/cocinar#despensa`. En `redesignDSubPerfil.test.ts`, cambia `'apps/web/src/app/profile/pantry'` por `'apps/web/src/components/pantry'` y añade `'apps/web/src/components/cocinar'`, para que la guarda contra la paleta antigua siga mirando ese código (si la prueba exige que cada entrada sea una página de Perfil, añade una lista aparte para componentes).

- [ ] **Paso 4: tipos y prueba**

Run: `pnpm --filter @ona/web exec tsc --noEmit && pnpm --filter @ona/api exec vitest run src/tests/redesignDSubPerfil.test.ts`
Expected: PASS.

- [ ] **Paso 5: commit**

```bash
git add apps/web/src/components/pantry/PantryManager.tsx apps/web/src/app/profile/pantry/page.tsx apps/web/src/app/profile/page.tsx apps/api/src/tests/redesignDSubPerfil.test.ts
git commit -m "refactor(despensa): la despensa sale de Perfil para vivir en «Cocinar»"
```

### Tarea 14 bis: enlace al modo cocina y cuerpos de las peticiones (con su prueba de contrato)

Va antes de la página porque la tarjeta de hoy y la propuesta los usan.

**Ficheros:**
- Crear: `apps/web/src/lib/cookHref.ts`, `apps/web/src/lib/cookNowPayload.ts`
- Test: `apps/api/src/tests/cookHref.test.ts`, `apps/api/src/tests/cookNowContract.test.ts`

- [ ] **Paso 1: prueba de `cookHref` que falla**

```ts
// apps/api/src/tests/cookHref.test.ts
import { describe, expect, it } from 'vitest'
import { cookHref, menuContextFromSearch } from '../../../web/src/lib/cookHref'

describe('cookHref', () => {
  it('without menu context', () => expect(cookHref('r1', 2)).toBe('/recipes/r1/cook?servings=2'))
  it('with menu context', () => expect(cookHref('r1', 4, { menuId: 'm1', day: 3, meal: 'dinner' })).toBe('/recipes/r1/cook?servings=4&menu=m1&day=3&meal=dinner'))
})

describe('menuContextFromSearch', () => {
  it('reads it back, or null when incomplete or odd', () => {
    expect(menuContextFromSearch('?servings=4&menu=m1&day=3&meal=dinner')).toEqual({ menuId: 'm1', day: 3, meal: 'dinner' })
    expect(menuContextFromSearch('?servings=4&menu=m1')).toBeNull()
    expect(menuContextFromSearch('?menu=m1&day=9&meal=dinner')).toBeNull()
    expect(menuContextFromSearch('?menu=m1&day=1&meal=cena')).toBeNull()
  })
})
```

Run: `pnpm --filter @ona/api exec vitest run src/tests/cookHref.test.ts`
Expected: FAIL.

- [ ] **Paso 2: `cookHref`**

```ts
// apps/web/src/lib/cookHref.ts
/** Cook mode link, with the menu slot it cooks when there is one (specs/cook-now.md). */
export interface CookMenuContext {
  menuId: string
  day: number
  meal: string
}

const MEALS = ["breakfast", "lunch", "snack", "dinner"]

export function cookHref(recipeId: string, servings: number, ctx?: CookMenuContext | null): string {
  const q = new URLSearchParams({ servings: String(servings) })
  if (ctx) {
    q.set("menu", ctx.menuId)
    q.set("day", String(ctx.day))
    q.set("meal", ctx.meal)
  }
  return `/recipes/${recipeId}/cook?${q.toString()}`
}

export function menuContextFromSearch(search: string): CookMenuContext | null {
  const q = new URLSearchParams(search)
  const menuId = q.get("menu")
  const rawDay = q.get("day")
  const day = Number(rawDay)
  const meal = q.get("meal") ?? ""
  if (!menuId || rawDay == null || !Number.isInteger(day) || day < 0 || day > 6 || !MEALS.includes(meal)) return null
  return { menuId, day, meal }
}
```

Run: `pnpm --filter @ona/api exec vitest run src/tests/cookHref.test.ts`
Expected: PASS.

- [ ] **Paso 3: prueba de contrato que falla** — los cuerpos que la web manda de verdad, contra los esquemas de `@ona/shared` (como `recipeFormContract.test.ts`):

```ts
// apps/api/src/tests/cookNowContract.test.ts
import { describe, expect, it } from 'vitest'
import { cookNowChooseSchema, cookNowProposalSchema } from '@ona/shared'
import { chooseBody, pantryMatchBody, proposalBody } from '../../../web/src/lib/cookNowPayload'

describe('«Cocinar ahora» web payloads match the API schemas', () => {
  it('proposal, for every time button', () => {
    for (const minutes of [15, 30, 45, null] as const) {
      expect(cookNowProposalSchema.safeParse(proposalBody({ minutes, servings: 3, canBuy: true })).success).toBe(true)
    }
    expect(cookNowProposalSchema.safeParse(pantryMatchBody(2)).success).toBe(true)
  })
  it('choose sends null servings only when they are the household default', () => {
    const same = chooseBody({ recipeId: '00000000-0000-4000-8000-000000000001', servings: 2, householdDiners: 2, displacedTo: null })
    const other = chooseBody({ recipeId: '00000000-0000-4000-8000-000000000001', servings: 3, householdDiners: 2, displacedTo: 4 })
    expect(same.servings).toBeNull()
    expect(other.servings).toBe(3)
    expect(cookNowChooseSchema.safeParse(same).success).toBe(true)
    expect(cookNowChooseSchema.safeParse(other).success).toBe(true)
  })
})
```

Run: `pnpm --filter @ona/api exec vitest run src/tests/cookNowContract.test.ts`
Expected: FAIL.

- [ ] **Paso 4: `cookNowPayload`**

```ts
// apps/web/src/lib/cookNowPayload.ts
/** Bodies the web sends to /cook-now/* (contract test: apps/api/src/tests/cookNowContract.test.ts). */
import type { CookNowChooseRequest, CookNowProposalRequest } from "@ona/shared"

export function proposalBody(a: { minutes: 15 | 30 | 45 | null; servings: number; canBuy: boolean }): CookNowProposalRequest {
  return { minutes: a.minutes, servings: a.servings, canBuy: a.canBuy }
}

/** «Con lo que tienes»: default answers, only what uses the pantry. */
export function pantryMatchBody(servings: number): CookNowProposalRequest {
  return { minutes: null, servings, canBuy: false, requirePantryUse: true }
}

/** Servings go as null when they are the household's default diners (the slot then keeps no override). */
export function chooseBody(a: { recipeId: string; servings: number; householdDiners: number; displacedTo: number | null }): CookNowChooseRequest {
  return { recipeId: a.recipeId, servings: a.servings === a.householdDiners ? null : a.servings, displacedTo: a.displacedTo }
}
```

Run: `pnpm --filter @ona/shared build && pnpm --filter @ona/api exec vitest run src/tests/cookNowContract.test.ts src/tests/cookHref.test.ts`
Expected: PASS.

- [ ] **Paso 5: los comensales del hogar, una sola cuenta para el Menú y «Cocinar»**

El Menú cuenta a cada niño como una persona (`adults + kidsCount`, `app/menu/page.tsx:200-206`); `householdToDinersOrNull` cuenta medio por niño y **no** sirve aquí. Saca la cuenta del Menú a un helper y úsalo en los dos sitios:

```ts
// apps/web/src/lib/menuDiners.ts
/** Household diners as the menu counts them (a child is one person): the fallback when a meal has no people count of its own. */
export function menuDiners(p: { adults?: number | null; kidsCount?: number | null }): number {
  return Math.max(1, (p.adults ?? 0) + (p.kidsCount ?? 0) || 2)
}
```

Prueba en `apps/api/src/tests/cookNowContract.test.ts`:

```ts
import { menuDiners } from '../../../web/src/lib/menuDiners'

describe('menuDiners', () => {
  it('counts a child as one person, like the menu', () => {
    expect(menuDiners({ adults: 2, kidsCount: 2 })).toBe(4)
    expect(menuDiners({ adults: 1, kidsCount: 0 })).toBe(1)
    expect(menuDiners({})).toBe(2)
  })
})
```

En `app/menu/page.tsx`, `defaultDiners` pasa a `menuDiners({ adults: profile?.adults ?? user?.adults, kidsCount: profile?.kidsCount ?? user?.kidsCount })`, sin cambiar lo que sale.

Run: `pnpm --filter @ona/api exec vitest run src/tests/cookNowContract.test.ts && pnpm --filter @ona/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Paso 6: commit**

```bash
git add apps/web/src/lib/cookHref.ts apps/web/src/lib/cookNowPayload.ts apps/web/src/lib/menuDiners.ts apps/web/src/app/menu/page.tsx apps/api/src/tests/cookHref.test.ts apps/api/src/tests/cookNowContract.test.ts
git commit -m "feat(cocinar): enlace al modo cocina con contexto de menú y cuerpos de /cook-now con prueba de contrato"
```

### Tarea 15: hooks y la página `/cocinar`

**Ficheros:**
- Crear: `apps/web/src/hooks/useCookNow.ts`, `apps/web/src/app/cocinar/page.tsx`, `apps/web/src/components/cocinar/TodayPlannedCard.tsx`, `apps/web/src/components/cocinar/PantryMatchCard.tsx`
- Retirar: `apps/web/src/components/menu/PantryMatchCard.tsx`, `apps/web/src/hooks/usePantryMatch.ts`
- Modificar: `apps/web/src/app/menu/page.tsx:60,684` (quitar la tarjeta), `apps/api/src/services/routeTemplates.ts` (`'/cocinar'` en las páginas de la web, ahora que existe)

- [ ] **Paso 1: hooks**

```ts
// apps/web/src/hooks/useCookNow.ts
/** «Cocinar ahora» (specs/cook-now.md): the meal of now, the proposal, Mimo's line and «Cocinar esta». */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import type { CookNowChooseRequest, CookNowProposalRequest, DisplaceTarget, RecipeDish } from "@ona/shared"
import { api } from "@/lib/api"
import { pantryMatchBody } from "@/lib/cookNowPayload"

export interface CookNowToday {
  weekStart: string
  day: number
  meal: "lunch" | "dinner" | null
  menuId: string | null
  planned: Array<RecipeDish & { imageUrl?: string | null; totalTime?: number | null }>
  locked: boolean
  slotServings: number | null
  targets: DisplaceTarget[]
}

export interface CookNowItem {
  recipe: { id: string; name: string; imageUrl: string | null; totalTime: number | null }
  fit: "fits" | "margin"
  missingEssential: string[]
  short: string[]
  missingSecondary: string[]
  substitutions: Array<{ missing: string; use: string }>
  uses: string[]
  expiring: string[]
}

export interface CookNowProposal {
  meal: "lunch" | "dinner" | null
  fallback: boolean
  items: CookNowItem[]
}

export function useCookNowToday() {
  return useQuery<CookNowToday>({ queryKey: ["cook-now", "today"], queryFn: () => api.get<CookNowToday>("/cook-now/today") })
}

export function useCookNowProposal() {
  return useMutation<CookNowProposal, Error, CookNowProposalRequest>({
    mutationFn: (body) => api.post<CookNowProposal>("/cook-now/proposal", body),
  })
}

/** «Con lo que tienes»: the proposal with the default answers, only what uses the pantry. */
export function usePantryMatches(servings: number) {
  return useQuery<CookNowProposal>({
    queryKey: ["cook-now", "pantry-match", servings],
    queryFn: () => api.post<CookNowProposal>("/cook-now/proposal", pantryMatchBody(servings)),
    staleTime: 60_000,
  })
}

export function useCookNowPhrase(recipeId: string | null) {
  return useQuery<{ text: string | null }>({
    queryKey: ["cook-now", "phrase", recipeId],
    queryFn: () => api.post<{ text: string | null }>("/cook-now/phrase", { recipeId }),
    enabled: !!recipeId,
    staleTime: Infinity,
    retry: false,
  })
}

export function useCookNowChoose() {
  const qc = useQueryClient()
  return useMutation<
    { placed: true; menuId: string; weekStart: string; day: number; meal: string } | { placed: false; reason: "no_meal" | "locked" | "not_found" | "banned" },
    Error,
    CookNowChooseRequest
  >({
    mutationFn: (body) => api.post("/cook-now/choose", body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["menu"] })
      qc.invalidateQueries({ queryKey: ["cook-now"] })
    },
  })
}
```

Comprueba que `api.post` devuelve el cuerpo tipado como en `useCookLogs.ts`. En `hooks/usePantry.ts`, el `onSuccess` de añadir, cambiar y quitar invalida también `["cook-now"]`, para que «Con lo que tienes» no se quede vieja tras confirmar la despensa.

- [ ] **Paso 2: `TodayPlannedCard`** — si `today.planned.length > 0` y la comida no está bloqueada: foto (la del primer plato), «Hoy tocaban *{nombres}* · {totalTime} min» (o «Hoy toca» con un solo plato) y «Empezar a cocinar», que enlaza con `cookHref(recipeId, servings, { menuId, day, meal })` (tarea 14 bis). Debajo, siempre, el botón «¿Otra cosa? Cocinar ahora» (o «Cocinar ahora» si no hay nada planeado), que llama a `onStart()`. Estilo editorial (`design-system.md`): tarjeta `paper`, título en Fraunces, botón principal `bg-ink text-cream` y el secundario con borde.

- [ ] **Paso 3: `PantryMatchCard`** — reescribe la del Menú sobre `usePantryMatches(servings)`: «Con lo que tienes · Puedes cocinar esto», hasta 3 filas (miniatura, nombre, `cookNowHitLine(item)`, tiempo), cada fila con un enlace a `/recipes/[id]`. Sin elementos, o con `fallback: true` (a todas les falta algo imprescindible: no es «con lo que tienes»), la tarjeta no sale.

- [ ] **Paso 4: la página**

```tsx
// apps/web/src/app/cocinar/page.tsx
"use client"

/**
 * /cocinar — «Cocinar ahora» (specs/cook-now.md): what was planned for the
 * meal of now, the four questions and the proposal, «Con lo que tienes» and
 * the whole pantry (moved here from /profile/pantry).
 */
import { useState } from "react"
import { useAuth } from "@/lib/auth"
import { menuDiners } from "@/lib/menuDiners"
import { useUser } from "@/hooks/useUser"
import { useCookNowToday } from "@/hooks/useCookNow"
import { TodayPlannedCard } from "@/components/cocinar/TodayPlannedCard"
import { CookNowFlow } from "@/components/cocinar/CookNowFlow"
import { PantryMatchCard } from "@/components/cocinar/PantryMatchCard"
import { PantryManager } from "@/components/pantry/PantryManager"

export default function CocinarPage() {
  const { user } = useAuth()
  const { data: today } = useCookNowToday()
  const [flowOpen, setFlowOpen] = useState(false)
  const { data: profile } = useUser(user?.id)
  // Same count as the menu (a child is one person): see lib/menuDiners.ts.
  const householdDiners = menuDiners({ adults: (profile?.adults as number | undefined) ?? user?.adults, kidsCount: (profile?.kidsCount as number | undefined) ?? user?.kidsCount })
  // The meal's own people count when it has one, else the household's.
  const defaultDiners = today?.slotServings ?? householdDiners

  if (flowOpen && today)
    return <CookNowFlow today={today} defaultDiners={defaultDiners} householdDiners={householdDiners} onClose={() => setFlowOpen(false)} />

  return (
    <div className="mx-auto w-full max-w-[var(--container-max)] px-4 pt-6 lg:px-8">
      <header className="mb-5">
        <p className="text-[12px] font-medium uppercase tracking-[0.14em] text-ink-muted">Cocinar</p>
        <h1 className="font-serif-display text-[32px] leading-tight text-ink">¿Qué cocinamos?</h1>
      </header>
      <TodayPlannedCard today={today} defaultDiners={defaultDiners} onStart={() => setFlowOpen(true)} />
      <PantryMatchCard servings={defaultDiners} />
      <section id="despensa" className="mt-8 scroll-mt-6">
        <h2 className="mb-3 font-serif-display text-[24px] text-ink">Tu despensa</h2>
        <PantryManager />
      </section>
    </div>
  )
}
```

Usa las clases de tipografía y de contenedor de las páginas ya migradas (mira `app/menu/page.tsx` o `components/profile/SubPage.tsx`). Si alguna de arriba no existe, cámbiala por la equivalente.

- [ ] **Paso 5: quitar la tarjeta del Menú**

En `app/menu/page.tsx`, borra el `import { PantryMatchCard } …` (línea 60) y su uso (línea 684). Borra `components/menu/PantryMatchCard.tsx` y `hooks/usePantryMatch.ts`.

Run: `grep -rn "usePantryMatch\|menu/PantryMatchCard" apps/web/src`
Expected: sin resultados.

- [ ] **Paso 6: tipos**

Run: `pnpm --filter @ona/web exec tsc --noEmit && pnpm --filter @ona/api exec vitest run src/tests/agentView.test.ts`
Expected: sin errores (`CookNowFlow` todavía no existe: crea un esqueleto `export function CookNowFlow(props: {...}) { return null }` y se rellena en la tarea 16).

- [ ] **Paso 7: commit**

```bash
git add apps/web/src/hooks/useCookNow.ts apps/web/src/hooks/usePantry.ts apps/web/src/app/cocinar apps/web/src/components/cocinar apps/web/src/app/menu/page.tsx apps/api/src/services/routeTemplates.ts
git rm apps/web/src/components/menu/PantryMatchCard.tsx apps/web/src/hooks/usePantryMatch.ts
git commit -m "feat(cocinar): página «Cocinar» con lo que tocaba hoy, «Con lo que tienes» y la despensa"
```

### Tarea 16: las cuatro preguntas y la propuesta

**Ficheros:**
- Crear: `apps/web/src/components/cocinar/CookNowFlow.tsx`, `PantryConfirmStep.tsx`, `ProposalView.tsx`, `DisplaceSheet.tsx`

- [ ] **Paso 1: `CookNowFlow`** — estado: `step` (1–5), `minutes`, `servings` (empieza en `defaultDiners`), `canBuy`. Cada paso a pantalla completa con «Atrás» arriba a la izquierda (en el paso 1, «Atrás» cierra con `onClose`):
  1. «¿Cuánto tiempo tienes?» — cuatro botones grandes: «15 min», «30 min», «45 min», «1 h o más» (`null`). Un toque guarda y pasa al 2.
  2. «¿Para cuántos?» — contador `− N +` (de 1 a 20) y «Seguir».
  3. «¿Puedes comprar algo?» — «Solo lo que hay» (`false`) · «Sí, algo» (`true`). Un toque y al 4.
  4. `PantryConfirmStep` con el botón «Proponme una receta» (así, sin tilde), que llama a `useCookNowProposal().mutate(proposalBody({ minutes, servings, canBuy }))` (de `@/lib/cookNowPayload`) y pasa al 5.
  5. `ProposalView` con el resultado.

  Las respuestas se mantienen al ir atrás. Botones con `aria-pressed` en la opción elegida, para las pruebas y la accesibilidad.

- [ ] **Paso 2: `PantryConfirmStep`** — título «Confirma tu despensa» (o «¿Qué tienes en casa?» con la despensa vacía, abriendo el buscador). Usa `usePantry`, `usePatchPantry`, `useDeletePantry` y `useAddPantry` de `hooks/usePantry.ts`, agrupado con `groupPantryByLocation` (Nevera → Congelador → Despensa; la Despensa plegada en un `<details>`). Cada fila: nombre, `−` / cantidad / `+` (paso 1 para `u`, `cda` y `cdita`; 50 para `g` y `ml`; tocar la cantidad deja escribirla) y «Quitar». Cada cambio llama a `PATCH /pantry/:id` al momento (al llegar a 0, la fila se queda con 0, no se borra). «Añadir»: el buscador de `WithWhatIHavePicker` (`useSearchIngredients` + `useDebounced`; `useDebounced` es local de `WithWhatIHavePicker.tsx`: expórtalo de allí o muévelo a `lib/`) → al elegir, cantidad 1, unidad `u` y «Dónde está» (por defecto Nevera) → `POST /pantry { name, ingredientId, quantity, unit, location }`. Abajo, fijo: «Proponme una receta».

- [ ] **Paso 3: `ProposalView`**
  - Cargando: «Buscando…».
  - `meal === null`: aviso «Hoy ya habéis comido y cenado: la cocinas igual, pero no la apunto en el menú.».
  - `today.locked`: aviso, antes de elegir, «Esa comida está bloqueada en tu menú: la cocinas igual, pero no la apunto.».
  - `fallback`: la línea «Con lo que hay justo no sale ninguna; a estas les falta una cosa».
  - Sin elementos: «Con esto no encuentro nada» y «Cambiar respuestas».
  - **La preferente** (`items[0]`): foto grande, nombre, `{totalTime} min` (con «· unos minutos más» si `fit === 'margin'`), `cookNowHitLine(item)` y, debajo, la frase de `useCookNowPhrase(items[0].recipe.id)`, que aparece cuando llega (sin hueco reservado). Botón «Cocinar esta».
  - **Dos alternativas** (`items[1]`, `items[2]`): fila con miniatura, nombre, tiempo y línea; tocar la fila la hace la preferente (sube arriba y pide su frase).
  - «Cambiar respuestas» vuelve al paso 1.

- [ ] **Paso 4: «Cocinar esta» y `DisplaceSheet`**
  - Si `today.planned.length > 0` (y no está bloqueada), abre `DisplaceSheet` (`MenuSheet` de `components/menu/MenuSheet.tsx`): título «¿Y {las|el} *{nombres}*?», «Pasarlas a otro día» (despliega `today.targets`: «Mañana», «El jueves»… con «libre» o «en lugar de *Merluza al horno*»; los `disabled`, grises y sin toque) y «Quitarlas». Cerrar = quitarlas.
  - Después, `useCookNowChoose().mutate(chooseBody({ recipeId, servings, householdDiners, displacedTo }))`: se compara con los comensales **del hogar**, no con los de la comida, para que una comida con su propio número (3) lo conserve si se deja en 3.
  - Con `today.locked` o `today.meal === null`, sin llamar a `choose`: directamente `router.push(cookHref(recipeId, servings))`.
  - `placed: true` → `router.push(cookHref(recipeId, servings, { menuId, day, meal }))`.
  - `placed: false` con `locked` o `no_meal` → aviso «Esa comida está bloqueada en tu menú: la cocinas igual, pero no la apunto.» y `router.push(cookHref(recipeId, servings))` sin contexto.
  - Si no había nada planeado, sin hoja.

- [ ] **Paso 5: probar en el navegador a 390×844** (Playwright MCP o `pnpm --filter @ona/web dev`): las cuatro preguntas, atrás y adelante, editar una cantidad de la despensa, la propuesta con 1 + 2, tocar una alternativa, la hoja. Mira también 1440×900.

Run: `pnpm --filter @ona/web exec tsc --noEmit && pnpm --filter @ona/web lint`
Expected: sin errores.

- [ ] **Paso 6: commit**

```bash
git add apps/web/src/components/cocinar
git commit -m "feat(cocinar): las cuatro preguntas, la despensa a confirmar y la propuesta 1 + 2"
```

---

## Fase 4 — Modo cocina y menú

### Tarea 17: el modo cocina sabe de qué comida viene

**Ficheros:**
- Modificar: `apps/web/src/components/menu/DayMeals.tsx:41-43,189`, `apps/web/src/app/menu/page.tsx` (pasa `isToday` a `DayMeals`), `apps/web/src/app/recipes/[id]/cook/page.tsx`, `apps/web/src/components/cooking/CookingShell.tsx:27-31,198-213,464-472`
- Usa: `apps/web/src/lib/cookHref.ts` (tarea 14 bis)

- [ ] **Paso 1: usarlo**
  - `DayMeals.tsx`: borra la `cookHref` local e importa la de `@/lib/cookHref`; el enlace «Empezar a cocinar» pasa a `cookHref(first.recipeId, servingsOf(ctx), { menuId: ctx.menuId, day: ctx.day, meal: ctx.meal })`. Al lado, el enlace discreto «¿Otra cosa? Cocinar ahora» a `/cocinar`, **solo** cuando el día mostrado es hoy: `DayMeals` no sabe qué día es hoy, así que `app/menu/page.tsx` le pasa una prop `isToday` (la página ya distingue hoy en la tira de días).
  - `cook/page.tsx`: `const menuContext = useMemo(() => (typeof window === "undefined" ? null : menuContextFromSearch(window.location.search)), [])` y `<CookingShell … menuContext={menuContext} />`. La sincronización de `servings` con la URL ya copia el resto de parámetros.
  - `CookingShell.tsx`: prop `menuContext?: CookMenuContext | null`. En `handleFinish`:

```ts
  const setEaten = useSetSlotEaten()
  function finishExit() {
    if (menuContext) router.push("/menu")
    else handleExit()
  }
  function handleFinish() {
    haptic.medium()
    recordCook.mutate(
      { recipeId: recipe.id, servings, ...(menuContext ? { menuId: menuContext.menuId, dayIndex: menuContext.day, meal: menuContext.meal } : {}) },
      {
        onSuccess: (res) => {
          if (menuContext) setEaten.mutate({ menuId: menuContext.menuId, day: menuContext.day, meal: menuContext.meal, eaten: true })
          if (res.askRating) setRatingOpen(true)
          else finishExit()
        },
        onError: () => finishExit(),
      },
    )
  }
```

  y en el `onDone` de `RatingPromptSheet`, `finishExit()` en lugar de `handleExit()`. El botón de salir (X) sigue con `handleExit` (vuelve a la receta).

- [ ] **Paso 2: tipos y prueba**

Run: `pnpm --filter @ona/web exec tsc --noEmit && pnpm --filter @ona/api exec vitest run src/tests/cookHref.test.ts`
Expected: PASS.

- [ ] **Paso 3: commit**

```bash
git add apps/web/src/components/menu/DayMeals.tsx apps/web/src/app/menu/page.tsx "apps/web/src/app/recipes/[id]/cook/page.tsx" apps/web/src/components/cooking/CookingShell.tsx
git commit -m "feat(cocina): «Terminar» marca «✓ Comido» en la comida del menú de la que viene"
```

### Tarea 18: retirar «match-pantry»

**Ficheros:**
- Modificar: `apps/api/src/routes/recipes.ts:617-632` y su import de `findPantryMatches`, `apps/api/src/services/routeTemplates.ts:162`
- Retirar: `apps/api/src/services/pantryMatcher.ts`, `apps/api/src/tests/pantryMatcher.test.ts`

- [ ] **Paso 1:** borra el handler de `GET /recipes/match-pantry` y el import; quita `'/recipes/match-pantry'` de `routeTemplates.ts`; `git rm` los dos ficheros.

Run: `grep -rn "pantryMatcher\|match-pantry\|findPantryMatches\|scoreRecipeAgainstPantry" apps/ packages/ --include=*.ts --include=*.tsx`
Expected: sin resultados en el código (solo en specs, que se cambian en la tarea 20).

- [ ] **Paso 2: dos pruebas que nombran lo retirado**
  - `apps/api/src/tests/recipeVisibilityCoverage.test.ts`: en `SCOPED_FILES` (hacia la línea 43), cambia `services/pantryMatcher.ts` por `services/cookNow/load.ts`, que también lee `recipes` y tiene que pasar por la visibilidad.
  - `apps/api/src/tests/recipeIdGuard.test.ts`: quita el caso de `/recipes/match-pantry` (hacia la línea 70). Sin esa ruta, la petición cae en `/recipes/:id` y ya no da 401.

- [ ] **Paso 3: tipos y pruebas de la API**

Run: `pnpm --filter @ona/api lint && pnpm --filter @ona/api test`
Expected: PASS entera.

- [ ] **Paso 4: commit**

```bash
git add apps/api/src/routes/recipes.ts apps/api/src/services/routeTemplates.ts apps/api/src/tests/recipeVisibilityCoverage.test.ts apps/api/src/tests/recipeIdGuard.test.ts
git rm apps/api/src/services/pantryMatcher.ts apps/api/src/tests/pantryMatcher.test.ts
git commit -m "chore(recetas): retira /recipes/match-pantry (la tarjeta usa la búsqueda de «Cocinar ahora»)"
```

---

## Fase 5 — Prueba de recorrido, specs y oficina

### Tarea 19: Playwright, el recorrido entero

**Ficheros:**
- Crear: `apps/web/e2e/cook-now.spec.ts`

- [ ] **Paso 1: la prueba**

```ts
// apps/web/e2e/cook-now.spec.ts
/**
 * «Cocinar ahora» (specs/cook-now.md): tab → four questions (editing a
 * pantry quantity) → proposal 1 + 2 → «Cocinar esta» over a planned meal →
 * «Pasarlas a otro día» → cook mode → «Terminar» → /menu shows «Comido».
 * No pinClock: the API decides «now» with the real clock, and the browser
 * has to agree with it.
 */
import { test, expect } from '@playwright/test'
import { addMealWithRecipe, completeOnboarding, registerFreshUser, skipFirstSteps } from './_helpers'

const apiUrl = process.env.API_URL ?? 'http://localhost:8765'

test('cook now: from the questions to «Comido» in the menu', async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const user = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user'))) ?? '{}')
  const headers = { Authorization: `Bearer ${token}` }

  const today = await (await page.request.get(`${apiUrl}/cook-now/today`, { headers })).json()
  // Real limits, not catalogue luck: after both meals are eaten there is no meal of now,
  // and on Sunday there is no day left to move the planned dish to.
  test.skip(today.meal === null || today.day === 6, 'sin comida de ahora o domingo (no hay a dónde mover)')

  // The week, with a recipe planned in the meal of now.
  const gen = await page.request.post(`${apiUrl}/menu/generate`, { headers, data: { userId: user.id, weekStart: today.weekStart } })
  expect(gen.ok()).toBeTruthy()
  let menu = await (await page.request.get(`${apiUrl}/menu/${user.id}/${today.weekStart}`, { headers })).json()
  if (!menu.days[today.day]?.[today.meal]?.dishes?.some((d: any) => d.kind === 'recipe')) {
    await addMealWithRecipe(page, headers, menu, today.day, today.meal)
    menu = await (await page.request.get(`${apiUrl}/menu/${user.id}/${today.weekStart}`, { headers })).json()
  }
  const plannedId: string = menu.days[today.day][today.meal].dishes.find((d: any) => d.kind === 'recipe').recipeId

  // Stock the pantry with every ingredient of every recipe in the week, so «solo lo que hay»
  // has something to propose even with the small CI catalogue.
  const weekRecipeIds = [...new Set<string>(menu.days.flatMap((d: any) => Object.values(d ?? {})).flatMap((s: any) => s?.dishes ?? []).filter((d: any) => d.kind === 'recipe').map((d: any) => d.recipeId))]
  for (const id of weekRecipeIds) {
    const r = await (await page.request.get(`${apiUrl}/recipes/${id}`, { headers })).json()
    for (const ing of r.ingredients ?? []) {
      await page.request.post(`${apiUrl}/pantry`, { headers, data: { name: ing.name ?? ing.ingredientName, ingredientId: ing.ingredientId, quantity: 5000, unit: ing.unit, location: 'nevera' } })
    }
  }
  const probe = await (await page.request.post(`${apiUrl}/cook-now/proposal`, { headers, data: { minutes: null, servings: 2, canBuy: false } })).json()
  expect(probe.items.length, 'con la despensa llena de la semana tiene que salir alguna receta').toBeGreaterThan(0)

  await page.goto('/cocinar')
  await skipFirstSteps(page)
  await page.getByRole('button', { name: /cocinar ahora/i }).click()
  await page.getByRole('button', { name: /1 h o más/i }).click()
  await page.getByRole('button', { name: /seguir/i }).click()
  await page.getByRole('button', { name: /solo lo que hay/i }).click()
  await expect(page.getByRole('heading', { name: /confirma tu despensa/i })).toBeVisible()
  await page.getByRole('button', { name: /^\+/ }).first().click() // edit a quantity: saved at once
  await page.getByRole('button', { name: /proponme una receta/i }).click()

  await expect(page.getByRole('button', { name: /cocinar esta/i })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: /cocinar esta/i }).click()
  await page.getByRole('button', { name: /pasarlas a otro día/i }).click()
  await page.getByRole('button', { name: /mañana/i }).click()

  await page.waitForURL(/\/recipes\/[0-9a-f-]{36}\/cook\?.*menu=/)
  // Walk to the last step and finish («Siguiente» is labelled «Paso siguiente»).
  for (let i = 0; i < 40; i++) {
    if (await page.getByRole('button', { name: /^terminar$/i }).isVisible().catch(() => false)) break
    await page.getByRole('button', { name: /paso siguiente/i }).click()
  }
  await page.getByRole('button', { name: /^terminar$/i }).click()
  const rate = page.getByRole('button', { name: /^bien$/i })
  if (await rate.isVisible({ timeout: 3_000 }).catch(() => false)) await rate.click()

  await page.waitForURL(/\/menu/)
  await expect(page.getByText(/comido/i).first()).toBeVisible({ timeout: 10_000 })
  const after = await (await page.request.get(`${apiUrl}/menu/${user.id}/${today.weekStart}`, { headers })).json()
  expect(after.days[today.day][today.meal].eaten).toBe(true)
  // The dish planned for now moved to tomorrow, same meal.
  expect(after.days[today.day + 1][today.meal].dishes.some((d: any) => d.recipeId === plannedId)).toBe(true)
})

test('/profile/pantry goes to the pantry in «Cocinar»', async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  await page.goto('/profile/pantry')
  await page.waitForURL(/\/cocinar/)
  await expect(page.getByRole('heading', { name: /tu despensa/i })).toBeVisible()
})
```

Ajusta los nombres accesibles a los que hayas puesto en la tarea 16 (los de esta prueba son los del diseño: «Cocinar ahora», «1 h o más», «Seguir», «Solo lo que hay», «Proponme una receta», «Cocinar esta», «Pasarlas a otro día», «Mañana»; el «Siguiente» del modo cocina es «Paso siguiente», como en `rating-prompt.spec.ts`). Añade a `cook-log.spec.ts` un caso corto: «Empezar a cocinar» desde la comida de hoy en `/menu` → «Terminar» → «Comido» en esa comida.

- [ ] **Paso 2: correrla**

Run: `pnpm --filter @ona/web e2e -- e2e/cook-now.spec.ts`
Expected: PASS. Solo se salta los domingos o cuando ya están comidas la comida y la cena (lo dice el motivo del `skip`).

- [ ] **Paso 3: correr las pruebas de navegador que tocan la barra, el menú, la despensa y el modo cocina**

Run: `pnpm --filter @ona/web e2e -- e2e/cook-log.spec.ts e2e/rating-prompt.spec.ts e2e/pantry-locations.spec.ts e2e/floating-buttons.spec.ts e2e/desktop-wide.spec.ts`

`pantry-locations.spec.ts` empieza en `/profile/pantry`: tras la redirección tiene que seguir pasando en `/cocinar#despensa` (ajústala si busca el título antiguo de la página).
Expected: PASS.

- [ ] **Paso 4: commit**

```bash
git add apps/web/e2e/cook-now.spec.ts
git commit -m "test(cocinar): recorrido entero de «Cocinar ahora» en móvil"
```

### Tarea 20: specs y lo que Mimo sabe de Mimoia

**Ficheros:**
- Crear: `specs/cook-now.md` (menos de 200 líneas, desde el punto de vista del usuario, con el formato de las demás: `## User Capabilities`, `## Constraints`, `## Related specs`, `## Source`)
- Modificar: `specs/index.md`, `specs/cook-from-pantry.md`, `specs/pantry.md`, `specs/cook-log.md`, `specs/cooking-mode.md`, `specs/menus.md`, `specs/recipes.md`, `specs/catalog-import.md`, `specs/design-system.md`, `specs/feature-usage.md`, `kb/sobre-mimoia.md`, `docs/superpowers/specs/2026-11-03-cocinar-ahora-design.md`, para que diga lo construido: `GET /cook-now/today`; la respuesta de `choose` (`placed`, `reason`); `requirePantryUse`; `servings` nulo cuando coincide con los comensales del hogar; el tiempo usa `totalTime` o, sin él, preparación + cocción (`recipeTotalMinutes`), y solo sin ninguno de los dos la receta no entra; la oficina escribe con `x-cocina-token` / `COCINA_WRITE_TOKEN` (hasta ahora solo tenía un token de lectura); la frase se cobra al hogar y no a la suma mensual de la persona; los eventos `cook_now_proposed`, `cook_now_chosen` y `meal_cooked.fromMenu`

- [ ] **Paso 1: `specs/cook-now.md`** — la pestaña, las cuatro preguntas, la propuesta, imprescindibles y secundarios (marcado de Cocina, regla automática, sobrevive a ediciones y copias, solo el catálogo), «Cocinar esta», la hoja, «Terminar» con contexto, las rutas, las limitaciones (§6 del diseño), y `## Source` con todos los ficheros nuevos. Fila en `specs/index.md` con palabras clave: cocinar ahora, qué cocino, pestaña Cocinar, despensa confirmada, imprescindible, secundario, sustituto, ingredient roles, x-cocina-token, cook-now.
- [ ] **Paso 2: el resto de specs**, cada una con lo suyo:
  - `cook-from-pantry.md`: la tarjeta vive en `/cocinar` y usa `POST /cook-now/proposal`; `match-pantry` y `pantryMatcher.ts` retirados; `## Source` al día.
  - `pantry.md`: la despensa está en `/cocinar#despensa`; `/profile/pantry` redirige.
  - `cook-log.md` y `cooking-mode.md`: «Terminar» con contexto de menú marca «✓ Comido» y vuelve a `/menu`.
  - `menus.md`: el enlace «¿Otra cosa? Cocinar ahora»; «Cocinar esta» y la hoja «¿Y las…?».
  - `recipes.md` y `catalog-import.md`: `role`, `substitute_ingredient_ids`, la regla, el marcado de Cocina y las tandas JSON (`imprescindible`, `sustitutos`).
  - `design-system.md`: cinco pestañas.
  - `feature-usage.md`: pantalla `cocinar`.
- [ ] **Paso 3: `kb/sobre-mimoia.md`** — un párrafo sobre la pestaña «Cocinar» (para cuando alguien pregunte a Mimo «¿qué hago ahora?»). Sin precios ni planes.
- [ ] **Paso 4: comprobar que ninguna spec nombra ficheros que ya no existen**

Run: `grep -rn "pantryMatcher\|match-pantry\|usePantryMatch\|menu/PantryMatchCard\|profile/pantry/page" specs/ | grep -v "retir"`
Expected: sin resultados.

- [ ] **Paso 5: commit**

```bash
git add specs/ kb/sobre-mimoia.md docs/superpowers/specs/2026-11-03-cocinar-ahora-design.md
git commit -m "docs(specs): «Cocinar ahora» y lo que cambia en despensa, menú, modo cocina y recetas"
```

### Tarea 21: la oficina marca el catálogo (en ona-hq)

**Ficheros (repo `~/ona-hq`):** el charter de Cocina (`departments/cocina/charter.md`), el bucle nocturno donde trabaja Cocina (`loops/`), el formato de las tandas JSON que escribe Cocina y `docs/oficina/estado.md`.

- [ ] **Paso 1: el token.** Genera un secreto (`openssl rand -hex 32`), guárdalo donde la oficina guarda los demás (lo dice ona-hq) y ponlo como `COCINA_WRITE_TOKEN` en el servicio `ona-api` de producción de Railway y en el entorno de la oficina, con el mismo procedimiento que `METRICS_READ_TOKEN` / `MIMOIA_READ_TOKEN`. Si no se puede hacer sin Miguel, apúntalo como tarea suya (`MIG-NN` en `ona-hq/miguel.md`) y dilo en el brief.
- [ ] **Paso 2: la tarea nocturna de Cocina.**
  - Cada noche, `GET /admin/recipes/ingredient-roles/pending?limit=N` con `x-cocina-token`. N se ajusta a la cuota, con 20 de inicio; la primera pasada por el catálogo entero se reparte así en varias noches.
  - Por cada receta, decide cada ingrediente:
    - **Imprescindible:** sin él no es ese plato.
    - **Secundario:** se puede quitar y el plato sigue siendo el mismo.
    - **Sustitutos:** como mucho 2, y solo ingredientes que ya estén en el catálogo.
  - Lo escribe con `PUT /admin/recipes/:id/ingredient-roles`.
  - Lo hace Claude Code de la oficina, **nunca** la clave de la API de producción.
  - Apunta en el diario de Cocina cuántas recetas ha marcado y cuántas quedan.
- [ ] **Paso 3: las tandas.** En el formato de las tandas JSON de Cocina, cada ingrediente lleva `imprescindible: true|false` y, si tiene, `sustitutos: ["leche"]`.
- [ ] **Paso 4: el estado.** Una línea en `docs/oficina/estado.md` y una entrada en `decision_log.md` si la oficina lo pide (es la decisión de Miguel del 2026-11-03: marcar con la cuenta de la oficina, no con la API).
- [ ] **Paso 5: commit en ona-hq**, con el mensaje en español.

---

## Para cerrar

- [ ] `pnpm --filter @ona/api lint && pnpm --filter @ona/api test && pnpm --filter @ona/web exec tsc --noEmit && pnpm --filter @ona/web lint`, todo en verde.
- [ ] Las pruebas de navegador de la tarea 19 en verde.
- [ ] Probado a mano a 390×844 y a 1440×900: barra de cinco, `/cocinar`, preguntas, propuesta, hoja, modo cocina, «✓ Comido», `/profile/pantry` → `/cocinar#despensa`.
- [ ] Comprobado de punta a punta contra la API: `curl` de las cuatro rutas `/cook-now/*` con un usuario de pruebas y lectura del menú después de `choose`.
- [ ] La puerta de specs del `CLAUDE.md` hecha (tarea 20) y la de pruebas (tareas 2–12, 17 y 19).
- [ ] Rama `feat/cocinar-ahora` subida a GitHub con la cuenta `kanedakiTwo` y PR abierto. A producción, solo publicando desde la oficina.
