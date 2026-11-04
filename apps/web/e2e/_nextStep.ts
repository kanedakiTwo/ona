/**
 * PRO-387: /menu shows one next step at a time (apps/web/src/lib/nextStep.ts),
 * and a new account's first one is «Manda la lista» (then «¿Qué tal la cena
 * de ayer?»). Specs about a later card (WhatsApp, «Afina tu menú») put those
 * two away first, as the household would with «Ahora no».
 */
import type { Page } from '@playwright/test'

export async function putAwayFirstWeekSteps(page: Page) {
  await page.addInitScript(() => {
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const now = new Date()
    const monday = new Date(now)
    monday.setDate(now.getDate() + (now.getDay() === 0 ? -6 : 1 - now.getDay()))
    localStorage.setItem(`ona.list.used.${iso(monday)}`, '1')
    localStorage.setItem(`ona.lastNight.answered.${iso(now)}`, '1')
  })
}
