/**
 * «Semana tipo» fase 4 (D-182 §4): «¿Algo más? Cuéntanos tu caso» gives
 * examples of habits, the AI reads them into the household's week type and
 * «Así lo he entendido» shows them before the first menu, with «Está bien»
 * and «Corregir» (back to the text, the slots as they were). The AI is
 * simulated at the onboarding answer: the route writes the slot through the
 * real week-type route, as the analysis would, and answers what it wrote.
 * At 390×844.
 */
import { test, expect, type Page } from '@playwright/test'
import { answerShopper, registerFreshUser } from './_helpers'

test.use({ viewport: { width: 390, height: 844 } })

const API = process.env.API_URL ?? 'http://localhost:8765'
const PIZZA = { options: [{ kind: 'type', type: 'pizza' }] }

/** Screenshots for the review, only when E2E_SHOTS points at a folder. */
async function shot(page: Page, name: string) {
  if (process.env.E2E_SHOTS) await page.screenshot({ path: `${process.env.E2E_SHOTS}/${name}.png` })
}

async function fridayDinner(page: Page): Promise<Record<string, unknown>> {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  const res = await page.request.get(`${API}/households/me/week-type`, { headers: { Authorization: `Bearer ${token}` } })
  return (await res.json()).days[4].dinner
}

test('«tu caso» → «Así lo he entendido» → Corregir → Está bien → menu', async ({ page }) => {
  test.setTimeout(120_000)
  await registerFreshUser(page)
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))

  // The simulated AI: three slots written through the real route, as the analysis would.
  const notes: string[] = []
  await page.route(/\/user\/[0-9a-f-]{36}\/onboarding$/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    notes.push(JSON.parse(route.request().postData() ?? '{}').cookingNote ?? '')
    const real = await route.fetch()
    const user = await real.json()
    const put = (path: string, data: unknown) => page.request.put(`${API}/households/me/week-type/${path}`, { headers: { Authorization: `Bearer ${token}` }, data })
    await put('4/dinner', PIZZA)
    await put('5/lunch', { options: [{ kind: 'type', type: 'legumbres' }, { kind: 'any' }] })
    await put('5/dinner', { off: true })
    await route.fulfill({
      response: real,
      json: {
        ...user,
        weekTypeUnderstood: {
          rows: [
            { icon: 'pizza', what: 'Pizza', when: 'Viernes · cena · cada semana' },
            { icon: 'legumbres', what: 'Legumbres', when: 'Sábado · comida · cada 2 semanas' },
            { icon: 'off', what: 'No hay', when: 'Sábado · cena' },
          ],
          undo: [
            { day: 4, meal: 'dinner', slot: {} },
            { day: 5, meal: 'lunch', slot: {} },
            { day: 5, meal: 'dinner', slot: {} },
          ],
        },
      },
    })
  })

  await page.goto('/onboarding')
  const web = page.getByRole('button', { name: /prefiero la web/i })
  const household = page.getByRole('heading', { name: /para cuántos cocinas/i })
  await expect(web.or(household)).toBeVisible({ timeout: 15_000 })
  if (await web.isVisible()) await web.click()

  const next = page.getByRole('button', { name: /siguiente/i })
  await next.click()
  await answerShopper(page)
  await page.getByRole('button', { name: /^cocino cada día/i }).click()
  await next.click()

  // The help text: habits with a day and a meal, no preset options.
  const note = page.getByLabel(/algo más\? cuéntanos tu caso/i)
  await expect(note).toHaveAttribute('placeholder', /pasta los miércoles.*pescado una semana sí y otra no.*el domingo por la noche, sándwich mixto/)
  await page.getByRole('button', { name: /^rápido/i }).click()
  await shot(page, '0-ayuda')
  await note.fill('los jueves por la noche, pizza')
  await shot(page, '1-texto')
  await next.click()
  await page.getByRole('button', { name: /empezar/i }).click()

  // «Así lo he entendido»: one row per slot.
  const understood = page.getByTestId('onboarding-understood')
  await expect(understood.getByRole('heading', { name: /así lo he entendido/i })).toBeVisible({ timeout: 20_000 })
  const rows = understood.getByTestId('understood-row')
  await expect(rows).toHaveCount(3)
  await expect(rows.first()).toContainText('Pizza')
  await expect(rows.first()).toContainText('Viernes · cena · cada semana')
  // Stroke icons, as in Perfil → Tu semana tipo: no emoji.
  await expect(rows.first().locator('svg')).toHaveCount(1)
  expect(await understood.textContent()).not.toMatch(/\p{Extended_Pictographic}/u)
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
  await shot(page, '2-entendido')

  // «Corregir»: the slot goes back as it was and the text opens again.
  const undo = page.waitForRequest((r) => r.method() === 'PUT' && /\/households\/me\/week-type\/4\/dinner$/.test(r.url()))
  await understood.getByRole('button', { name: 'Corregir' }).click()
  expect(JSON.parse((await undo).postData() ?? 'null')).toEqual({})
  await expect(note).toBeVisible()
  await expect(note).toHaveValue('los jueves por la noche, pizza')
  await expect.poll(() => fridayDinner(page)).toEqual({})

  await note.fill('los viernes por la noche, pizza')
  await next.click()
  await page.getByRole('button', { name: /empezar/i }).click()
  await expect(understood.getByRole('heading', { name: /así lo he entendido/i })).toBeVisible({ timeout: 20_000 })
  expect(notes).toEqual(['los jueves por la noche, pizza', 'los viernes por la noche, pizza'])

  // «Está bien»: the first menu, with the week type kept.
  const generate = page.waitForRequest((r) => r.method() === 'POST' && /\/menu\/generate$/.test(r.url()))
  await understood.getByRole('button', { name: 'Está bien' }).click()
  await generate
  await expect(page).toHaveURL(/\/menu/, { timeout: 60_000 })
  expect((await fridayDinner(page)).options).toEqual(PIZZA.options)
  await shot(page, '3-menu')
})
