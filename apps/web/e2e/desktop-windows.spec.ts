/**
 * The app on a Windows desktop (a friend of Miguel's, 2026-10-21, in the app
 * installed as its own window: «Panel Perfil. Si pulso en Casa, se queda en
 * blanco», «desde el ordenador el menú Perfil no funciona ninguna opción
 * bien», «no sale menú de navegación para ir atrás o al menú principal», and
 * /menu all cream after signing up). With a mouse, no touch, no browser back
 * button (`page.goBack()` is never used here):
 *
 *   1. A click whose pointer slips a few pixels (a touchpad press, a mouse)
 *      opens every Perfil card: it used to start the browser's native link
 *      drag and the click never happened. Each page has its own way back.
 *   2. Dragging the mouse across a page (selecting text) doesn't slide it nor
 *      jump to another section: the section swipe is for fingers only.
 *   3. «Afina tu menú» from Perfil, at 1440 and 800 px: the sidebar stays
 *      usable, «‹ Perfil» goes back, the buttons answer the mouse, and a
 *      recipe without a photo shows a placeholder, not an empty box.
 *   4. /menu never stays an empty cream page: a sign-up check or a week that
 *      doesn't answer gives way after 8 s (the menu, or «Reintentar»).
 */
import { test, expect, type Page } from '@playwright/test'
import { completeOnboarding, registerFreshUser } from './_helpers'

const DESKTOP = { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false } as const

async function signUp(page: Page) {
  await registerFreshUser(page)
  if (page.url().includes('/onboarding')) await completeOnboarding(page)
}

/**
 * The installed app (`display-mode: standalone`): no browser chrome to lean
 * on. Chromium doesn't emulate `display-mode` through CDP, so the page's
 * `matchMedia` answers it (applies from the next navigation).
 */
async function asInstalledApp(page: Page) {
  await page.addInitScript(() => {
    const real = window.matchMedia.bind(window)
    window.matchMedia = (query: string) =>
      /display-mode:\s*standalone/.test(query)
        ? ({
            matches: true,
            media: query,
            onchange: null,
            addListener() {},
            removeListener() {},
            addEventListener() {},
            removeEventListener() {},
            dispatchEvent: () => false,
          } as MediaQueryList)
        : real(query)
  })
}

/** Press, slip `dx` px, release — a real mouse/touchpad click, not a synthetic one. */
async function slippyClick(page: Page, target: ReturnType<Page['locator']>, dx = 6) {
  // The page cross-fades in (PageTransition): wait for the settled element.
  let box: { x: number; y: number; width: number; height: number } | null = null
  await expect(async () => {
    await target.scrollIntoViewIfNeeded({ timeout: 2_000 })
    box = await target.boundingBox()
    expect(box).not.toBeNull()
  }).toPass({ timeout: 15_000 })
  if (!box) throw new Error('no box')
  const { x: bx, y: by, width, height } = box as { x: number; y: number; width: number; height: number }
  const x = bx + width / 2
  const y = by + height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + 2, { steps: 4 })
  await page.mouse.up()
}

const sidebar = (page: Page) => page.getByRole('complementary', { name: 'Navegación principal' })

test.describe('Windows desktop, mouse', () => {
  test.use(DESKTOP)

  test('every Perfil card opens with a slipping click, and each page goes back to Perfil on its own', async ({ page }) => {
    test.setTimeout(120_000)
    await signUp(page)
    await asInstalledApp(page)
    await page.goto('/profile')
    expect(await page.evaluate(() => matchMedia('(display-mode: standalone)').matches)).toBe(true)
    await expect(page.getByTestId('profile-ficha')).toBeVisible({ timeout: 15_000 })

    const cards: Array<[RegExp, RegExp]> = [
      [/^Tu ficha/, /\/profile\/ficha$/],
      [/^Casa/, /\/profile\/casa$/],
      [/^Afina tu menú/, /\/afinar$/],
      [/^Creencias/, /\/profile\/creencias$/],
      [/^Despensa/, /\/profile\/pantry$/],
      [/^Fijos/, /\/profile\/staples$/],
      [/^Recetarios/, /\/profile\/cookbooks$/],
      [/^Suscripción/, /\/profile\/suscripcion$/],
    ]
    for (const [name, url] of cards) {
      await slippyClick(page, page.locator('main').getByRole('link', { name }).first())
      await expect(page).toHaveURL(url, { timeout: 15_000 })
      // The page shows something (not a blank screen): its title.
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible({ timeout: 15_000 })
      // Its own way back (the installed app has no back button).
      await page.locator('main').getByRole('link', { name: 'Perfil', exact: true }).first().click()
      await expect(page).toHaveURL(/\/profile$/, { timeout: 15_000 })
      await expect(page.getByTestId('profile-ficha')).toBeVisible()
    }
  })

  test('a mouse drag across a page (selecting text) neither slides it nor changes section', async ({ page }) => {
    await signUp(page)
    await page.goto('/profile')
    const note = page.getByText('pasa a ser parte de tu ficha')
    await expect(note).toBeVisible({ timeout: 15_000 })
    const box = (await note.boundingBox())!
    await page.mouse.move(box.x + 5, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + 300, box.y + box.height / 2, { steps: 10 })
    const shift = await page.evaluate(() => {
      const t = getComputedStyle(document.querySelector('main')!.firstElementChild as Element).transform
      return t === 'none' ? 0 : new DOMMatrix(t).m41
    })
    expect(shift).toBe(0)
    await page.mouse.move(box.x + 700, box.y + box.height / 2, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(1_000) // a section swipe would have navigated by now
    await expect(page).toHaveURL(/\/profile$/)
  })
})

for (const width of [1440, 800]) {
  test.describe(`«Afina tu menú» from Perfil at ${width} px`, () => {
    test.use({ ...DESKTOP, viewport: { width, height: 900 } })

    test('sidebar usable, «‹ Perfil» back, mouse buttons work, a card without a photo has a placeholder', async ({ page }) => {
      test.setTimeout(90_000)
      await signUp(page)
      await asInstalledApp(page)
      // The first card has no photo yet (as «Gazpacho» in the report).
      await page.route(/\/taste\/next(\?|$)/, async (route) => {
        const res = await route.fetch()
        const body = await res.json()
        if (Array.isArray(body.cards) && body.cards[0]) body.cards[0].imageUrl = null
        await route.fulfill({ response: res, json: body })
      })
      await page.goto('/profile')
      await page.locator('main').getByRole('link', { name: /^Afina tu menú/ }).click()
      await expect(page).toHaveURL(/\/afinar$/, { timeout: 15_000 })

      // The way back, in the screen itself; and the sidebar beside it.
      const back = page.getByTestId('afinar').getByRole('link', { name: 'Perfil', exact: true })
      await expect(back).toBeVisible({ timeout: 15_000 })
      await expect(sidebar(page)).toBeVisible()
      expect(await sidebar(page).getByRole('link', { name: 'Menú' }).evaluate((el) => {
        const r = el.getBoundingClientRect()
        return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)?.closest('a') === el
      })).toBe(true)

      // Cards with the mouse.
      await page.getByRole('button', { name: 'Empezar' }).click()
      await expect(page.getByTestId('taste-counter')).toHaveText('1 de 10', { timeout: 15_000 })
      await expect(page.getByTestId('taste-card-placeholder')).toBeVisible()
      const like = (await page.getByRole('button', { name: 'Me apetece' }).boundingBox())!
      await page.mouse.click(like.x + like.width / 2, like.y + like.height / 2)
      await expect(page.getByTestId('taste-counter')).toHaveText('2 de 10')
      const love = (await page.getByRole('button', { name: 'Me encanta' }).boundingBox())!
      await page.mouse.click(love.x + love.width / 2, love.y + love.height / 2)
      await expect(page.getByTestId('taste-counter')).toHaveText('3 de 10')
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)

      // Back to Perfil without the browser.
      await back.click()
      await expect(page).toHaveURL(/\/profile$/, { timeout: 15_000 })
      await expect(page.getByTestId('profile-ficha')).toBeVisible()

      // And the sidebar works from «Afina tu menú» too.
      await page.goto('/afinar')
      await sidebar(page).getByRole('link', { name: 'Menú' }).click()
      await expect(page).toHaveURL(/\/menu/, { timeout: 15_000 })
    })
  })
}

test.describe('/menu in a narrow app window (800 × 800) never stays empty', () => {
  test.use({ ...DESKTOP, viewport: { width: 800, height: 800 } })

  test('a sign-up check that never answers gives way to the menu', async ({ page }) => {
    test.setTimeout(60_000)
    await signUp(page)
    const userId = await page.evaluate(() => JSON.parse(localStorage.getItem('ona_user')!).id as string)
    // The browser doesn't know yet that the sign-up is done, and the server doesn't answer.
    await page.evaluate(() => {
      const u = JSON.parse(localStorage.getItem('ona_user')!)
      u.onboardingDone = false
      localStorage.setItem('ona_user', JSON.stringify(u))
    })
    await page.route(new RegExp(`/user/${userId}$`), () => {})
    await page.goto('/menu')
    await expect(page.getByTestId('menu-week-range')).toBeVisible({ timeout: 20_000 })
  })

  test('a week that never answers shows «Reintentar», and retrying loads it', async ({ page }) => {
    test.setTimeout(60_000)
    await signUp(page)
    await page.goto('/menu')
    await expect(page.getByTestId('menu-week-range')).toBeVisible({ timeout: 15_000 })
    let hang = true
    await page.route(/\/menu\/[0-9a-f-]{36}\/\d{4}-\d{2}-\d{2}$/, (route) => (hang ? undefined : route.fallback()))
    await page.reload()
    const alert = page.getByRole('alert').filter({ hasText: 'No hemos podido' })
    await expect(alert).toBeVisible({ timeout: 15_000 })
    hang = false
    await alert.getByRole('button', { name: 'Reintentar' }).click()
    await expect(alert).toHaveCount(0, { timeout: 15_000 })
    await expect(page.getByTestId('menu-week-range')).toBeVisible()
  })
})
