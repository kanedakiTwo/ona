/**
 * PRO-387: /menu shows one next step at a time (apps/web/src/lib/nextStep.ts).
 * The e2e accounts sign up without the health-data consent, so their first
 * one is «No tenemos tus alergias» (safety), then «Manda la lista» and
 * «¿Qué tal la cena de ayer?». Specs about a later step (the guide, WhatsApp,
 * «Afina tu menú») put those away first, as the household would with
 * «Entendido» / «Ahora no». Call it before the first navigation.
 */
import type { Page } from '@playwright/test'

/**
 * «Manda la lista» and «¿Qué tal la cena de ayer?» put away for this week /
 * today, in every spec that isn't about them (`registerFreshUser` calls it;
 * `{ keepNextSteps: true }` keeps them), so they don't push the menu down.
 */
export async function putAwayWeekSteps(page: Page) {
  await page.addInitScript(() => {
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    // Three weeks either side: specs that pin the clock (_clock.ts) land on another day.
    const now = new Date()
    for (let i = -21; i <= 21; i++) {
      const d = new Date(now)
      d.setDate(now.getDate() + i)
      localStorage.setItem(`ona.lastNight.answered.${iso(d)}`, '1')
      if (d.getDay() === 1) localStorage.setItem(`ona.list.used.${iso(d)}`, '1')
    }
  })
}

/** The above plus the health notice: for specs about a later step (the guide, WhatsApp, «Afina tu menú»). */
export async function putAwayEarlierNextSteps(page: Page) {
  await page.addInitScript(() => {
    const iso = (d: Date) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const now = new Date()
    const monday = new Date(now)
    monday.setDate(now.getDate() + (now.getDay() === 0 ? -6 : 1 - now.getDay()))
    localStorage.setItem('ona.health.notice.seen', '1')
    localStorage.setItem(`ona.list.used.${iso(monday)}`, '1')
    localStorage.setItem(`ona.lastNight.answered.${iso(now)}`, '1')
  })
}
