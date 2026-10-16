/**
 * «Afina tu menú» (PRO-146, specs/taste.md) at 390×844:
 *  - sign-up: 10 cards with the buttons before choosing the channel; the
 *    first «No para mí» asks «¿Qué es lo que no?» (an ingredient → dislikes),
 *    the third «¿Es otra cosa?» «no tengo horno» → equipment (rules: no
 *    Anthropic key in e2e); after 3 «No para mí» to meat no more meat; the
 *    first menu leaves the «No para mí» recipes out;
 *  - «Saltar» goes straight on to the questions;
 *  - an account onboarded without it sees «Novedad» once and, after
 *    «Ahora no», the card above the menu until its own «Ahora no»;
 *  - /afinar: dragging a card right is «Me apetece».
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const API_URL = process.env.API_URL ?? 'http://localhost:8765'

async function auth(page: Page) {
  const token = await page.evaluate(() => localStorage.getItem('ona_token'))
  return { Authorization: `Bearer ${token}` }
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
})

test('sign-up: 10 cards with buttons, then the questions; the first menu has no «No para mí»', async ({ page }) => {
  test.setTimeout(150_000)
  await registerFreshUser(page, { keepTaste: true })

  // Every card the API hands out, with its protein group.
  const protein = new Map<string, string | null>()
  page.on('response', async (res) => {
    if (!res.url().includes('/taste/next')) return
    try {
      for (const c of (await res.json()).cards ?? []) protein.set(c.name, c.protein)
    } catch {}
  })
  const generated: string[] = []
  page.on('response', async (res) => {
    if (res.request().method() === 'POST' && res.url().endsWith('/menu/generate')) {
      try {
        generated.push(await res.text())
      } catch {}
    }
  })

  await page.goto('/onboarding')
  await expect(page.getByRole('heading', { name: /dime qué te apetece/i })).toBeVisible({ timeout: 20_000 })
  await expect(page.getByRole('button', { name: 'Saltar' })).toBeVisible()
  await page.getByRole('button', { name: 'Empezar' }).click()

  const card = page.getByTestId('taste-card')
  const counter = page.getByTestId('taste-counter')
  let pickedIngredient = ''
  let meatNopes = 0
  let nopes = 0
  for (let i = 1; i <= 10; i++) {
    await expect(counter).toHaveText(`${i} de 10`, { timeout: 15_000 })
    const name = (await card.getByRole('heading').textContent())!.trim()
    const group = protein.get(name) ?? null
    if (meatNopes >= 3) expect(group, `${name} after 3 «No para mí» to meat`).not.toBe('carne')
    if (group === 'carne' && meatNopes < 3) {
      await page.getByRole('button', { name: 'No para mí' }).click()
      meatNopes++
      nopes++
      if (nopes === 1) {
        await expect(page.getByRole('heading', { name: '¿Qué es lo que no?' })).toBeVisible()
        const chip = page.getByRole('button', { name: /^No me gusta / }).first()
        pickedIngredient = ((await chip.textContent()) ?? '').replace(/^No me gusta (el|la|los|las) /, '').trim()
        await chip.click()
      } else if (nopes === 3) {
        await expect(page.getByRole('heading', { name: '¿Qué es lo que no?' })).toBeVisible()
        await page.getByLabel('¿Es otra cosa? Cuéntamelo').fill('no tengo horno')
        await page.getByRole('button', { name: 'Enviar' }).click()
      }
    } else {
      await page.getByRole('button', { name: i % 3 === 0 ? 'Me encanta' : 'Me apetece' }).click()
    }
  }
  expect(meatNopes).toBe(3)

  // Then the usual sign-up: channel choice (when WhatsApp is on) or the first question.
  const web = page.getByRole('button', { name: /prefiero la web/i })
  const firstQuestion = page.getByRole('heading', { name: /para cuántos cocinas/i })
  await expect(web.or(firstQuestion)).toBeVisible({ timeout: 15_000 })
  if (await web.isVisible()) await web.click()
  await expect(firstQuestion).toBeVisible()
  await expect(page.getByText('Primeros pasos · 1 de 4')).toBeVisible()

  const headers = await auth(page)
  const memory = await (await page.request.get(`${API_URL}/memory`, { headers })).json()
  expect(pickedIngredient).not.toBe('')
  expect(memory.dislikes.value).toContain(pickedIngredient)
  expect(memory.equipment.value).not.toContain('horno')
  const verdicts = (await (await page.request.get(`${API_URL}/taste/verdicts`, { headers })).json()).verdicts as Array<{ recipeId: string; verdict: string }>
  expect(verdicts).toHaveLength(10)
  const nopeIds = verdicts.filter((v) => v.verdict === 'nope').map((v) => v.recipeId)
  expect(nopeIds).toHaveLength(3)
  // Flagged for the profile («¿No coméis carne?»).
  expect((await (await page.request.get(`${API_URL}/taste/status`, { headers })).json()).flags).toEqual(['carne'])

  const next = page.getByRole('button', { name: /siguiente/i })
  await next.click()
  await page.getByRole('button', { name: /3-4 veces/i }).click()
  await next.click()
  await next.click() // no restrictions
  await page.getByRole('button', { name: /salud/i }).click()
  await page.getByRole('button', { name: /empezar/i }).click()
  await expect(page).toHaveURL(/\/menu/, { timeout: 45_000 })

  expect(generated.length).toBeGreaterThan(0)
  for (const body of generated) for (const id of nopeIds) expect(body).not.toContain(id)
  // Done in the sign-up: no «Novedad» on the menu.
  await expect(page.getByTestId('taste-intro')).toHaveCount(0)
})

test('«Saltar» in the sign-up goes straight on to the questions', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page, { keepTaste: true })
  await page.goto('/onboarding')
  await expect(page.getByRole('heading', { name: /dime qué te apetece/i })).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Saltar' }).click()
  const web = page.getByRole('button', { name: /prefiero la web/i })
  const firstQuestion = page.getByRole('heading', { name: /para cuántos cocinas/i })
  await expect(web.or(firstQuestion)).toBeVisible({ timeout: 15_000 })
  // Shown once: a reload doesn't bring it back.
  await page.reload()
  await expect(web.or(firstQuestion)).toBeVisible({ timeout: 15_000 })
})

test('an account onboarded without it: «Novedad» once, then the card until «Ahora no»', async ({ page }) => {
  test.setTimeout(90_000)
  await registerFreshUser(page, { keepTaste: true })
  await completeOnboarding(page, { keepTaste: true })

  const intro = page.getByTestId('taste-intro')
  await expect(intro).toBeVisible({ timeout: 20_000 })
  await expect(intro.getByRole('heading', { name: /afina tu menú en un minuto/i })).toBeVisible()
  await intro.getByRole('button', { name: 'Ahora no' }).click()
  await expect(intro).toHaveCount(0)

  const offer = page.getByTestId('taste-card-offer')
  await expect(offer).toBeVisible({ timeout: 15_000 })
  await page.reload()
  await expect(offer).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('taste-intro')).toHaveCount(0)
  await offer.getByRole('button', { name: 'Ahora no' }).click()
  await expect(offer).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('taste-card-offer')).toHaveCount(0)
})

test('/afinar: dragging the card to the right is «Me apetece»', async ({ page }) => {
  test.setTimeout(60_000)
  await registerFreshUser(page)
  await completeOnboarding(page)
  await page.goto('/afinar')
  await page.getByRole('button', { name: 'Empezar' }).click()
  const card = page.getByTestId('taste-card')
  await expect(card).toBeVisible({ timeout: 15_000 })
  const first = (await card.getByRole('heading').textContent())!.trim()
  const box = (await card.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 })
  await expect(page.getByText('ME APETECE')).toHaveCSS('opacity', /^(0\.[3-9]\d*|1)$/)
  await page.mouse.move(box.x + box.width / 2 + 180, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()
  await expect(card.getByRole('heading')).not.toHaveText(first, { timeout: 10_000 })

  await page.getByRole('button', { name: 'Ya está por hoy' }).click()
  await expect(page.getByRole('heading', { name: /tu menú ya te conoce un poco más/i })).toBeVisible()
  await expect(page.getByText(first)).toBeVisible()

  const verdicts = (await (await page.request.get(`${API_URL}/taste/verdicts`, { headers: await auth(page) })).json()).verdicts
  expect(verdicts).toEqual([expect.objectContaining({ name: first, verdict: 'like' })])
})
