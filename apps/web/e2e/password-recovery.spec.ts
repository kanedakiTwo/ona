/**
 * «¿Has olvidado la contraseña?» (specs/auth.md): from /login to /recuperar,
 * the email goes to POST /auth/forgot and the page says the same thing
 * whether or not the email has an account. With the simulated email (fake
 * Resend, see global-setup.ts) the reset email's link really changes the
 * password. Mobile viewport.
 */

import { test, expect } from '@playwright/test'
import { fillUntilEnabled, registerFreshUser } from './_helpers'

const MAIL_URL = process.env.E2E_MAIL_URL

test('login → «¿Has olvidado la contraseña?» → email link → new password works', async ({ page, browser }) => {
  test.setTimeout(90_000)
  const creds = await registerFreshUser(page)

  const guest = await browser.newPage({ viewport: { width: 390, height: 844 } })
  for (const email of [creds.email, `nadie-${Date.now()}@example.com`]) {
    await guest.goto('/login')
    await guest.getByRole('link', { name: '¿Has olvidado la contraseña?' }).click()
    await expect(guest).toHaveURL(/\/recuperar$/)
    const send = guest.getByRole('button', { name: 'Enviarme el enlace' })
    // The page transition (PageTransition, 250 ms) remounts the page right
    // after a client-side navigation: fill until the value survives it.
    await expect(async () => {
      await guest.getByLabel('Email').fill(email)
      await guest.waitForTimeout(500)
      await expect(send).toBeEnabled({ timeout: 500 })
    }).toPass({ timeout: 15_000 })
    const forgot = guest.waitForResponse((r) => r.url().endsWith('/auth/forgot') && r.request().method() === 'POST')
    await send.click()
    expect((await forgot).status()).toBe(200)
    await expect(guest.getByRole('status')).toContainText(`Si hay una cuenta con ${email}, te acabamos de mandar un enlace`)
  }

  if (MAIL_URL) {
    const inbox = async (to: string) =>
      (await page.request.get(`${MAIL_URL}/__messages?to=${encodeURIComponent(to)}`)).json() as Promise<
        Array<{ subject: string; text: string }>
      >
    // The new account got its welcome; the unknown email got nothing.
    await expect.poll(async () => (await inbox(creds.email)).map((m) => m.subject), { timeout: 15_000 }).toContain(
      'Cambia tu contraseña de Mimoia',
    )
    expect((await inbox(creds.email)).some((m) => /bienvenida|Ya estás dentro/.test(m.subject))).toBe(true)
    const reset = (await inbox(creds.email)).find((m) => m.subject === 'Cambia tu contraseña de Mimoia')!
    const path = reset.text.match(/\/reset\?token=[0-9a-f]{64}/)?.[0]
    expect(path, 'the email carries /reset?token=…').toBeTruthy()

    await guest.goto(path!)
    const save = guest.getByRole('button', { name: 'Guardar contraseña' })
    await fillUntilEnabled(save, async () => {
      await guest.getByLabel('Contraseña nueva').fill('nueva-clave-123')
      await guest.getByLabel('Repite la contraseña').fill('nueva-clave-123')
    })
    await save.click()
    await expect(guest.getByRole('status')).toContainText('Contraseña actualizada')

    await guest.goto('/login')
    const enter = guest.getByRole('button', { name: 'Entrar' })
    await fillUntilEnabled(enter, async () => {
      await guest.getByLabel('Usuario o email').fill(creds.email)
      await guest.getByLabel('Contraseña', { exact: true }).fill('nueva-clave-123')
    })
    await enter.click()
    await expect(guest).toHaveURL(/\/menu|\/onboarding/, { timeout: 20_000 })
  }
  await guest.close()
})
