/**
 * PRO-318 — «Tu ficha» at 390×844 (iPhone 14).
 *
 *   1. A real household against the API: the «Hogar nuevo» screen, then the
 *      whole ficha once it knows a few things (written like Perfil does,
 *      `PATCH /memory`): chips per person, «¿Por qué lo sé?», «Corregir»,
 *      «Olvidar» (and «Cancelar» back), a person without an account (the API's
 *      422 for a minor's name shown as it comes, edit, remove), «Pausar lo
 *      que aprendo de ti», «Descargar mi ficha», «Lo que ha cambiado», the
 *      Perfil card in place of «Memoria». No sideways scroll anywhere.
 *   2. What only the nightly refiner writes (portrait, a question, deduced
 *      facts, Mimo's changes) can't be created through the API, so the view is
 *      simulated: answer the question, «Así es», another member's fact
 *      (read only), the reader's health («Solo lo ves tú»), «Deshacer».
 *   3. A `child` member (403): no card in Perfil, the API's message on the page.
 *   4. The pure helpers of `src/lib/ficha.ts`.
 */
import { test, expect, type Page, type Route } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'
import {
  dayLabel,
  forgetTitle,
  longDate,
  madridDay,
  shortDate,
  groupChangesByDay,
  isNewHousehold,
  portraitOpening,
  toPerson,
  updatedLabel,
  visibleQuestion,
} from '../src/lib/ficha'

test.use({ viewport: { width: 390, height: 844 } })

const API = process.env.API_URL ?? 'http://localhost:8765'

async function session(page: Page): Promise<{ token: string; userId: string }> {
  const token = (await page.evaluate(() => localStorage.getItem('ona_token')))!
  const userId = JSON.parse((await page.evaluate(() => localStorage.getItem('ona_user')))!).id as string
  return { token, userId }
}

async function signUp(page: Page) {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
  return session(page)
}

async function noSideScroll(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390)
}

const chip = (page: Page, name: string) => page.getByTestId('ficha-people').getByRole('button', { name, exact: true })
const sheet = (page: Page) => page.getByRole('dialog')
/** Sheets slide out while the next one slides in: wait until only one is left. */
const oneSheet = (page: Page) => expect(page.getByRole('dialog')).toHaveCount(1)

test('a household from new to known: why, correct, forget, people, pause, export and history', async ({ page }) => {
  test.setTimeout(150_000)
  const { token } = await signUp(page)

  // Perfil: «Tu ficha» first, «Memoria» gone.
  await page.goto('/profile')
  const card = page.getByTestId('profile-ficha')
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card).toContainText('Todavía os conozco poco')
  await expect(page.getByRole('link', { name: /^memoria/i })).toHaveCount(0)
  await card.click()
  await expect(page).toHaveURL(/\/profile\/ficha$/)

  // A new household: the short screen, no chips.
  await expect(page.getByRole('heading', { level: 1, name: 'Así veo tu casa' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('ficha-new')).toContainText('Todavía os conozco poco')
  await expect(page.getByRole('link', { name: /afina tu menú/i })).toHaveAttribute('href', '/afinar')
  await expect(page.getByTestId('ficha-people')).toHaveCount(0)
  await expect(page.getByTestId('ficha-how')).toContainText('Puedes corregir u olvidar cualquier cosa')
  await noSideScroll(page)

  // What the household says (Perfil's own write): the ficha fills up.
  const res = await page.request.patch(`${API}/memory`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      facts: [
        { key: 'dislikes', value: ['cilantro'] },
        { key: 'equipment', value: ['horno', 'olla exprés'] },
        { key: 'weekly_budget_eur', value: 80 },
        { key: 'notes', value: ['Los viernes cenamos pizza'] },
        { key: 'cooking_skill', value: 'medium' },
        { key: 'nutrition_principles', value: ['Aceite de oliva siempre'] },
        { key: 'meal_times', value: { lunch: '14:00', dinner: '21:00' } },
        { key: 'region', value: 'MD' },
        { key: 'household.adults', value: 2 },
      ],
    },
  })
  expect(res.ok()).toBe(true)
  await page.reload()

  await expect(chip(page, 'La casa')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })
  await expect(page.getByTestId('ficha-new')).toContainText('Todavía os conozco poco') // still no portrait
  await expect(page.getByRole('heading', { name: 'En la cocina' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tiempo y compra' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Salud' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /añadir algo que deba saber/i })).toBeVisible()
  await noSideScroll(page)

  // «¿Por qué lo sé?» on something the reader said: no «Así es», only Corregir / Olvidar.
  await page.getByRole('button', { name: /^Tenéis horno y olla exprés/ }).click()
  await oneSheet(page)
  await expect(sheet(page)).toContainText('¿Por qué lo sé?')
  await expect(sheet(page).getByRole('heading', { name: 'Tenéis horno y olla exprés' })).toBeVisible()
  await expect(sheet(page)).toContainText('Lo dijiste tú')
  await expect(sheet(page)).toContainText('Cómo lo uso')
  await expect(sheet(page)).toContainText('El menú solo te propone recetas que puedes hacer con lo que tenéis.')
  await expect(sheet(page).getByRole('button', { name: 'Así es' })).toHaveCount(0)
  await noSideScroll(page)

  // «Corregir»: their words, «Siempre» or «Hasta una fecha».
  await sheet(page).getByRole('button', { name: 'Corregir' }).click()
  await oneSheet(page)
  await expect(sheet(page)).toContainText('Corregir')
  const save = sheet(page).getByRole('button', { name: 'Guardar' })
  await expect(save).toBeDisabled()
  await sheet(page).getByRole('textbox', { name: '¿Cómo es en realidad?' }).fill('Solo tenemos olla exprés, el horno no funciona')
  await sheet(page).getByRole('radio', { name: 'Hasta una fecha' }).check()
  await expect(sheet(page).getByLabel('Hasta qué fecha')).toBeVisible()
  await expect(save).toBeDisabled()
  await sheet(page).getByRole('radio', { name: 'Siempre' }).check()
  await expect(sheet(page).getByLabel('Hasta qué fecha')).toHaveCount(0)
  const corrected = page.waitForResponse((r) => r.request().method() === 'POST' && /\/household\/profile\/facts\/[^/]+\/correct$/.test(r.url()))
  await save.click()
  const correctRes = await corrected
  expect(correctRes.ok()).toBe(true)
  expect(correctRes.request().postDataJSON()).toEqual({ text: 'Solo tenemos olla exprés, el horno no funciona', validUntil: null })
  await expect(sheet(page)).toHaveCount(0)
  await expect(page.getByRole('button', { name: /^Tenéis horno y olla exprés/ })).toHaveCount(0)
  if ((await correctRes.json()).kind === 'note') {
    // Without the AI (no key in CI) the words stay as a note, theirs.
    await expect(page.getByTestId('ficha-toast')).toContainText('Lo he apuntado con tus palabras')
    await expect(page.getByRole('heading', { name: 'Otras notas' })).toBeVisible()
    await expect(page.getByRole('button', { name: /^Solo tenemos olla exprés, el horno no funciona/ })).toBeVisible()
  }

  // «Olvidar»: «Cancelar» goes back to «¿Por qué lo sé?», «Olvidar» retires it.
  await page.getByRole('button', { name: /^Presupuesto: 80 € a la semana/ }).click()
  await oneSheet(page)
  await sheet(page).getByRole('button', { name: 'Olvidar' }).click()
  await oneSheet(page)
  await expect(sheet(page).getByRole('heading', { name: '¿Olvido «Presupuesto: 80 € a la semana»?' })).toBeVisible()
  await expect(sheet(page)).toContainText('te lo preguntaré antes de apuntarlo otra vez')
  await sheet(page).getByRole('button', { name: 'Cancelar' }).click()
  await oneSheet(page)
  await expect(sheet(page)).toContainText('¿Por qué lo sé?')
  await sheet(page).getByRole('button', { name: 'Olvidar' }).click()
  await oneSheet(page)
  const forgotten = page.waitForResponse((r) => r.request().method() === 'DELETE' && /\/household\/profile\/facts\/[^/]+$/.test(r.url()))
  await sheet(page).getByRole('button', { name: 'Olvidar' }).click()
  expect((await forgotten).status()).toBe(204)
  await expect(page.getByTestId('ficha-toast')).toContainText('Olvidado.')
  await expect(page.getByRole('button', { name: /^Presupuesto: 80 €/ })).toHaveCount(0)

  // A person without an account: a minor's name is refused with the API's own words.
  await page.getByRole('button', { name: 'Añadir una persona de la casa' }).click()
  await oneSheet(page)
  await expect(sheet(page)).toContainText('Añadir una persona de la casa')
  await sheet(page).getByRole('textbox', { name: 'Apodo' }).fill('Lucía')
  await sheet(page).getByRole('radio', { name: '6–12 años' }).check()
  await sheet(page).getByRole('button', { name: 'Guardar' }).click()
  await expect(sheet(page).getByRole('alert')).toHaveText(
    'Para un menor solo se guarda un alias genérico («la pequeña», «hijo 2»), nunca su nombre',
  )
  await sheet(page).getByRole('textbox', { name: 'Apodo' }).fill('la pequeña')
  await sheet(page).getByRole('button', { name: 'Guardar' }).click()
  await expect(sheet(page)).toHaveCount(0)
  await expect(chip(page, 'La pequeña')).toHaveAttribute('aria-pressed', 'true')
  const person = page.getByTestId('ficha-person')
  await expect(person).toContainText('De 6 a 12 años · sin cuenta en Mimoia')
  await expect(page.getByText('Nunca su nombre.')).toBeVisible()
  await noSideScroll(page)

  await person.getByRole('button', { name: 'Editar' }).click()
  await oneSheet(page)
  await sheet(page).getByRole('radio', { name: '3–5 años' }).check()
  await sheet(page).getByRole('button', { name: 'Guardar' }).click()
  await expect(person).toContainText('De 3 a 5 años · sin cuenta en Mimoia')

  await page.getByRole('button', { name: 'Quitar de la casa' }).click()
  await oneSheet(page)
  await expect(sheet(page).getByRole('heading', { name: '¿Quitar a la pequeña de la casa?' })).toBeVisible()
  await sheet(page).getByRole('button', { name: 'Quitar de la casa' }).click()
  await expect(chip(page, 'La pequeña')).toHaveCount(0)
  await expect(chip(page, 'La casa')).toHaveAttribute('aria-pressed', 'true')

  // «Pausar lo que aprendo de ti» → the reader's own part, on the switch.
  await page.getByRole('button', { name: 'Pausar lo que aprendo de ti' }).click()
  await expect(chip(page, 'Tú')).toHaveAttribute('aria-pressed', 'true')
  const learning = page.getByRole('switch', { name: 'Aprender de lo que hago' })
  await expect(learning).toBeFocused()
  await expect(learning).toHaveAttribute('aria-checked', 'true')
  const paused = page.waitForResponse((r) => r.request().method() === 'PUT' && /\/household\/profile\/learning$/.test(r.url()))
  await learning.click()
  expect((await paused).request().postDataJSON()).toEqual({ paused: true })
  await expect(learning).toHaveAttribute('aria-checked', 'false')

  // The reader's part: their facts, their beliefs, the old editors, the export.
  await expect(page.getByRole('button', { name: /^No te gusta cilantro/ })).toBeVisible()
  await expect(page.getByRole('link', { name: /Tus principios: Aceite de oliva siempre/ })).toHaveAttribute('href', '/profile/creencias')
  await expect(page.getByRole('link', { name: 'Editar mis datos uno a uno' })).toHaveAttribute('href', '/profile/memoria')
  await noSideScroll(page)
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar mi ficha' }).click()
  expect((await download).suggestedFilename()).toMatch(/^mi-ficha-mimoia-\d{4}-\d{2}-\d{2}\.json$/)

  // Paused survives a reload; «La casa» now offers to resume.
  await page.reload()
  await expect(page.getByRole('button', { name: 'Reanudar lo que aprendo de ti' })).toBeVisible({ timeout: 15_000 })
  await chip(page, 'Tú').click()
  await expect(page.getByRole('switch', { name: 'Aprender de lo que hago' })).toHaveAttribute('aria-checked', 'false')

  // «Lo que ha cambiado»: today's changes, nothing of Mimo's to undo, the export.
  await page.goto('/profile/ficha/historial')
  await expect(page.getByRole('heading', { level: 1, name: 'Lo que ha cambiado' })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('heading', { name: dayLabel(new Date()) })).toBeVisible()
  await expect(page.getByTestId('ficha-change').filter({ hasText: 'Olvidaste' }).filter({ hasText: 'Presupuesto: 80 € a la semana' })).toBeVisible()
  await expect(page.getByRole('button', { name: /^Deshacer/ })).toHaveCount(0)
  const download2 = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar', exact: true }).click()
  expect((await download2).suggestedFilename()).toMatch(/^mi-ficha-mimoia-.*\.json$/)
  await noSideScroll(page)
})

/* ───────────── what only the nightly refiner writes: simulated ───────────── */

const ago = (ms: number) => new Date(Date.now() - ms).toISOString()
const DAY = 86_400_000

function view(viewerId: string) {
  const fact = (id: string, subjectKey: string, topic: string, sentence: string, extra: Record<string, unknown> = {}) => ({
    id, subjectKey, type: 'affinity', topic, sentence, origin: 'deducido', originLabel: 'Lo he deducido',
    temporary: false, validUntil: null, health: false, canEdit: true, updatedAt: ago(DAY), ...extra,
  })
  return {
    householdId: 'h1',
    portrait: {
      text: 'En tu casa se come de cuchara y sin prisas el fin de semana, y rápido entre semana. Los domingos cocinas por tandas.\n\nOs gustan las legumbres.',
      updatedAt: ago(2 * 3600_000),
    },
    people: [
      { key: 'casa', kind: 'household', label: 'La casa', ageBand: null, isViewer: false, canEdit: false },
      { key: `u:${viewerId}`, kind: 'user', label: 'Tú', ageBand: null, isViewer: true, canEdit: false },
      { key: 'u:marta', kind: 'user', label: 'Marta', ageBand: null, isViewer: false, canEdit: false },
      { key: 'p:peque', kind: 'person', label: 'El pequeño', ageBand: '6-12', isViewer: false, canEdit: true },
    ],
    facts: [
      fact('f1', 'casa', 'como_comeis', 'Los jueves cenáis algo rápido', { type: 'effort' }),
      fact('f2', 'u:marta', 'gustos', 'Le encanta la cuchara', { canEdit: false }),
      fact('f3', `u:${viewerId}`, 'salud', 'Sin lactosa', { type: 'restrictions', health: true, origin: 'tu', originLabel: 'Lo dijiste tú' }),
      fact('f4', `u:${viewerId}`, 'salud', 'Edad: 42 años', { type: 'physical.age', health: true, origin: 'tu', originLabel: 'Lo dijiste tú' }),
    ],
    question: { id: 'q1', question: '¿Seguís sin horno?', subjectKey: 'casa', factId: null },
    recent: [{ id: 'c1', factId: 'f1', at: ago(DAY / 2), action: 'added', verb: 'He apuntado', sentence: 'Los jueves cenáis algo rápido', byMimo: true, canUndo: true }],
    learningPaused: false,
    readOnly: false,
  }
}

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

test('portrait, the question, what Mimo deduced, another member and the reader’s health (simulated API)', async ({ page }) => {
  test.setTimeout(90_000)
  const { userId } = await signUp(page)
  const calls: Array<{ method: string; path: string; body: unknown }> = []
  const changeAt = ago(3 * DAY)
  const since = madridDay(new Date(Date.now() - 5 * DAY))

  await page.route(/\/household\/profile(\/.*)?(\?.*)?$/, async (route) => {
    const req = route.request()
    const path = new URL(req.url()).pathname
    if (req.method() !== 'GET') calls.push({ method: req.method(), path, body: req.postDataJSON() })
    if (path === '/household/profile') return json(route, view(userId))
    const why = path.match(/^\/household\/profile\/facts\/(f\d)\/why$/)
    if (why) {
      const f = view(userId).facts.find((x) => x.id === why[1])!
      return json(route, {
        fact: f,
        confidence: f.origin === 'deducido' ? 'Bastante seguro' : null,
        since,
        evidence: [
          { date: since, text: 'Cambiaste la cena del jueves: lasaña de verduras por tortilla francesa.' },
          { date: madridDay(new Date(Date.now() - 12 * DAY)), text: 'Me pediste por WhatsApp «algo rápido para esta noche», un jueves.' },
        ],
        howIUse: 'Mimo lo tiene en cuenta cuando habla contigo y cuando te propone cambios.',
      })
    }
    if (path.startsWith('/household/profile/changes') && req.method() === 'GET') {
      return json(route, [
        { id: 'c9', factId: 'f1', at: changeAt, action: 'added', verb: 'He apuntado', sentence: 'Los jueves cenáis algo rápido', byMimo: true, canUndo: true },
      ])
    }
    return json(route, { ok: true })
  })

  // Perfil: the portrait's opening, what it knows, the question waiting.
  await page.goto('/profile')
  const card = page.getByTestId('profile-ficha')
  await expect(card).toContainText('«En tu casa se come de cuchara y sin prisas el fin de semana, y rápido entre semana…»', { timeout: 15_000 })
  await expect(card).toContainText('4 cosas que sé')
  await expect(card).toContainText('1 pregunta para ti')
  await card.click()

  // The portrait and the question.
  await expect(page.getByTestId('ficha-portrait')).toContainText('Os gustan las legumbres.', { timeout: 15_000 })
  await expect(page.getByTestId('ficha-portrait')).toContainText('Lo escribo cada noche con lo que pasa en casa. Actualizado')
  const question = page.getByTestId('ficha-question')
  await expect(question.getByRole('heading', { name: '¿Seguís sin horno?' })).toBeVisible()
  await expect(question.getByRole('button', { name: 'Ahora no' })).toBeVisible()
  await question.getByRole('button', { name: 'Sí', exact: true }).click()
  await expect(page.getByTestId('ficha-toast')).toContainText('Gracias, lo apunto.')
  expect(calls).toContainEqual({ method: 'POST', path: '/household/profile/questions/q1', body: { answer: 'yes' } })

  // «Lo último que he aprendido» opens the deduced fact: «Así es» confirms it.
  const recent = page.getByRole('region', { name: 'Lo último que he aprendido' })
  await expect(recent).toContainText('Lo he deducido')
  await expect(recent.getByRole('link', { name: 'Ver todo lo que ha cambiado' })).toHaveAttribute('href', '/profile/ficha/historial')
  await recent.getByRole('button', { name: /Los jueves cenáis algo rápido/ }).click()
  await oneSheet(page)
  await expect(sheet(page)).toContainText(`Bastante seguro · desde el ${longDate(since)}`)
  await expect(sheet(page)).toContainText(shortDate(since))
  await expect(sheet(page)).toContainText('Lo que he visto')
  await sheet(page).getByRole('button', { name: 'Así es' }).click()
  await expect(page.getByTestId('ficha-toast')).toContainText('Gracias, lo dejo apuntado.')
  expect(calls).toContainEqual({ method: 'POST', path: '/household/profile/facts/f1/confirm', body: null })
  await noSideScroll(page)

  // Health is only in the reader's part, under «Solo lo ves tú»; body data links to Perfil.
  await expect(page.getByText('Sin lactosa')).toHaveCount(0)
  await chip(page, 'Tú').click()
  const health = page.getByRole('region', { name: 'Salud' })
  await expect(health).toContainText('Solo lo ves tú')
  await expect(health.getByRole('button', { name: /^Sin lactosa/ })).toBeVisible()
  await expect(health.getByText('Edad: 42 años')).toHaveCount(0)
  await expect(health.getByRole('link', { name: /Datos físicos/ })).toHaveAttribute('href', '/profile#datos-fisicos')

  // Another member's fact: readable, changed only by them.
  await chip(page, 'Marta').click()
  await page.getByRole('button', { name: /^Le encanta la cuchara/ }).click()
  await oneSheet(page)
  await expect(sheet(page)).toContainText('Esto lo cambia Marta desde su ficha.')
  await expect(sheet(page).getByRole('button', { name: /^(Así es|Corregir|Olvidar)$/ })).toHaveCount(0)
  await page.keyboard.press('Escape')
  await expect(sheet(page)).toHaveCount(0)

  // «Añadir algo que deba saber» opens Mimo with the message started.
  await chip(page, 'La casa').click()
  await page.getByRole('button', { name: /añadir algo que deba saber/i }).click()
  await expect(page.getByTestId('mimo-input')).toHaveValue('Recuerda que en casa ')
  await expect(page.getByTestId('mimo-input')).toBeFocused()
  await page.keyboard.press('Escape')

  // «Lo que ha cambiado»: Mimo's change, grouped under its day, undone once.
  await page.goto('/profile/ficha/historial')
  await expect(page.getByRole('heading', { name: dayLabel(changeAt) })).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Deshacer: He apuntado «Los jueves cenáis algo rápido»' }).click()
  await expect(page.getByTestId('ficha-change').filter({ hasText: 'Deshecho' })).toBeVisible()
  expect(calls).toContainEqual({ method: 'POST', path: '/household/profile/changes/c9/undo', body: null })
  await noSideScroll(page)
})

test('a `child` member: no «Tu ficha» in Perfil, and the page says why', async ({ page }) => {
  await signUp(page)
  await page.route(/\/household\/profile$/, (route) => json(route, { error: 'La ficha la ven los adultos de la casa', code: 'CHILD' }, 403))
  await page.goto('/profile')
  await expect(page.getByRole('link', { name: /^casa/i })).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('profile-ficha')).toHaveCount(0)
  await page.goto('/profile/ficha')
  await expect(page.getByText('La ficha la ven los adultos de la casa')).toBeVisible({ timeout: 15_000 })
})

/* ───────────── pure helpers ───────────── */

test.describe('lib/ficha', () => {
  const now = new Date('2026-10-21T12:00:00+02:00')

  test('dates in the reader’s words', () => {
    expect(longDate('2026-10-16', now)).toBe('16 de octubre')
    expect(longDate('2025-10-16', now)).toBe('16 de octubre de 2025')
    expect(shortDate('2026-10-16', now)).toBe('16 oct')
    expect(dayLabel('2026-10-21T03:10:00+02:00', now)).toBe('Anoche')
    expect(dayLabel('2026-10-20T23:30:00+02:00', now)).toBe('Anoche')
    expect(dayLabel('2026-10-21T10:00:00+02:00', now)).toBe('Hoy')
    expect(dayLabel('2026-10-20T10:00:00+02:00', now)).toBe('Ayer')
    expect(dayLabel('2026-10-18T10:00:00+02:00', now)).toBe('Hace 3 días')
    expect(dayLabel('2026-10-12T10:00:00+02:00', now)).toBe('Hace una semana')
    expect(dayLabel('2026-09-01T10:00:00+02:00', now)).toBe('El 1 de septiembre')
    expect(updatedLabel('2026-10-21T03:10:00+02:00', now)).toBe('Actualizada anoche')
  })

  test('titles and names built from the data', () => {
    expect(forgetTitle('Los jueves cenáis algo rápido')).toBe('¿Olvido que los jueves cenáis algo rápido?')
    expect(forgetTitle('No os gusta el cilantro')).toBe('¿Olvido que no os gusta el cilantro?')
    expect(forgetTitle('Presupuesto: 80 € a la semana')).toBe('¿Olvido «Presupuesto: 80 € a la semana»?')
    expect(forgetTitle('Los jueves, la cena con 15 minutos de trabajo')).toBe('¿Olvido «Los jueves, la cena con 15 minutos de trabajo»?')
    expect(toPerson('El pequeño')).toBe('al pequeño')
    expect(toPerson('La abuela')).toBe('a la abuela')
    expect(toPerson('Hija 2')).toBe('a hija 2')
    expect(toPerson('Carmen')).toBe('a Carmen')
    expect(portraitOpening('En tu casa se come de cuchara y sin prisas el fin de semana, y rápido entre semana. Los domingos…'))
      .toBe('En tu casa se come de cuchara y sin prisas el fin de semana, y rápido entre semana…')
  })

  test('which screen and which question', () => {
    const f = { id: 'x' } as never
    expect(isNewHousehold({ portrait: null, facts: [f, f, f] })).toBe(true)
    expect(isNewHousehold({ portrait: null, facts: Array(7).fill(f) })).toBe(false)
    expect(isNewHousehold({ portrait: { text: 'a', updatedAt: '' }, facts: [] })).toBe(false)
    const people = [{ key: 'casa', isViewer: false }, { key: 'u:me', isViewer: true }] as never
    const q = (subjectKey: string) => ({ question: { id: 'q', question: '¿?', subjectKey, factId: null }, people })
    expect(visibleQuestion(q('casa'))).not.toBeNull()
    expect(visibleQuestion(q('u:me'))).not.toBeNull()
    expect(visibleQuestion(q('p:x'))).not.toBeNull()
    expect(visibleQuestion(q('u:other'))).toBeNull() // the API answers 403 to it
    const c = (id: string, at: string) => ({ id, factId: null, at, action: 'added', verb: '', sentence: '', byMimo: true, canUndo: true }) as never
    expect(groupChangesByDay([c('a', '2026-10-21T03:10:00+02:00'), c('b', '2026-10-21T02:00:00+02:00'), c('c', '2026-10-18T10:00:00+02:00')], now)
      .map((g) => [g.label, g.changes.length])).toEqual([['Anoche', 2], ['Hace 3 días', 1]])
  })
})
