# Curator Dashboard

A single read-mostly page at `/curator` that exposes every catalog gap a human curator needs to close: ingredients without USDA mapping, missing density/unitWeight, the "otros" aisle bucket, allergen tag suggestions, recipes with incomplete nutrition, and the latest LLM regen output. Each row offers an action that fixes the gap inline (or via the same auto-create modal recipe authors see).

## Why this exists

The catalog accumulates "soft debt" as users auto-create ingredients, the photo extractor falls back to stub rows (`fdcId: NULL`), and the LLM regen pipeline drops recipes into JSONL files that nobody reads. Without a single surface that lists this debt, the curator has to write SQL or grep through `regen-failed.jsonl` to find the next thing to fix. The dashboard is that surface.

It is intentionally small: **7 sections, no charts, no destructive operations**. Every action calls an existing endpoint (or one of two new PATCH endpoints in `routes/curator.ts`).

## User Capabilities

- Curator visits `/curator` while logged in and sees a four-tile counts header (ingredients sin USDA, recetas con kcal=0, alérgenos sugeridos, archivos en regen).
- A horizontal pill bar tabs between seven gap sections; clicking a tile jumps to the matching tab.
- **Ingredientes sin USDA** — every ingredient with `fdcId IS NULL`. "Mapear" opens a modal showing the USDA candidates for that name (same plumbing as auto-create) and applying re-fetches per-100 g nutrition + writes back to the row. The row disappears from the list on success.
- **Pasillo «otros»** — every ingredient with `aisle === 'otros'` or `aisle IS NULL`. Inline `<select>` with the seven aisle labels; PATCH on change.
- **Sin densidad** — ingredients whose name matches one of the density-relevant keywords (aceite, leche, nata, vinagre, caldo, salsa, sirope, crema, jarabe, miel) and have `density IS NULL`. Inline numeric input + Guardar button.
- **Sin peso por unidad** — `aisle === 'produce'` AND `unitWeight IS NULL` AND not a bulk leafy item (espinaca, lechuga, perejil…). Inline numeric input.
- **Alérgenos sugeridos** — rows where `inferAllergenTagsFromName(name)` produces tags not currently present. Shows current vs sugerido side-by-side; "Aceptar" replaces `allergenTags` with the suggested set.
- **Recetas con kcal=0** — every recipe whose `nutritionPerServing.kcal` is `null`/`0`, plus how many of its ingredients are missing `fdcId` (the bottleneck). Recipe name links to its detail page; the curator fixes the upstream ingredients first, then re-saves the recipe to recompute.
- **Output de regen** — collapsible list parsed from `apps/api/scripts/output/regen-failed.jsonl` and `regen-skipped.jsonl`. Each entry shows the recipe name, source (failed / skipped), and up to 6 lint errors with their `code` + `message`.
- A discreet "Panel de curaduría →" link at the bottom of `/profile` is the only entry point — the dashboard is not advertised in the bottom navbar.

## API

### `GET /curator/ingredient-gaps` (auth)

Single round-trip — reads the entire `ingredients` table once, applies in-memory heuristics, returns five buckets:

```ts
{
  missingFdcId:        Array<{ id, name, aisle, allergenTags }>,
  missingDensity:      Array<{ id, name, aisle }>,
  missingUnitWeight:   Array<{ id, name, aisle }>,
  aisleOtros:          Array<{ id, name }>,
  allergenSuggestions: Array<{ id, name, currentTags, suggestedTags }>,
}
```

### `GET /curator/recipe-gaps` (auth)

Loads every recipe + the ingredient links for those whose `nutritionPerServing.kcal` is falsy. Returns:

```ts
{
  missingNutrition:   Array<{ id, name, kcal, missingIngredientIds: string[] }>,
  missingTotalTime:   Array<{ id, name }>,
  missingEquipment:   Array<{ id, name }>,
  missingDifficulty:  Array<{ id, name, difficulty }>,
}
```

`missingDifficulty` lists every recipe still at the schema default (`'medium'`) — the curator audits them and re-saves with the right value.

### `GET /curator/regen-output` (auth)

Reads JSONL files from `process.env.REGEN_OUTPUT_DIR` (defaults to `apps/api/scripts/output/`). Returns `[]` quietly if the files don't exist or a line fails to parse. Output:

```ts
Array<{
  source: 'failed' | 'skipped',
  recipeName: string,
  errors: Array<{ code, message, path }>,
  warnings: Array<{ code, message, path }>,
}>
```

### `PATCH /ingredients/:id` (auth)

Whitelisted partial update. Accepts `aisle`, `density`, `unitWeight`, `allergenTags` only — `name`, `fdcId`, raw nutrition fields all reject. Returns the updated row.

### `PATCH /ingredients/:id/remap` (auth)

Body: `{ fdcId: number }`. Re-fetches USDA per-100 g for the new `fdcId` and writes `calories/protein/carbs/fat/fiber/salt` + the new `fdcId` back. Used by the "Re-mapear a USDA" modal. Maps USDA 429 to a 429 response.

## Constraints

- Every row offers a fix; no read-only sections. If we can't act on a gap, we don't surface it.
- The remap modal reuses the auto-create modal's UX patterns (USDA candidates, Foundation > SR Legacy > FNDDS ranking, default-pick) but writes to an existing row instead of creating one.
- The recipe nutrition gap surfaces the upstream ingredient bottleneck — fixing the ingredient first, then re-saving the recipe, is the canonical flow. The dashboard doesn't try to recompute recipe nutrition itself.
- Heuristics are intentionally opinionated. `BULK_PRODUCE_KEYWORDS` skips leafy/loose items from "Sin peso por unidad"; `DENSITY_KEYWORDS` only flags liquids. False negatives are preferred over false positives — the curator can edit any row directly via PUT `/ingredients/:id` if a heuristic missed it.
- No new dependencies. Spanish copy throughout. Editorial design system tokens (cream `#FAF6EE`, ink `#1A1612`, terracotta `#C65D38`, parchment `#FFFEFA`, border `#DDD6C5`).
- The dashboard is auth-protected via `useAuth`; any authenticated user can access. There is no per-role gating today — this is a single-curator product.

## Related specs

- [Ingredient Auto-Create](./ingredient-auto-create.md) — the modal's USDA flow + `inferAllergenTagsFromName`
- [Nutrition](./nutrition.md) — per-100 g shape + USDA client
- [Recipe Quality](./recipe-quality.md) — the lint validator that produces `regen-failed.jsonl`
- [Recipes](./recipes.md) — recipe save flow re-runs nutrition aggregation when ingredients change

## Source

- [apps/api/src/routes/curator.ts](../apps/api/src/routes/curator.ts) — read endpoints + PATCH `/ingredients/:id`, PATCH `/ingredients/:id/remap`
- [apps/api/src/services/nutrition/allergens.ts](../apps/api/src/services/nutrition/allergens.ts) — `inferAllergenTagsFromName`
- [apps/api/src/services/nutrition/usdaClient.ts](../apps/api/src/services/nutrition/usdaClient.ts) — `fetchByFdcId` for the remap path
- [apps/web/src/app/curator/page.tsx](../apps/web/src/app/curator/page.tsx) — dashboard page (counts, tabs, sections, remap modal)
- [apps/web/src/hooks/useCurator.ts](../apps/web/src/hooks/useCurator.ts) — react-query hooks
- [apps/web/src/app/profile/page.tsx](../apps/web/src/app/profile/page.tsx) — discreet entry link
