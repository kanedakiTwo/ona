/**
 * D-1028 · the kitchen manifesto on screen, at 390×844:
 *   - the ficha says the cook's time first («25 min de trabajo · 2 h en
 *     total») and, written in «Editar receta», shows «Y si tienes más
 *     tiempo…» at the end of «Preparación» (form → schema → PUT → ficha);
 *   - /menu sums the week's work: «Esta semana: … de cocina».
 * The 30-minute cap of the draw is `everydayWork.test.ts`.
 */
import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, completeOnboarding, skipFirstSteps } from './_helpers'
import { madridWeekStart } from './_clock'

test.use({ viewport: { width: 390, height: 844 } })

const API = process.env.API_URL ?? 'http://localhost:8765'
const MORE = 'Con garbanzo seco en remojo la víspera y el sofrito a fuego lento 40 minutos, queda más meloso.'

async function auth(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user') ?? '{}').id as string)
  return { headers: { Authorization: `Bearer ${token}` }, userId }
}

async function ingredientId(page: Page, name: string): Promise<string | null> {
  const found = await (await page.request.get(`${API}/ingredients?search=${encodeURIComponent(name)}&perPage=20`)).json()
  return (found as Array<{ id: string; name: string }>).find((i) => i.name === name)?.id ?? null
}

test('the ficha: «min de trabajo» first and «Y si tienes más tiempo…» written in the editor', async ({ page }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  const { headers } = await auth(page)
  const cebolla = await ingredientId(page, 'cebolla')
  expect(cebolla, 'Catalog has no exact "cebolla" — seed missing or renamed.').toBeTruthy()

  const created = await page.request.post(`${API}/recipes`, {
    headers,
    data: {
      name: 'E2E guiso con poco trabajo',
      servings: 2,
      meals: ['lunch'],
      seasons: ['winter'],
      prepTime: 25,
      cookTime: 95,
      activeTime: 25,
      ingredients: [{ ingredientId: cebolla, quantity: 150, unit: 'g' }],
      steps: [{ index: 0, text: 'Pocha la cebolla y deja que se haga sola a fuego lento.', ingredientRefs: [] }],
      force: true,
    },
  })
  expect(created.status()).toBe(201)
  const id = (await created.json()).id as string

  await page.goto(`/recipes/${id}/edit`)
  await expect(page.locator('#recipe-steps')).toHaveValue(/Pocha la cebolla/, { timeout: 15_000 })
  const box = page.getByTestId('recipe-more-time-input')
  await expect(box).toHaveValue('')
  await box.fill(MORE)
  const save = page.getByRole('button', { name: /^guardar cambios$/i })
  await expect(save).toBeEnabled({ timeout: 15_000 })
  const [put] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes(`/recipes/${id}`), { timeout: 30_000 }),
    save.click(),
  ])
  expect(put.status()).toBe(200)
  await page.waitForURL(new RegExp(`/recipes/${id}$`), { timeout: 30_000 })

  // The eyebrow: the cook's time first, then the total.
  await expect(page.getByTestId('recipe-eyebrow')).toContainText(/25 min de trabajo · 2 h en total/i, { timeout: 15_000 })

  // «Preparación»: the section at the end, after the steps.
  await page.getByRole('tab', { name: /^pasos/i }).first().click()
  const more = page.getByTestId('recipe-more-time')
  await expect(more).toBeVisible()
  await expect(more.getByRole('heading', { name: 'Y si tienes más tiempo…' })).toBeVisible()
  await expect(more).toContainText(MORE)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)

  // Saved as written, and a recipe without it shows nothing.
  const saved = await (await page.request.get(`${API}/recipes/${id}`, { headers })).json()
  expect(saved.moreTime).toBe(MORE)
})

test('/menu: «Esta semana: … de cocina» sums the work of the week', async ({ page }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  await skipFirstSteps(page)
  const { headers, userId } = await auth(page)
  const weekStart = madridWeekStart()
  const gen = await page.request.post(`${API}/menu/generate`, { headers, data: { userId, weekStart, force: true } })
  expect(gen.ok(), `generate: ${gen.status()}`).toBeTruthy()

  // What the line must say: the hydrated dishes' work (activeTime, else prepTime), tápers out.
  const menu = await (await page.request.get(`${API}/menu/${userId}/${weekStart}`, { headers })).json()
  const skipped = new Set<number>(menu.skippedDays ?? [])
  let minutes = 0
  ;(menu.days as Array<Record<string, { dishes?: Array<Record<string, any>> }>>).forEach((day, d) => {
    if (skipped.has(d)) return
    for (const slot of Object.values(day ?? {})) {
      for (const dish of slot?.dishes ?? []) {
        if (dish.kind !== 'recipe' || dish.leftoverOf) continue
        const m = dish.activeTime > 0 ? dish.activeTime : dish.prepTime > 0 ? dish.prepTime : 0
        minutes += m
      }
    }
  })
  expect(minutes, 'the seeded week has dishes with times').toBeGreaterThan(0)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  const label = h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`

  await page.goto('/menu')
  await expect(page.getByRole('navigation', { name: 'Días de la semana' })).toBeVisible({ timeout: 20_000 })
  const line = page.getByTestId('menu-week-cooking')
  await expect(line).toBeVisible({ timeout: 20_000 })
  await expect(line).toHaveText(`Esta semana: ${label} de cocina`)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
})
