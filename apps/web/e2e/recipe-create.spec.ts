/**
 * Flow: create a new recipe end-to-end through /recipes/new.
 *
 * This spec exists because in May 2026 the "Crear receta" button shipped
 * silently broken (missing `servings` + wrong `steps` shape vs the server
 * schema) and the form swallowed the validation errors. No test caught
 * it. This spec covers the happy path so the same class of bug fails CI
 * on the next push.
 *
 * If the test DB has no ingredients seeded, the test soft-skips after
 * asserting the page rendered — the contract is "form is usable", not
 * "seed is correct" (that's another spec's job).
 *
 * Units PR 3 (display vs canonical) test-gate notes:
 *   The two specs at the bottom of this file ("display unit selector: …"
 *   and "scaling: …") cover Tasks 3.1, 3.2 and 3.4 of the units design
 *   (hook, picker UI, IngredientsSection rendering). apps/web has no
 *   vitest config so behavioral assertions live here.
 *
 *   TODO(test): the Estimado-badge round-trip (Task 3.3) is NOT covered
 *   yet. Asserting `servingsConfidence === 'estimated'` round-trips and
 *   that the badge flips off when the user edits the servings input
 *   requires a photo-extraction fixture (or a mocked extractor that lets
 *   us seed a recipe with confidence='estimated'). Land alongside the
 *   PR 4 backfill / extractor work.
 */

import { test, expect } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.beforeEach(async ({ page }) => {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
})

test('happy path: fill the form, click Crear, land on the new recipe', async ({ page }) => {
  await page.goto('/recipes/new')
  await expect(page).toHaveURL(/\/recipes\/new/)

  // Name
  await page.locator('input[placeholder*="Tortilla" i]').fill('E2E receta de prueba')

  // Servings — defaults to 2; leave as-is to also verify the default path.

  // Prep time
  await page.locator('input[placeholder="30"]').fill('20')

  // Meals: pick "Comida" (lunch) — there are buttons with the meal labels.
  await page.getByRole('button', { name: /comida/i }).first().click()

  // Seasons: pick "Primavera"
  await page.getByRole('button', { name: /primavera/i }).first().click()

  // Ingredient: type into the autocomplete and pick the option that
  // matches what we typed. We have to wait for the debounced search
  // (200ms) to refresh the dropdown — clicking the literal first <li>
  // would pick whatever the empty-query fetch returned first (e.g.
  // "aceite de oliva virgen" alphabetically), which causes the server's
  // lint to fire ORPHAN_INGREDIENT + STEP_INGREDIENT_NOT_LISTED later.
  const ingredientInput = page.getByPlaceholder(/ingrediente|cargando/i).first()
  await ingredientInput.fill('ajo')
  const ajoOption = page
    .locator('ul[role="listbox"] li button', { hasText: /^ajo$/i })
    .first()
  try {
    await ajoOption.waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    test.skip(true, 'Catalog has no exact "ajo" match — seed missing or renamed.')
    return
  }
  await ajoOption.click()

  // Quantity for that ingredient
  await page.locator('input[placeholder="Cant."]').first().fill('10')

  // Step
  await page.locator('textarea').first().fill('Pelar y picar el ajo')

  // Submit
  const submit = page.getByRole('button', { name: /^crear receta$/i })
  await expect(submit).toBeEnabled()

  await Promise.all([
    page.waitForURL(/\/recipes\/[0-9a-f-]{36}/, { timeout: 15_000 }),
    submit.click(),
  ])

  // On the detail page, the name we typed should be visible.
  await expect(page.getByText('E2E receta de prueba').first()).toBeVisible({
    timeout: 10_000,
  })
})

test('validation: empty form surfaces specific field errors instead of silent failure', async ({ page }) => {
  await page.goto('/recipes/new')

  const submit = page.getByRole('button', { name: /^crear receta$/i })
  // Button must be clickable even with an incomplete form — silent disabled
  // buttons are the bug class this spec defends against.
  await expect(submit).toBeEnabled()
  await submit.click()

  // The form should render an error banner listing missing fields.
  await expect(page.getByText(/faltan datos/i)).toBeVisible({ timeout: 5_000 })
  // At minimum, "name" should be flagged since it's empty.
  await expect(page.locator('text=name').first()).toBeVisible()
})

// ─── Units PR 3 coverage ──────────────────────────────────────────────
//
// The two specs below fill in the test gate that Tasks 3.1–3.4 of the
// "units: display vs canonical" feature deferred to here. They exercise:
//
//   1. The display-unit picker on /recipes/new (Tasks 3.1 + 3.2):
//      typing "cda" with quantity 1 fires POST /units/resolve, the canonical
//      select goes disabled at the resolved unit, and the persisted recipe
//      carries both the abstract pair (displayQuantity=1, displayUnit='cda')
//      and a canonical (g|ml) ≈ 15 — exact value depends on whether the
//      chosen ingredient has a density in the catalog (oils do).
//
//   2. The IngredientsSection renderer (Task 3.4): a 1-cda recipe at
//      servings=2, scaled to 3 (factor=1.5), shows "1 1/2 cda" as primary
//      with the scaled canonical (~21 g for olive oil, ~22 ml for a
//      densityless liquid) as secondary.
//
// Both tests reuse `createAceiteRecipe` which encapsulates the form flow;
// if the catalog has no exact "aceite de oliva virgen" match the helper
// soft-skips the surrounding test rather than failing CI.

/**
 * Create a "1 cda de aceite de oliva virgen" recipe through the form.
 * Returns the new recipe's id (extracted from the URL after navigation)
 * plus the canonical (quantity, unit) the API resolved to — callers use
 * the latter to calibrate scaling assertions (oil has density 0.91 so the
 * canonical is grams, not ml).
 */
async function createAceiteRecipe(
  page: import('@playwright/test').Page,
): Promise<{ recipeId: string; canonicalQuantity: number; canonicalUnit: string } | null> {
  await page.goto('/recipes/new')

  await page.locator('input[placeholder*="Tortilla" i]').fill('E2E cda aceite')
  await page.getByRole('button', { name: /comida/i }).first().click()
  await page.getByRole('button', { name: /primavera/i }).first().click()

  // Pick the ingredient first.
  const ingredientInput = page.getByPlaceholder(/ingrediente|cargando/i).first()
  await ingredientInput.fill('aceite de oliva')
  const aceiteOption = page
    .locator('ul[role="listbox"] li button', { hasText: /^aceite de oliva virgen$/i })
    .first()
  try {
    await aceiteOption.waitFor({ state: 'visible', timeout: 10_000 })
  } catch {
    return null
  }
  await aceiteOption.click()

  // Quantity = 1.
  await page.locator('input[placeholder="Cant."]').first().fill('1')

  // Display unit = "cda". Wait for the POST /units/resolve round-trip
  // before moving on — the request fires on blur, and we need its result
  // (canonical unit + quantity) to assert against the persisted recipe.
  const displayInput = page.getByLabel('Unidad de medida').first()
  await displayInput.fill('cda')
  const [resolveResp] = await Promise.all([
    page.waitForResponse(
      (r) =>
        /\/units\/resolve\b/.test(r.url()) &&
        r.request().method() === 'POST' &&
        r.request().postDataJSON()?.displayUnit === 'cda',
      { timeout: 8_000 },
    ),
    displayInput.blur(),
  ])
  const resolved = (await resolveResp.json()) as { canonicalQuantity: number; canonicalUnit: string }

  // After resolution the canonical select should be disabled (the form
  // disables it to communicate that the abstract unit owns the value).
  await expect(page.locator('select').first()).toBeDisabled({ timeout: 4_000 })

  // One step.
  await page.locator('textarea').first().fill('Calentar el aceite')

  // Submit and capture the POST /recipes response so we can pull the id
  // without parsing the post-navigation URL (which Next.js sometimes
  // rewrites in transit).
  const submit = page.getByRole('button', { name: /^crear receta$/i })
  await expect(submit).toBeEnabled()
  const [createResp] = await Promise.all([
    page.waitForResponse(
      (r) => /\/recipes(\?|$)/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 15_000 },
    ),
    submit.click(),
  ])
  expect(createResp.status()).toBe(201)
  const created = (await createResp.json()) as { id?: string }
  if (!created.id) throw new Error('POST /recipes returned no id')

  // Wait until the detail page has navigated so subsequent tests can
  // start interacting immediately.
  await page.waitForURL((url) => url.pathname.endsWith(`/recipes/${created.id}`), {
    timeout: 15_000,
  })

  return {
    recipeId: created.id,
    canonicalQuantity: resolved.canonicalQuantity,
    canonicalUnit: resolved.canonicalUnit,
  }
}

test('display unit selector: picking "cda" with quantity 1 stores canonical ~15 ml/g on the server', async ({ page }) => {
  const created = await createAceiteRecipe(page)
  if (!created) {
    test.skip(true, 'Catalog has no "aceite de oliva virgen" — seed missing.')
    return
  }
  const { recipeId, canonicalQuantity, canonicalUnit } = created

  // The detail page already issued its own GET; intercepting in arrears is
  // racy. Fetch it directly via the page's auth context instead.
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  expect(token).toBeTruthy()
  const apiUrl = process.env.API_URL ?? 'http://localhost:8765'
  const detailResp = await page.request.get(`${apiUrl}/recipes/${recipeId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  expect(detailResp.status()).toBe(200)
  const detail = (await detailResp.json()) as {
    ingredients: Array<{
      displayQuantity?: number | null
      displayUnit?: string | null
      quantity: number
      unit: string
    }>
  }

  const row = detail.ingredients.find((i) => i.displayUnit === 'cda')
  expect(row, 'expected an ingredient row with displayUnit="cda"').toBeDefined()
  if (!row) return

  // Abstract pair round-trips verbatim.
  expect(row.displayQuantity).toBe(1)
  expect(row.displayUnit).toBe('cda')

  // Canonical: 1 cda = 15 ml; if the chosen ingredient has a density set
  // (aceite de oliva has 0.91), the resolver converts to grams.  We accept
  // either path and assert the magnitude is in the right neighbourhood —
  // the exact value depends on seed densities and round1.
  expect(['g', 'ml']).toContain(row.unit)
  expect(row.unit).toBe(canonicalUnit) // resolve + persist agree
  expect(row.quantity).toBeCloseTo(canonicalQuantity, 1)
  expect(row.quantity).toBeGreaterThanOrEqual(13)
  expect(row.quantity).toBeLessThanOrEqual(16)
})

test('scaling: a 1-cda recipe at 1.5x renders as "1 1/2 cda" with canonical secondary', async ({ page }) => {
  const created = await createAceiteRecipe(page)
  if (!created) {
    test.skip(true, 'Catalog has no "aceite de oliva virgen" — seed missing.')
    return
  }

  // Bump scaler to 3 (factor = 1.5 against the recipe's servings=2 baseline).
  //
  // Why two clicks: completeOnboarding() in _helpers.ts sets
  // householdSize='solo', which householdToDinersOrNull maps to 1 diner,
  // so the detail page seeds servings=1 (userDiners ?? recipe.servings ?? 2).
  // The recipe was created with servings=2 (form default), so we need to
  // click + twice to reach 3: 1 → 2 → 3. The component triggers a refetch
  // on each step via useRecipe(id, n).
  const incButton = page.getByRole('button', { name: /aumentar comensales/i })
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/recipes/${created.recipeId}`) && r.url().includes('servings=2'),
      { timeout: 10_000 },
    ),
    incButton.click(),
  ])
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes(`/recipes/${created.recipeId}`) && r.url().includes('servings=3'),
      { timeout: 10_000 },
    ),
    incButton.click(),
  ])

  // Primary: "1 1/2 cda". formatFraction(1.5) → "1 1/2" verbatim (verified
  // against packages/shared/src/units/format.ts: FRACTION_LABELS maps 0.5
  // to "1/2" and the wholepart prefix is space-separated).
  await expect(page.getByText(/\b1\s+1\/2\s+cda\b/).first()).toBeVisible({
    timeout: 8_000,
  })

  // Secondary: scaled canonical with magnitude-aware rounding.
  //   Oil (density 0.91): 13.7 g × 1.5 = 20.55 → API bandStep=1 → 21
  //     → formatCanonical(21, 'g') → "21 g".
  //   Densityless liquid: 15 ml × 1.5 = 22.5 → API bandStep=1 → 23 (or 22)
  //     → formatCanonical → "22 ml" / "23 ml".
  // Accept the whole window so the assertion isn't coupled to a single
  // ingredient choice.
  await expect(
    page.getByText(/\b(20|21|22|23)\s*(g|ml)\b/).first(),
  ).toBeVisible({ timeout: 4_000 })
})
