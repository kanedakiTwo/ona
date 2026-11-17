/**
 * PRO-1259: saving «Editar receta» used to wipe what the form doesn't show —
 * the trucos (`tips`), the course, and the ingredients under each step
 * (`ingredientRefs`: the rows got new ids). Now the GET gives the editor the
 * texts and the row ids, the form sends them back and the PUT keeps what
 * it leaves out. At 390×844, a recipe made through the API with linked
 * steps and a truco: change one step's text, save, and nothing is lost.
 */
import { test, expect, type Page } from '@playwright/test'
import { registerFreshUser, completeOnboarding } from './_helpers'

test.use({ viewport: { width: 390, height: 844 } })

const API = process.env.API_URL ?? 'http://localhost:8765'
const TIP = 'Sala la cebolla al principio para que sude.'

async function headers(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  return { Authorization: `Bearer ${token}` }
}

async function ingredientId(page: Page, name: string): Promise<string | null> {
  const found = await (await page.request.get(`${API}/ingredients?search=${encodeURIComponent(name)}&perPage=20`)).json()
  return (found as Array<{ id: string; name: string }>).find((i) => i.name === name)?.id ?? null
}

test('editing a step keeps the ingredients under each step and the truco', async ({ page }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)

  const auth = await headers(page)
  const [ajo, cebolla] = [await ingredientId(page, 'ajo'), await ingredientId(page, 'cebolla')]
  expect(ajo && cebolla, 'Catalog has no exact "ajo" / "cebolla" — seed missing or renamed.').toBeTruthy()

  const A = crypto.randomUUID()
  const B = crypto.randomUUID()
  const created = await page.request.post(`${API}/recipes`, {
    headers: auth,
    data: {
      name: 'E2E sofrito que no pierde nada',
      servings: 2,
      meals: ['lunch'],
      seasons: ['winter'],
      course: 'main',
      tips: TIP,
      ingredients: [
        { id: A, ingredientId: ajo, quantity: 10, unit: 'g' },
        { id: B, ingredientId: cebolla, quantity: 150, unit: 'g' },
      ],
      steps: [
        { index: 0, text: 'Pica el ajo y la cebolla.', ingredientRefs: [A, B] },
        { index: 1, text: 'Sofríe la cebolla a fuego lento.', ingredientRefs: [B] },
      ],
      force: true,
    },
  })
  expect(created.status()).toBe(201)
  const id = (await created.json()).id as string

  await page.goto(`/recipes/${id}/edit`)
  // The steps box (PRO-1115): the saved steps, numbered.
  const stepsBox = page.locator('#recipe-steps')
  await expect(stepsBox).toHaveValue('1. Pica el ajo y la cebolla.\n2. Sofríe la cebolla a fuego lento.', { timeout: 15_000 })
  // The truco is in the notes list and the course in its select.
  await expect
    .poll(() => page.locator('textarea').evaluateAll((els) => els.map((e) => (e as HTMLTextAreaElement).value)))
    .toContain(TIP)
  await expect(page.locator('#recipe-course')).toHaveValue('main')

  await stepsBox.fill('1. Pica muy fino el ajo y la cebolla.\n2. Sofríe la cebolla a fuego lento.')
  await expect(page.getByTestId('step-line').first()).toContainText('Pica muy fino')
  const save = page.getByRole('button', { name: /^guardar cambios$/i })
  await expect(save).toBeEnabled({ timeout: 15_000 })
  const [put] = await Promise.all([
    page.waitForResponse((r) => r.request().method() === 'PUT' && r.url().includes(`/recipes/${id}`), { timeout: 30_000 }),
    save.click(),
  ])
  expect(put.status()).toBe(200)
  await page.waitForURL(new RegExp(`/recipes/${id}$`), { timeout: 30_000 })

  // The detail (tabs on a phone): each step with its ingredients, and the truco.
  await page.getByRole('tab', { name: /^pasos/i }).or(page.getByRole('button', { name: /^pasos/i })).first().click()
  const firstStep = page.locator('li', { hasText: 'Pica muy fino el ajo y la cebolla.' }).first()
  await expect(firstStep).toBeVisible({ timeout: 15_000 })
  await expect(firstStep).toContainText(/ajo\s*·/i)
  await expect(firstStep).toContainText(/cebolla\s*·/i)
  const secondStep = page.locator('li', { hasText: 'Sofríe la cebolla a fuego lento.' }).first()
  await expect(secondStep).toContainText(/cebolla\s*·/i)
  await page.getByRole('tab', { name: /^notas$/i }).or(page.getByRole('button', { name: /^notas$/i })).first().click()
  await expect(page.getByText(TIP).first()).toBeVisible()

  // And the API: same rows, same links, the truco still in `tips`, the course kept.
  const saved = await (await page.request.get(`${API}/recipes/${id}`, { headers: auth })).json()
  expect(saved.steps.map((s: { ingredientRefs: string[] }) => s.ingredientRefs)).toEqual([[A, B], [B]])
  expect(saved.tips).toBe(TIP)
  expect(saved.course).toBe('main')
})
