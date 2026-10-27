/**
 * PRO-271 (Seguridad; hogares de prueba 2026-10-19/20): Víctor, alérgico al
 * marisco, entered a household by invitation without a single question and
 * his first menu had «Arroz tres delicias» with shrimp. Now:
 *   - accepting the invitation opens «Tus alergias y tu dieta» (with the
 *     health-data box) before the menu;
 *   - what he says is in the household's menu: no recipe with crustaceans;
 *   - «Generar mi menú» warns when someone hasn't answered, and not once
 *     the person said «ninguna».
 * 390×844.
 */
import { test, expect, type Page } from '@playwright/test'
import { e2eInvite, registerFreshUser, completeOnboarding, skipFirstSteps, skipTasteOffer, submitRegisterForm, freshCreds, uniqueId } from './_helpers'
import { madridMondayIn } from './_clock'

const API = process.env.API_URL ?? 'http://localhost:8765'

test.use({ viewport: { width: 390, height: 844 } })

/** Monday `weeks` weeks from now, in Madrid (the runner is UTC on CI). */
const mondayIn = (weeks: number) => madridMondayIn(weeks)

async function session(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

function recipeIds(menu: { days?: Array<Record<string, { dishes?: Array<{ kind: string; recipeId?: string }> } | undefined>> }): string[] {
  const out: string[] = []
  for (const day of menu.days ?? []) {
    for (const slot of Object.values(day ?? {})) for (const d of slot?.dishes ?? []) if (d.kind === 'recipe' && d.recipeId) out.push(d.recipeId)
  }
  return out
}

test('invitación → alergias y dieta → menú de la casa sin marisco', async ({ browser }) => {
  test.setTimeout(150_000)

  // The household: its owner, onboarded without saying allergies, with a
  // shrimp recipe of their own (the CI catalogue has no shellfish).
  const ownerCtx = await browser.newContext()
  const id = uniqueId().replace(/-/g, '')
  const ownerName = `casa${id}`.slice(0, 30)
  const reg = await ownerCtx.request.post(`${API}/register`, {
    data: { username: ownerName, email: `${ownerName}@test.local`, password: 'e2epass123', ageConfirmed: true, ...e2eInvite() },
  })
  expect(reg.status()).toBe(201)
  const { token: ownerToken, user: owner } = await reg.json()
  const ownerHeaders = { Authorization: `Bearer ${ownerToken}` }
  const onb = await ownerCtx.request.post(`${API}/user/${owner.id}/onboarding`, {
    headers: ownerHeaders,
    data: { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'healthy' },
  })
  expect(onb.ok(), `onboarding: ${onb.status()}`).toBeTruthy()
  const gamba = await ownerCtx.request.post(`${API}/ingredients/auto-create`, { headers: ownerHeaders, data: { name: 'gambas peladas' } })
  expect(gamba.ok(), `ingredient: ${gamba.status()}`).toBeTruthy()
  const gambaId = (await gamba.json()).ingredient.id as string
  const arroz = await ownerCtx.request.post(`${API}/recipes`, {
    headers: ownerHeaders,
    data: {
      name: 'Arroz tres delicias de prueba',
      servings: 2,
      meals: ['lunch', 'dinner'],
      equipment: ['sartén'],
      seasons: ['spring', 'summer', 'autumn', 'winter'],
      ingredients: [{ ingredientId: gambaId, quantity: 125, unit: 'g' }],
      steps: [{ index: 0, text: 'Saltea las gambas peladas a fuego vivo.' }],
      force: true,
    },
  })
  expect(arroz.status(), `recipe: ${await arroz.text()}`).toBe(201)
  const shrimpRecipeId = (await arroz.json()).id as string
  const inv = await ownerCtx.request.post(`${API}/households/me/invites`, { headers: ownerHeaders, data: { role: 'member' } })
  expect(inv.status()).toBe(201)
  const { token: inviteToken } = await inv.json()

  // Víctor, in his own phone: the link, a new account, accept.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const page = await ctx.newPage()
  await page.goto(`/invites/${inviteToken}`)
  await page.getByRole('button', { name: 'Crear cuenta y aceptar' }).click()
  await page.waitForURL(/\/register/)
  await Promise.all([page.waitForURL(/\/invites\//, { timeout: 20_000 }), submitRegisterForm(page, freshCreds())])
  await page.getByRole('button', { name: 'Aceptar invitación' }).click()

  // The new screen, before the menu.
  await page.waitForURL(/\/profile\/casa\/alergias/, { timeout: 15_000 })
  const screen = page.getByTestId('household-allergies')
  await expect(page.getByRole('heading', { name: /Tus alergias y tu dieta/ })).toBeVisible()
  await expect(screen.getByRole('button', { name: 'marisco', exact: true })).toBeDisabled()
  await expect(screen.getByRole('button', { name: 'Ahora no' })).toBeVisible()
  await screen.getByRole('checkbox', { name: 'Consiento que Mimoia trate mis datos de salud' }).check()
  await screen.getByRole('button', { name: 'marisco', exact: true }).click()
  await screen.getByRole('button', { name: 'Guardar y ver el menú' }).click()
  await page.waitForURL((u) => u.pathname === '/menu', { timeout: 20_000 })
  // Guides that would cover the screen in any spec not about them.
  await skipFirstSteps(page)
  await skipTasteOffer(page)

  const { headers, userId } = await session(page)
  const me = await (await page.request.get(`${API}/user/${userId}`, { headers })).json()
  expect(me.restrictions).toEqual(['marisco'])

  // A blank week: he answered, the owner didn't → names the owner, no button for him.
  const weekStart = mondayIn(1)
  await page.goto(`/menu?week=${weekStart}`)
  await expect(page.getByRole('button', { name: 'Generar mi menú' })).toBeVisible({ timeout: 20_000 })
  const notice = page.getByTestId('household-allergies-notice')
  await expect(notice).toContainText(`${ownerName} aún no nos ha dicho sus alergias ni su dieta`)
  await expect(notice.getByRole('link', { name: 'Decir mis alergias' })).toHaveCount(0)

  // The shrimp recipe is the household's: he can open it (so the menu could pick it).
  expect((await page.request.get(`${API}/recipes/${shrimpRecipeId}`, { headers })).status()).toBe(200)

  // «Generar mi menú»: no shrimp in his week…
  const [generated] = await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/menu/generate') && r.request().method() === 'POST' && !r.request().postDataJSON()?.empty, { timeout: 60_000 }),
    page.getByRole('button', { name: 'Generar mi menú' }).click(),
  ])
  expect(generated.status()).toBe(201)
  const week = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  expect(recipeIds(week).length).toBeGreaterThan(0)
  expect(recipeIds(week)).not.toContain(shrimpRecipeId)

  // …nor when the owner generates the household's week.
  const ownerWeek = mondayIn(2)
  const gen = await ownerCtx.request.post(`${API}/menu/generate`, { headers: ownerHeaders, data: { userId: owner.id, weekStart: ownerWeek } })
  expect(gen.status()).toBe(201)
  expect(recipeIds(await gen.json())).not.toContain(shrimpRecipeId)

  await ctx.close()
  await ownerCtx.close()
})

test('«Generar mi menú» warns until the person answers, also «ninguna»', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await completeOnboarding(page) // no health-data box: hasn't answered
  const weekStart = mondayIn(3)
  await page.goto(`/menu?week=${weekStart}`)
  await expect(page.getByRole('button', { name: 'Generar mi menú' })).toBeVisible({ timeout: 20_000 })
  const notice = page.getByTestId('household-allergies-notice')
  await expect(notice).toContainText('No sabemos tus alergias ni tu dieta.')

  await notice.getByRole('link', { name: 'Decir mis alergias' }).click()
  await page.waitForURL(/\/profile\/casa\/alergias\?next=/)
  const screen = page.getByTestId('household-allergies')
  await screen.getByRole('checkbox', { name: 'Consiento que Mimoia trate mis datos de salud' }).check()
  await screen.getByRole('button', { name: 'No tengo ninguna, ver el menú' }).click()
  await page.waitForURL((u) => u.pathname === '/menu', { timeout: 15_000 })

  await page.goto(`/menu?week=${weekStart}`)
  await expect(page.getByRole('button', { name: 'Generar mi menú' })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('week-plan-questions')).toBeVisible()
  await expect(page.getByTestId('household-allergies-notice')).toHaveCount(0)
})

test('«No tengo ninguna» sin el consentimiento; el texto con erratas se entiende o se pregunta (PRO-347)', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  const { headers, userId } = await session(page)

  // Without ticking the box: «No tengo ninguna» is there and /menu stops asking.
  await page.goto('/profile/casa/alergias?next=/menu')
  const screen = page.getByTestId('household-allergies')
  await expect(screen.getByRole('button', { name: 'Ahora no' })).toBeVisible()
  await screen.getByRole('button', { name: 'No tengo ninguna, ver el menú' }).click()
  await page.waitForURL((u) => u.pathname === '/menu', { timeout: 15_000 })
  const status = await (await page.request.get(`${API}/households/me/allergies`, { headers })).json()
  expect(status.meAnswered).toBe(true)
  const consent = await (await page.request.get(`${API}/user/${userId}/health-consent`, { headers })).json()
  expect(consent.active).toBe(false)

  // From the profile, with the box: gibberish is asked, not saved…
  await page.goto('/profile/casa/alergias?next=/profile')
  await screen.getByRole('checkbox', { name: 'Consiento que Mimoia trate mis datos de salud' }).check()
  const box = screen.getByPlaceholder('Otra: escríbela (p. ej. pimiento)')
  await box.fill('lo de siempre xd')
  await screen.getByRole('button', { name: 'Guardar' }).click()
  await expect(page.getByTestId('household-allergies-unclear')).toContainText('No hemos entendido «lo de siempre xd»')
  await expect(box).toHaveValue('')
  await expect(page).toHaveURL(/\/profile\/casa\/alergias/)

  // …and typos are read: «sin glutn» is saved as «sin gluten».
  await box.fill('sin glutn')
  await screen.getByRole('button', { name: 'Guardar' }).click()
  await page.waitForURL((u) => u.pathname === '/profile', { timeout: 15_000 })
  const me = await (await page.request.get(`${API}/user/${userId}`, { headers })).json()
  expect(me.restrictions).toEqual(['sin gluten'])
})
